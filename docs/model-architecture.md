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
* Ratings: state-space (Kalman) team strength on margin, with season-start reversion
  to the mean, home-field advantage estimated per sport, and observation noise per
  sport. Upcoming forecast = rating difference + home field. Margin SD from the
  residual distribution. Probabilities from `scoring.margin_distribution` and
  `scoring.cover_probabilities`, with a sport-specific key-number adjustment for
  NFL (empirical margin histogram, not pure normal).
* A market-anchored variant (`market + learned residual`) is reported alongside the
  independent model; both are scored on the identical games.
* Backtest: rolling by season. Report `public/sports/<sport>.json`:

```json
{
  "sport": "nfl", "label": "NFL", "generatedAt": "ISO", "modelId": "nfl-kalman", "modelVersion": "1.0",
  "dataThrough": "2026-11-09", "sources": [{"url": "...", "sha256": "...", "retrievedAt": "ISO"}],
  "backtest": {
    "seasons": [2015, ..., 2025], "games": 2900,
    "mae": 10.1, "marketMae": 9.9, "brierSpread": 0.251, "marketBrierSpread": 0.249,
    "brierMoneyline": 0.21, "marketBrierMoneyline": 0.2, "logLossMoneyline": 0.6,
    "ece": 0.02, "calibration": [...],
    "selections": {"rule": "abs(model - market) >= 2.0", "n": 400, "wins": 200, "losses": 195, "pushes": 5, "units": -3.0, "roi": -0.0075},
    "bySeason": [{"season": 2025, "games": 280, "mae": 10.0, "marketMae": 9.8, "brierSpread": 0.25, "selections": {...}}],
    "variants": [{"id": "independent", "mae": ...}, {"id": "market-anchored", "mae": ...}]
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

`dirtiq_model/odds/` pulls current spreads and moneylines from The Odds API
(`ODDS_API_KEY` in the environment; a GitHub Actions secret of the same name for the
workflow). `python3 -m dirtiq_model odds snapshot --sport nfl` writes the
median-across-books consensus to `public/data/odds/<sport>-latest.json`, fills the
forecast-time line on open ledger rows that had none (sports whose schedule source has no
market), refreshes `close_line`/`close_price` on every open row until the event starts,
and records run status in `public/data/odds/status.json`. Team names are mapped to report
abbreviations by explicit NFL and NBA tables with a nickname fallback; unresolved names
are listed, never guessed. Without a key the command writes `configured: false` and the
UI says the feed is off.

## UI contract

Routes (all read artifacts through `src/lib/model-reports.ts`; pages never parse JSON):

| Route | Shows |
| --- | --- |
| `/` | Model desk: next races with field probabilities, upcoming team-sport games with leans, model health per sport, recent results |
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

`.github/workflows/sports-refresh.yml` runs settle, forecast and export for NFL and NBA
every six hours and commits only `public/sports/`, `public/data/forecast-ledger.json` and
`public/data/model-health.json`.
