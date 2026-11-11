# Build plans

Ranked list of what to build next in this repo, with enough context that any agent or
person can pick one up cold. Keep it current: when a plan ships, move it to "Shipped"
with the commit; when priorities change, reorder and say why. Pair this with
`docs/model-architecture.md` (the contract for how things work) and `AGENTS.md`
(hard constraints). Last revised 2026-11-11.

## Ground rules for any plan here

- Python is 3.9 in production: `from __future__ import annotations`, no runtime `X | Y`,
  no `match`. Next.js is 16: read `node_modules/next/dist/docs/` before touching the app.
- A model change is not done until the rolling backtest has been rerun and the report
  compares against the market **on the same priced games** (`brierMoneylineOnPricedGames`
  vs `marketBrierMoneyline`). Numbers over all games flatter the model.
- Every feature must be as-of: computed only from information available before the
  game or race. Leak checks beat accuracy gains.
- The site only reads JSON artifacts (`public/sports/*.json`, `public/data/**`,
  `data/ml-predictions/*.json`) through `src/lib/model-reports.ts`. Add fields to the
  artifact and the reader; never parse files in pages.
- Tests: `npm run test:py` (unittest, `tests/test_*.py`) and `npm run test:ts`
  (`tests/*.test.ts`). CI runs the `test_teams*`, `test_ledger` and `test_odds` suites
  before every refresh.
- Update `docs/model-architecture.md` in the same change when a contract moves.

## Where things stand (2026-11-11)

| Area | State |
| --- | --- |
| Team ratings | Kalman margin model per sport (NFL, NBA, NHL, NCAAF, NCAAB, MLB), rolling-by-season backtests in `public/sports/<sport>.json`. |
| Lines | NFL from nflverse; NCAAF through 2025 from cfbfastR; NBA, NHL, NCAAB, MLB and 2026 NCAAF from ESPN per-game odds (`dirtiq_model/teams/adapters/espn_odds.py`), cached per season in `../sports-cache/<sport>/espn/`. Opening and closing medians kept. |
| Learned layer | `dirtiq_model/teams/stack.py`: ridge + logistic on rating difference, uncertainty, rest, back-to-backs, games in prior week, MLB probable-pitcher adjustment, site. Headline in NBA, NHL, NCAAB; independent filter in NFL, NCAAF, MLB. A market-aware variant is reported but not used for leans. |
| Market comparison | Every independent model trails the market on priced games. NHL's market-blended stack edges the market slightly. Leans are fixed-threshold disagreement flags, not proven edges. |
| Ledger | `public/data/forecast-ledger.json`: every priced forecast, settled by `teams settle` every six hours. Closing lines from The Odds API (`ODDS_API_KEY`, NFL/NBA/NHL only, 500 requests a month). |
| Results | `public/data/results/<sport>.json`: recent final scores keyed like the ledger. |
| Racing | Conditional-logit race model (`dirtiq_model/racing/`), beats the legacy XGBoost method in every series; data-starved; results arrive through the racing database refresh. |
| Bet tracker | `/bets`: log bets, auto-grade from results and ledger, P&L, ROI, model-backed subset. Postgres (Neon, `DATABASE_URL`) in production, sqlite locally. |
| Refresh | `.github/workflows/sports-refresh.yml` every six hours: settle, forecast, odds snapshot, ledger export, commit. Publish rebases with `-X theirs` so overlapping runs do not conflict. |

## Plans, in priority order

### 1. Real starter signal for MLB and NHL
**Why**: the probable-pitcher adjustment learned from run margins alone shrinks to nothing
(ridge weight ~0.1, no Brier gain). Starters are the biggest non-rating factor in both sports.
**Build**:
- MLB: per-game pitching lines from the Stats API boxscore (`/api/v1/game/{gamePk}/boxscore`,
  one call per game, ~2,500 a season, cache like ESPN odds). Per starter, as-of
  exponentially weighted innings, earned runs, strikeouts, walks → a FIP-style rate
  shrunk to league. Feature: home minus away starter rate, plus bullpen usage last 3 days.
- NHL: starting goalies from `api-web.nhle.com/v1/gamecenter/{id}/boxscore`
  (`playerByGameStats.*.goalies[].starter`). Per goalie as-of save% and goals-saved-above-
  expected proxy. Upcoming starters are not published by the league API; use the team's
  most recent starter with a "known" flag so the model can discount it.
**Done when**: `stackedBrierMoneyline` beats `brierMoneylineOnPricedGames` in MLB and the
NHL gap to the market narrows; `features.py` tests cover the as-of rule.

### 2. Offline closing-line value from ESPN open/close
**Why**: the ledger needs weeks to accumulate; ESPN already stores opening and closing medians
(`open_spread_line`, `open_home_ml`, `open_away_ml`) from 2022 on.
**Build**: in `backtest.py`, for every fixed-rule selection compute line movement from open
to close in the selection's favour; report CLV rate and average move per sport and per
variant. Replace the current `clvNote`.
**Done when**: `/models` shows CLV per sport from the backtest and the ledger side by side.

### 3. Totals model
**Why**: every priced game carries a total; the site forecasts only sides.
**Build**: per-team offensive and defensive pace/efficiency Kalman states (two filters per
sport, or one with a 2-dimensional state), total distribution, over/under probabilities,
leans at a fixed threshold, ledger rows for `total`. The bet tracker already grades totals.
**Done when**: totals Brier vs the market on priced games is in the report and the Tonight
board shows a total lean beside the side lean.

### 4. Injuries and lineups for NBA and NFL
**Why**: rest is in; absence of stars is the next largest rating error.
**Build**: ESPN injuries endpoint per team (`site.api.espn.com/.../teams/{id}/injuries`)
snapshotted each refresh; a minutes- or usage-weighted "available strength" adjustment
learned in the stack. NFL quarterback out/in flag is worth building first.
**Done when**: the adjustment has a stable positive weight across folds and the headline
variant improves in NBA; never let an injury snapshot leak into past games.

### 5. Bet tracker: CLV and sizing
**Build**: compare each logged price with the closing line from the odds snapshots
(`public/data/odds/<sport>-latest.json` by event) and show CLV per bet and overall; a
fractional-Kelly stake suggestion from model probability vs price; CSV export; a filter by
sport and by "model-backed".
**Done when**: a bet logged from the board shows its CLV after the game starts.

### 6. Widen the odds feed inside quota
**Why**: 500 requests a month covers three sports at four runs a day. NCAAB and NCAAF have
the most leans and no closing lines.
**Build**: snapshot only sports with games in the next 24 hours; rotate NCAAB and NCAAF in;
or move to the paid tier. Add NCAAB/NCAAF/MLB name tables to `dirtiq_model/odds/teams.py`.
**Done when**: `public/data/odds/status.json` shows every in-season sport with closes updated.

### 7. Racing: live-night features and more history
**Build**: heat and qualifying results as same-night features (the `race_night` artifacts
exist; the feed does not populate them reliably); pull additional seasons for Summer
Nationals and Crown Jewel; track-type and surface condition encoding.
**Done when**: held-out log loss improves in every series on the rolling backtest.

### 8. Freshness and failure visibility
**Build**: a `/models` banner when any report's `generatedAt` is older than 12 hours or the
last workflow run failed; GitHub Action failure notification; per-sport data-through dates
on the Tonight board.
**Done when**: a stale or failed refresh is visible on the site without reading logs.

### 9. Per-team pages
**Build**: `/sports/<sport>/<team>`: rating history (dumbbell by season), schedule with
model vs result, lean record. Low model value, high reader value.

## Shipped (most recent first)

- 2026-11-11: bet tracker with P&L (`e065646`); NHL/MLB odds name tables (`b1dc6f0`);
  workflow rebase fix (`c75fb54`).
- 2026-11-10: ESPN lines for NBA, NHL, NCAAB, MLB, 2026 NCAAF; CFB upcoming list; stacked
  layer with rest and starters; moneyline-derived market margins for NHL/MLB (`c691145`).
- 2026-11-10: general multi-sport site, Tonight board ranked by confidence, model health page.
- Earlier: racing conditional-logit model, forecast ledger, Kalman team models, odds feed.

## Open questions to settle before starting the related plan

- Totals (plan 3): one joint filter or two independent ones per team? Start with two; the
  joint version only matters if home/away totals correlate after conditioning on pace.
- Injuries (plan 4): ESPN injuries have no history, so the backtest can only start the day
  snapshots begin. Decide whether to buy a historical injury archive or accept a short
  evaluation window.
- Odds quota (plan 6): paid tier or rotation. Rotation is free; the paid tier is simpler.
