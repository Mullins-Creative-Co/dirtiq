# Build plans

Ranked list of what to build next in this repo, with enough context that any agent or
person can pick one up cold. Keep it current: when a plan ships, move it to "Shipped"
with the commit; when priorities change, reorder and say why. Pair this with
`docs/model-architecture.md` (the contract for how things work) and `AGENTS.md`
(hard constraints). Last revised 2026-11-11.

## Focus (set 2026-11-11)

Jordan's priority order is **college football (NCAAF), college basketball (NCAAB), NBA and
NFL**. NHL and MLB stay maintained (data, lines, forecasts, bots) but get no new model work
until the four focus sports are ahead of the market or the list below is exhausted. The
site orders sports the same way; the closing-line feed covers the four focus sports.

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
| Refresh | Three bots commit to `main`: `sports-refresh.yml` (every six hours: settle, forecast, odds snapshot, ledger export), `world100-refresh.yml` (hourly: verified race data, legacy racing model retrains, `public/data/ml-predictions`), `matchups-refresh.yml` (every four hours: NFL pregame projections). Each publishes with `git pull --rebase -X theirs` so its own regenerated files win over an overlapping run; they touch disjoint files otherwise. Local pushes should rebase the same way. |

## Plans, in priority order

### 1. Closing lines for all four focus sports, and offline CLV
**Why**: NCAAF and NCAAB carry the most leans and had no closing-line feed; ESPN's cached
opening and closing lines allow CLV offline today.
**Build**: (shipped 2026-11-11) The Odds API snapshots now cover NFL, NCAAF, NBA, NCAAB at
two runs a day, skipping sports with no game in the next 30 hours. Remaining: in
`backtest.py`, score every fixed-rule selection on open-to-close movement from
`open_spread_line` / `open_home_ml` and report CLV rate per sport and variant; show it on
`/models` beside the ledger's live CLV.
**Done when**: `/models` shows CLV per focus sport from the backtest and the ledger.

### (old 2) Injuries and lineups for NBA and NFL
**Why**: rest is in; absence of stars is the largest remaining rating error in NBA; the
NFL quarterback is the single biggest line mover.
**Build**: ESPN injuries endpoint per team snapshotted each refresh; NFL quarterback
out/in flag first; NBA minutes-weighted available-strength adjustment learned in the stack.
Snapshots start the day they begin, so the evaluation window is short; never leak a
snapshot into earlier games.
**Done when**: a stable positive weight across folds and a better headline variant in NBA
and NFL on priced games.

### 3. Near-live lines on the Tonight board
**Why**: lines refresh every six hours; a bettor needs the price at tip.
**Build**: fetch ESPN's current odds for today's focus-sport games at request time with a
short server cache (minutes), show them beside the forecast-time line, and let "Log this
bet" capture the live price. Optionally move the refresh workflow to hourly for open
games only.
**Done when**: the board's price is never older than a few minutes during game windows.

### (old 4) Totals model for the focus sports
**Why**: every priced game carries a total; the site forecasts only sides.
**Build**: per-team pace/efficiency Kalman states, total distribution, over/under
probabilities, fixed-threshold leans, ledger rows for `total` (the bet tracker already
grades totals). NFL and NBA first, then the college sports.
**Done when**: totals Brier vs the market on priced games is in the report and the Tonight
board shows a total lean beside the side lean.

### 5. College-specific rating work (NCAAF, NCAAB)
**Why**: the two biggest slates; conference structure and the pooled NON_D1/FCS buckets
are crude.
**Build**: conference-strength priors at season start (last season's rating carried with
conference-level reversion), neutral-site tournament handling, a "games against pooled
opponents" discount in the rating uncertainty, and per-team pages for the top 25.
**Done when**: NCAAB and NCAAF priced-game Brier improves against the market and
`/sports/ncaab` loads in under two seconds with 365 teams.

### (old 6) Bet tracker: CLV and sizing
**Build**: compare each logged price with the closing line from the odds snapshots and
show CLV per bet and overall; fractional-Kelly stake suggestion; CSV export; filters by
sport and "model-backed".
**Done when**: a bet logged from the board shows its CLV after the game starts.

### (old 7) Freshness and failure visibility
**Build**: a `/models` banner when any report is older than 12 hours or the last bot run
failed; per-sport data-through dates on the Tonight board.

### (old 8) Racing: live-night features and more history
**Build**: heat and qualifying results as same-night features; more seasons for the thin
series; track-type and surface encoding. Not a focus sport; pick up when the racing
calendar restarts.

### Deferred (NHL, MLB): real starter signal
**Build when picked up**: MLB per-game pitching lines from the Stats API boxscore into an
as-of FIP-style starter rate; NHL starting goalies from the league boxscore with a
"known" flag for upcoming games. The probable-pitcher adjustment learned from run margins
alone shrinks to nothing, so this is the only route to starter value.

## Shipped (most recent first)

- 2026-11-11: focus set to NCAAF/NCAAB/NBA/NFL; closing-line feed moved to the four focus
  sports with a quota-safe schedule; racing seed merged with the WoO World Finals and both
  racing engines retrained (`ed1bb4a`).
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
