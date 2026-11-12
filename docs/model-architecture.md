# dirtIQ model architecture

One Python package, `dirtiq_model/`, produces every forecast dirtIQ shows. The
Next.js app never trains or scores; it reads artifacts the package writes.

```
dirtiq_model/
  scoring.py        proper scores, no-vig, CLV, margin distributions (pure functions)
  ledger_core.py    forecast_ledger table + health export
  ledger/cli.py     python3 -m dirtiq_model ledger summary|export|settle
  racing/           pick-one-of-N conditional logit model for dirt late models
  teams/            two-team margin model with per-sport adapters (nfl, nba, ...)
```

Python 3.9. Every module starts with `from __future__ import annotations`; no
runtime `X | Y` unions, no `match`. Dependencies: numpy, pandas, scipy,
scikit-learn, xgboost, pyarrow (see `requirements.txt`).

## Objectives, stated once

* **Racing** is a house book. The model's job is a calibrated probability for every
  entrant over the field. Primary metric: per-race multinomial log loss of the
  normalized winner distribution. Secondary: top-1 hit rate, top-3 overlap,
  expected calibration error, Brier on the win market.
* **Team sports** have an efficient market. The model's job is a margin distribution
  that is calibrated and, where it disagrees with the market, right more often than
  the price requires. Primary metrics: Brier and log loss of cover/moneyline
  probabilities, MAE of projected margin versus the market's MAE, closing-line
  value and units at the archived price on selections.

No backtest number is a claim of a live edge. The ledger is the only place a live
claim can come from.

## The forecast ledger

Persisted as `public/data/forecast-ledger.json` (override with `DIRTIQ_LEDGER_PATH`;
a `.db` path uses a plain SQLite file) and worked on as an in-memory SQLite table
`forecast_ledger` (schema in `dirtiq_model/ledger_core.py`). JSON keeps it small,
diffable, deployable with the site and committable from CI.
One row per (sport, event, market, selection, model). Engines call
`Ledger.record([...Forecast])` when they score an upcoming event and
`Ledger.settle(...)` when results arrive. `Ledger.export_health()` writes
`public/data/model-health.json`:

```json
{
  "generatedAt": "ISO",
  "models": [{
    "sport": "nfl", "modelId": "nfl-kalman", "market": "spread", "modelVersion": "1.0",
    "forecasts": 120, "open": 14, "settled": 100, "wins": 52, "losses": 46, "pushes": 2,
    "brier": 0.247, "logLoss": 0.69, "ece": 0.03, "calibration": [{"lo":0,"hi":0.05,"n":3,"predicted":0.04,"observed":0.0}],
    "mae": 9.9, "pricedForecasts": 98, "units": 3.2, "roi": 0.033, "clvCount": 80, "clvAvg": 0.004,
    "firstForecastAt": "ISO", "lastForecastAt": "ISO"
  }]
}
```

Event ids: racing `race:<race_id>`; team sports `<sport>:<game_id>` where game_id is
the source's id (nflverse `2026_10_WAS_NYG`, ESPN event id for NBA).
Selections: racing `driver:<driver_id>`; team sports the team abbreviation.

## Racing engine contract

`python3 -m dirtiq_model racing train|backtest|score|settle`

* Reads `races`, `race_entries`, `drivers`, `tracks`, `track_similars` through
  `scripts/model_runtime.py` paths and exclusions.
* Features are computed **as-of each race date** from completed races only. Static
  snapshot tables (`driver_model_metrics`, `driver_equipment_profiles`,
  `driver_track_size_wins`) carry no as-of date and are **not** features.
* Model: linear score per entrant, softmax over the field (conditional logit /
  Plackett-Luce), L2 regularized, fit on the multinomial likelihood. An optional
  boosted-score variant is compared on the same rolling-origin folds and chosen only
  if it wins on held-out log loss.
* Stages: `early` (no race-night inputs) and `race-night` (start, heat, qualifying ranks).
* Backtest: rolling-origin by season (train through year t-1, test year t), reported
  per series and pooled, versus the legacy XGBoost artifacts on identical races.
* Artifacts: `data/dirtiq_model_pl_<slug>.pkl`, `data/feature_params_pl_<slug>.json`.
  Report: `public/data/racing-model-report.json`.
* Scoring writes `data/ml-predictions/race_<id>.json` in the **existing** shape
  (`raceId, modelSeries, modelSlug, modelReason, modelStage, raceNightCoverage,
  predictions[{driverId, driverName, metricSeries, modelSlug, modelSeries, modelReason,
  modelStage, rawProbability, probability, calibration, trainedOn, testAuc,
  top1Accuracy, modelEngine, modelAlgorithm, featureCount}]`) plus new fields
  `top3Probability`, `top5Probability`, `expectedFinish`, `backtestLogLoss`,
  `backtestTop1`. `probability` already sums to one across the field.
* Scoring also records `win` and `top3` forecasts to the ledger; `settle` grades
  completed races.

`public/data/racing-model-report.json`:

```json
{
  "generatedAt": "ISO", "modelId": "racing-cl", "modelVersion": "1.0",
  "series": [{
    "series": "Lucas Oil LMDS", "slug": "lucas_oil_lmds", "stage": "early",
    "races": 120, "entries": 3000, "seasons": [2023, 2024, 2025, 2026],
    "logLoss": 2.41, "legacyLogLoss": 2.55, "uniformLogLoss": 3.2,
    "top1": 0.31, "legacyTop1": 0.27, "top3Overlap": 1.6, "brier": 0.04, "ece": 0.01,
    "calibration": [...], "bySeason": [{"season": 2025, "races": 60, "logLoss": 2.4, "top1": 0.3}],
    "features": [{"name": "last10_avg_finish", "weight": -0.8}]
  }],
  "limitations": ["..."]
}
```

## Team-sport engine contract

`python3 -m dirtiq_model teams backtest|forecast|settle --sport nfl`

* Adapters in `dirtiq_model/teams/adapters/<sport>.py` expose
  `load_games(cache_dir) -> DataFrame` with columns
  `game_id, season, week, start (ISO UTC), home, away, neutral (0/1), home_score,
  away_score, spread_line (home handicap, negative = home favorite), spread_home_price,
  spread_away_price, home_ml, away_ml, total_line` and `completed (bool)`.
  Raw downloads live outside git in `../sports-cache/<sport>/` with SHA256 noted.
  Adapters may add feature columns the engine understands: `home_starter` /
  `away_starter` (MLB probable-pitcher ids) and `open_spread_line`, `open_home_ml`,
  `open_away_ml`, `books` (ESPN odds).
* Lines. NFL comes priced (nflverse) and NCAAF through 2025 (cfbfastR archive).
  NBA, NCAAB, NHL, MLB and NCAAF from 2026 take `adapters/espn_odds.py`: one ESPN
  core-API request per game, median across real sportsbooks of the closing block
  (current block for upcoming games), spread as the home handicap, plus the opening
  medians. NBA and NCAAB are keyed by ESPN id; NHL and MLB are mapped through the
  ESPN scoreboard on local date and abbreviation (alias table + learned leftovers,
  doubleheaders in start order). Coverage starts 2015-16 (NBA), 2017 (MLB), 2018-19
  (NCAAB), 2019-20 (NHL). The per-season cache `<cache>/<sport>/espn/odds_<season>.jsonl`
  never refetches completed games. NCAAF has no future rows in its schedule archive,
  so its upcoming list is the ESPN FBS scoreboard for the next ten days.
* Ratings: state-space (Kalman) team strength on margin, with season-start reversion
  to the mean, home-field advantage estimated per sport, and observation noise per
  sport. Upcoming forecast = rating difference + home field. Margin SD from the
  residual distribution. Probabilities from `scoring.margin_distribution` and
  `scoring.cover_probabilities`, with a sport-specific key-number adjustment for
  NFL (empirical margin histogram, not pure normal).
* A market-anchored variant (`market + learned residual`) is reported alongside the
  independent model; both are scored on the identical games.
* The stacked layer (`stack.py`, features in `features.py`) is refit per fold from
  the training seasons' one-step-ahead filter predictions: ridge for the margin and
  logistic for the home win on rating difference, rating uncertainty, rest days,
  back-to-back flags, games in the prior week, starter adjustments (as-of shrunk
  EWMA of margin residuals per MLB probable pitcher) and site. `stacked` has no
  market input, so its edge is still a disagreement signal; `stacked-market` adds the
  market margin and no-vig moneyline logit and is the best calibrated probability.
  `backtest.headline` names the variant the forecast publishes as `homeWinProb` /
  `projectedHomeMargin` (`stacked` when it beats the filter on out-of-fold moneyline
  log loss); the filter's own values stay in `independentHomeMargin` /
  `independentHomeWinProb`, and `stackedMarketHomeWinProb` is always present.
* Backtest: rolling by season. Report `public/sports/<sport>.json`:

```json
{
  "sport": "nfl", "label": "NFL", "generatedAt": "ISO", "modelId": "nfl-kalman", "modelVersion": "1.1",
  "dataThrough": "2026-11-09", "sources": [{"url": "...", "sha256": "...", "retrievedAt": "ISO"}],
  "backtest": {
    "seasons": [2015, ..., 2025], "games": 2900,
    "mae": 10.1, "marketMae": 9.9, "brierSpread": 0.251, "marketBrierSpread": 0.249,
    "brierMoneyline": 0.21, "marketBrierMoneyline": 0.2, "logLossMoneyline": 0.6,
    "ece": 0.02, "calibration": [...],
    "selections": {"rule": "abs(model - market) >= 2.0", "n": 400, "wins": 200, "losses": 195, "pushes": 5, "units": -3.0, "roi": -0.0075},
    "bySeason": [{"season": 2025, "games": 280, "mae": 10.0, "marketMae": 9.8, "brierSpread": 0.25, "selections": {...}}],
    "variants": [{"id": "independent", "mae": ...}, {"id": "market-anchored", "mae": ...},
                 {"id": "stacked", "features": [...], "fitsBySeason": [...]}, {"id": "stacked-market", ...}],
    "headline": "stacked", "stackedBrierMoneyline": 0.21, "stackedMarketBrierMoneyline": 0.205
  },
  "ratings": [{"team": "KC", "rating": 6.1, "sd": 1.2, "rank": 1, "games": 9, "updatedAt": "ISO"}],
  "upcoming": [{
    "gameId": "2026_10_WAS_NYG", "home": "NYG", "away": "WAS", "startsAt": "ISO",
    "projectedHomeMargin": 2.3, "marginSd": 13.1, "homeWinProb": 0.57,
    "marketHomeSpread": -1.5, "marketHomePrice": -110, "marketAwayPrice": -110,
    "marketHomeMl": -120, "marketAwayMl": 100, "book": "consensus", "lineObservedAt": "ISO",
    "homeCoverProb": 0.53, "awayCoverProb": 0.47, "pushProb": 0.02, "edgePts": 0.8,
    "lean": "home", "note": "..."
  }],
  "limitations": ["..."]
}
```

`forecast` records `spread` and `moneyline` rows to the ledger for every upcoming
game with a visible market; `settle` grades them from completed results.

## Odds feed

`dirtiq_model/odds/` pulls current spreads and moneylines for the focus sports (NFL, NCAAF,
NBA, NCAAB) from The Odds API at two runs a day, skipping a sport with no game in the next
30 hours (`games_within`), to stay inside the free 500-request month. ESPN per-game lines
(see the team engine section) are the primary line source; this feed exists for closing
lines. It needs
`ODDS_API_KEY` in the environment (a GitHub Actions secret of the same name for the
workflow). `python3 -m dirtiq_model odds snapshot --sport nfl` writes the
median-across-books consensus to `public/data/odds/<sport>-latest.json`, fills the
forecast-time line on open ledger rows that had none (sports whose schedule source has no
market), refreshes `close_line`/`close_price` on every open row until the event starts,
and records run status in `public/data/odds/status.json`. Team names are mapped to report
abbreviations by explicit NFL and NBA tables with a nickname fallback; unresolved names
are listed, never guessed. Without a key the command writes `configured: false` and the
UI says the feed is off.

## Daily card

`python3 -m dirtiq_model card build` (`dirtiq_model/card/build.py`) runs at the end of every
sports refresh. It fits nothing: it selects from the published reports. A game qualifies
when it starts today (US Eastern), is at least 20 minutes away, has a priced spread observed
within three hours, and the published margin disagrees with the spread by at least the
sport's `selectionThreshold`. Qualifiers are ranked by whether `stackedMarketHomeMargin`
takes the same side, then by disagreement in threshold units; capped at 15 picks, 6 per
sport and 10 units; staked 1.0 unit when the market-aware model agrees and 0.5 otherwise.
A pick is locked at its first listed line (`public/data/cards/<date>.json` is the day's
archive and the lock), later runs only update `status`/`current`, and earlier cards are
graded at the locked line from `public/data/results/`. `public/data/daily-card.json` is the
current card with `record`, the graded history of all cards. Every pick carries its sport's
backtest record for the rule, which is negative in every sport: the card is a shortlist for
review, and `record` is the only evidence it can earn. `/card` (`src/lib/card.ts`) checks
each open pick against ESPN's current line at request time, and `src/lib/card-agent.ts`
holds the instructions for a reviewing agent, which can read the card at its raw GitHub URL.

## Near-live Tonight lines

Forecasts and graded ledger lines remain the JSON artifacts read through
`src/lib/model-reports.ts`. The Tonight board adds a display-only live layer;
it never changes forecasts, artifacts, saved leans or ledger rows. Pages await
`buildTonightBoard()` after `connection()` and never fetch external data themselves.
`/bets` requests the board with `{ live: false }` because its event selector needs
only the saved schedule; the Tonight link carries the selected quote.

`src/lib/live-lines.ts` is server-only. It requests ESPN core per-event odds for NFL,
NCAAF, NBA and NCAAB, with a shared limit of 12 active requests, a five-second timeout
per request (including JSON reading), in-flight deduplication and a bounded in-memory
three-minute cache per URL. HTTP/network/JSON failures return null and retry after
30 seconds; completed responses retain their observation timestamp on cache hits.
The cache is process-local, so a cold instance must fetch again. `observedAt` means
when dirtIQ retrieved the ESPN reference quote, not a sportsbook-guaranteed quote time.
NFL's nflverse ids are resolved through the ESPN scoreboard with unique exact
home/away and scheduled-time matching (WSH/WAS and LAR/LA normalized); failed or
ambiguous matches fall back. Other focus sports already use ESPN ids.

Pure rules in `src/lib/live-lines/core.ts` mirror Python `adapters/espn_odds.py`:
exclude unnamed/live/AccuScore/numberFire/TeamRankings/consensus/PickCenter feeds;
home handicap sign; nested close fields override top-level fields when present;
median spread/total/side prices across real books; paired moneylines only; legal
American-price normalization and ties-to-even rounding. Upcoming top-level fields
carry the current quote. Live response shape:
`{ spread, homeSpreadPrice, awaySpreadPrice, homeMl, awayMl, total, books, observedAt }`
or null. Fixtures test parity, exclusions, no-vig probabilities and lean boundaries.

Only the first six featured games per focus sport on today's Eastern calendar,
starting in the next 24 hours, fetch live odds (24 events maximum). Show all and
client filters do not expand this network slate. Each item preserves `market` and
adds `liveMarket`; the latter compares the unchanged projected home margin with
`-liveSpread`, using the report's `backtest.selectionThreshold`. Missing spreads or
thresholds produce no supported live lean. Saved cover probabilities are never
reused at a moved live spread.

Rows show line age and a visible saved-line fallback on failure. Expanded games
show both markets, leans and observed times. The board refreshes every minute while
visible and on returning to the tab; expiry timers stop presenting or logging a
three-minute-old quote as live. “Log this bet” uses the live line and its matching
side spread price (or live moneyline when there is no live spread); missing live
prices stay empty rather than combining an old price with a moved line. A failed
or expired live result uses saved terms. `marketProb` is the selected side's no-vig
moneyline probability; a spread link leaves `modelProb` empty for a live line because
the saved cover probability describes a different handicap. These quotes are
reference medians, not executable offers.

## UI contract

Routes (all read artifacts through `src/lib/model-reports.ts`; pages never parse JSON):

| Route | Shows |
| --- | --- |
| `/` | Tonight: every game and race in the next week ranked by model confidence, each opening into the statistical case, the matchup comparison, and the market and price; `?sport=nfl` scopes it. Built by `src/lib/tonight.ts` from the sport reports (which now carry per-team season form) and race files (which now carry per-driver score factors and recent finishes) |
| `/sports` | One card per sport with a report; sports without an adapter listed |
| `/sports/<sport>` | Upcoming games beside the market, power ratings, season-by-season backtest, reliability, ledger summary, limits and sources |
| `/models` | Ledger scorecard for every model and market, racing backtest versus the legacy method with reliability diagrams, team-sport backtests |

Artifacts the UI reads: `public/data/model-health.json`, `public/data/racing-model-report.json`,
`public/sports/<sport>.json`, `data/ml-predictions/race_<id>.json` (falls back to
`public/data/ml-predictions/`), and the racing database for upcoming races and results.
Every page renders an explicit empty state with the command that produces the missing artifact.

Shared components live in `src/components/ui/` (`primitives.tsx`, `reliability-chart.tsx`,
`season-dumbbell.tsx`); design tokens and the `.stat`, `.chip`, `.data-table`, `.chart-*`
classes are in `src/app/globals.css`. The single app shell is `src/components/nav.tsx`.

## Commands

```sh
npm run racing:backtest            # rolling backtest, writes public/data/racing-model-report.json
npm run racing:train               # production artifacts per series and stage
npm run racing:score               # score upcoming races, record win/top3 forecasts to the ledger
npm run racing:settle              # grade completed races, export model-health.json
npm run sports:backtest -- --sport nfl
npm run sports:forecast -- --sport nfl   # ratings + upcoming + ledger rows
npm run sports:settle   -- --sport nfl   # grade from fresh results, export model-health.json
npm run odds:snapshot   -- --sport nfl   # needs ODDS_API_KEY
npm run ledger:export              # public/data/model-health.json
npm run ledger:summary
npm run test:py                    # all Python unit tests
npm run test:ts                    # all TypeScript tests
```

`.github/workflows/sports-refresh.yml` runs settle, forecast and export for every team sport
hourly from about 5 AM to 1 AM Eastern (plus one overnight run) and commits only `public/sports/`, `public/data/forecast-ledger.json` and
`public/data/model-health.json`.


## Refresh triggers and health (2026-11-12)

Sports retains its hourly Eastern-day GitHub cron and racing its hourly cron. GitHub
cron alone missed multiple expected runs despite active workflows and no queued or
running sports jobs; the API did not reveal why. The independent Cloudflare Worker
in `ops/refresh-dispatcher/` dispatches both fixed workflows on main hourly at :17 UTC.
It requires owner activation with a repository-scoped Actions-write token; see its
README. Implementation is not evidence of activation or two successful hourly runs.
Snapshots now depend solely on the persisted DUE slot check, including manual dispatch;
there is no implicit force-snapshot behavior. Sports command failures fail the job
rather than masquerading as success; completed artifacts can still be published.
Racing checks automation-status.ok before publishing because auto_refresh catches errors.
Successful racing publication writes public/data/race-refresh.json (refreshedAt).

All JSON UI inputs are included explicitly in server traces: public/data/**/*.json,
public/sports/*.json, data/ml-predictions/*.json; the racing seed DB is included too.
The Vercel ignore file permits the prediction cache under otherwise ignored data/.

GET /api/freshness computes deployment-local ages in minutes for all six sports,
the daily card, and the last successful race refresh. Missing, invalid or future
stamps are unknown/overdue; >75 minutes is overdue and >180 is stale. Page notices
on Tonight and Card show overdue/missing artifacts and failed/cancelled/skipped latest
runs. They query the public GitHub Actions API at page load without credentials;
unavailable/rate-limited status is explicitly not verified, never treated as success.
A missing trigger has no failure record, so artifact age reports the missed update.
No endpoint or UI access settings were changed; reviewing agents need existing Vercel
access. The archive fixture test grades a copy of the November 12 card next day,
checks locked terms against changed quotes, and leaves absent/null scores ungraded.


## College team display names

`public/data/team-names.json` is ESPN display metadata for college basketball and
football, refreshed manually with `node scripts/refresh-team-names.mjs`. Its source
URLs and retrieval timestamp are recorded. It includes team catalogs and today's
scoreboard opponents (including non-Division-I schools). Ambiguous abbreviations
are omitted rather than guessed. The app reads it through `getTeamNames` in
`model-reports.ts`; `teamLabel` falls back to the code when no unique name exists.
Card and Tonight show full names with codes; copied card briefs add `homeName`,
`awayName`, `pickName`. Published model/card identifiers, grading and bet selections
remain unchanged. The raw model card URL still contains its original identifiers.
