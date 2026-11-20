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
    "uncalibratedHomeCoverProb": 0.53, "uncalibratedAwayCoverProb": 0.47, "pushProb": 0.02, "edgePts": 0.8,
    "lean": "home", "note": "..."
  }],
  "limitations": ["..."]
}
```

`forecast` records `spread` and `moneyline` rows to the ledger for every upcoming
game with a visible market; `settle` grades them from completed results.
`settle` also writes `public/data/results/<sport>.json`. The NBA and NCAAB schedule archives
are republished about once a day, so `late_finals` fills games they still list as unplayed
from ESPN's scoreboard (same event ids, `source: "espn-scoreboard"`); last night's bets and
card picks grade on the next refresh instead of a day later.

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

Over/unders: `dirtiq_model/teams/totals.py` projects a game total for NBA, NCAAB, NFL and
NCAAF from one number per team (how far its games run from the league's season average
total, exponential half-life, halved between seasons). `forecast` writes `projectedTotal`,
`totalEdgePts`, `totalLean`, `totalEligible` and `totalThreshold` on each upcoming game;
`totalLean()` in `src/lib/live-lines/core.ts` re-derives the lean against a live total.
A lean needs 6 points (basketball) or 4 (football) and four games this season for both
teams. Against closing totals it is worse than the market in every sport and leans hit
46-51%, so it is shown as a comparison, never staked on the card.

Tonight flags, not favorites: a game row leads with its spread lean and, separately, a
moneyline flag from `moneylineValue` (`src/lib/live-lines/core.ts`): the side whose price
beats the model's win probability by at least `ML_MIN_EV` (8%) and at most `ML_MAX_EV` (50%,
beyond which it is a rating error), never longer than `ML_MAX_PRICE` (+300). The outright
winner is no longer a headline. Rows sort by `priority` (flagged first).

## Daily card

`python3 -m dirtiq_model card build` (`dirtiq_model/card/build.py`) runs at the end of every
sports refresh. It fits nothing: it selects from the published reports. A game qualifies
when it starts today (US Eastern), is at least 20 minutes away, has a priced spread observed
within three hours, and the published margin disagrees with the spread by at least the
sport's `selectionThreshold` and by less than four times it (a wider gap is a rating or data
error: a first-season Division I team, a rating built on blowouts). Qualifiers are ranked by whether `stackedMarketHomeMargin`
takes the same side, then by disagreement in threshold units; capped at 15 picks, 6 per
sport and 7.5 units. The same existing selection thresholds and 4× cap remain.

Stakes are computed from evidence every run (`teams/evidence.py`), replacing the NBA
pause. The lower endpoint of a two-sided 95% Wilson interval (z=1.959963984540054)
for the headline model's out-of-fold card rule must exceed 52.4%. Pushes are excluded.
The mean live spread CLV must also be positive over at least 100 unique started games
with a valid leaned-side closing snapshot. Both sides never count as two games; invalid
or NaN leans, future events, voids and missing closes are excluded. A legacy lean
must also agree with the stored margin/handicap at the sport threshold; contradictory
labels are excluded. New metadata records `selectionThreshold` explicitly. Missing evidence
fails closed. Passing new picks stake 0.5 unit; other new picks stake zero and remain
listed and graded. The current card's unstarted stakes are reduced to zero if its sport
fails; a zero stake is never automatically promoted. Past cards keep their original
picks, stakes and results. A current reduction retains `originallyListedStakeUnits`.

The archive (`public/data/cards/<date>.json`) locks listed lines/prices. The normal build
can grade ungraded results and append CLV fields to past cards, never rewrite existing
results/stakes. `clv.points = listed selected-side handicap - closing selected-side
handicap`: +3 taken vs +2 close is +1 point. The source is the last available pre-start
ledger snapshot, not a guaranteed tip-time quote. `record.clv` includes count, total,
mean and positive fraction for all tracked picks, including unstaked picks. Win-loss
also includes unstaked tracking picks; money P&L uses actual original stakes. Missing
closing coverage stays missing and is excluded from the CLV denominator.

`backtest.spreadEvidence` is generated from out-of-fold predictions using the published
headline model (`stk` when promoted, otherwise `ind`), with fixed absolute-disagreement
buckets [0,1), [1,2), [2,3), [3,4), [4,infinity) in threshold multiples. Each bucket
reports games, wins/losses/pushes, decided sample and empirical cover rate. The gate
uses 1 to under 4 thresholds. These are descriptive historical frequencies, not
calibrated per-game probabilities or a new backtest of a probability calibration.
They are attached as `empiricalCover` to upcoming games and card picks. Promotion
of a valid stacked prediction with no lean clears the old filter lean; it only falls
back when the stacked prediction itself is missing. Card, Tonight,
readiness summaries and sport tables show them with sample sizes. Raw values remain
`uncalibratedHomeCoverProb` / `uncalibratedAwayCoverProb` on games and
`uncalibratedModelCoverProb` on new card picks. Legacy archives can retain old fields;
UI and logging never use raw cover probabilities as actionable probabilities. Bulk
logging saves every pick on the card at a flat $1, staked or not, and says how many are
unstaked; the card stake is what the evidence supports, the tracker is what the owner bet.
Individual logging remains available.

`backtest.predictionThrough` records the scored sample cutoff independently of the
current forecast data-through date. Backtest scored CSVs retain `open_spread_line`, `open_home_ml`, `open_away_ml`.
`backtest.clv` and `clvByVariant` summarize opening-line spread leans for independent
and stacked forecasts. Side selection uses `mean + opening handicap`, then compares
opening vs closing selected-side handicaps, avoiding selection on the close. These are descriptive comparisons using pregame
margins; there is no forecast timestamp at opener publication, so this is not a
backtest of an executable opener-betting strategy.
Market-input forecasts cannot be reused here because their inputs contain closing
lines; that limitation is explicit. NFL has no opening-line pairs in its source.
`scripts/refresh_spread_evidence.py` regenerates reporting-only fields from saved
predictions, using cached event opening lines for older CSVs. It never fits a model
or writes bets. `/models` shows backtest and live spread CLV separately, in points;
the older ledger scorecard's price/probability CLV remains a different measurement.

The odds adapter and live parser reject |handicap| >= 100 on each book before
aggregation: ESPN sometimes writes an American price such as -110 into closing
`pointSpread`. A malformed closing handicap stays unavailable; an earlier/current
quote is never silently relabeled as its close. Compact cached records are validated
on every read, so existing caches also receive this correction. Other valid books
can still price the event. The parsers also withhold side markets, including opening lines, when
real providers disagree about home-favorite direction. No model-based sign flipping
or majority vote across duplicated brands is allowed. Totals remain available. This
can also withhold genuine near-pick'em movement; it is a conservative data-quality
policy, not a betting filter. It does not certify unanimous historical feeds as clean.

`/card` (`src/lib/card.ts`) checks each open pick against ESPN's current line at request
time. `src/lib/card-agent.ts` tells reviewing agents never to stake zero-stake picks.

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


## Inline bet logging

Card rows expand a full-width log form below the selected pick; Tonight matchups
expand the same form inside their detail panel. `inline-log-bet.tsx` reads the existing
log-link query values (including event ID, side, line and price), preserving the same
terms and grading keys as `/bets`. `LogBetForm` uses the existing server action and
storage with an inline success state instead of navigating. Validation errors remain
visible beside the form; pending submissions disable the save button. The standalone
`/bets` form and incoming prefilled links continue to work. Tonight also carries raw
`homeTeam`/`awayTeam` codes separately from full display names so event dropdowns
continue to save selections that the results grader recognizes.

## Bet history and final-score recovery (2026-11-15)

NFL forecast/settle commands supplement pending source rows using official ESPN final
scores, requiring a unique team-pair and kickoff match within one minute. Canonical
nflverse IDs, locked prices and existing finals are preserved. Historical backtests do
not use this supplement. On-request bet settlement additionally checks missing linked
NFL finals within four days (uncached scoreboard request, five-second timeout); failures
leave records pending. Free-text games and manual grades are never inferred or replaced.

The event picker merges upcoming games, recent results and ledger entries through the
artifact reader. Display names use the verified team catalog while identifiers retain
source codes. Archived daily cards remain loggable. Bet edits retain the original
record ID and placed date; unchanged grading terms retain their outcome and settlement
time. A changed game, side or line clears an automatic grade for recalculation. Manual
historical outcomes can be entered explicitly. Profit charts use placed dates.

Bulk card logging reads the requested dated artifact on the server and saves its listed
line and price as personal bets, with a flat $1 stake per new bet; it never submits wagers. Existing event/market/side
records are returned for editing without replacing their terms. Postgres uses a per-key
transaction advisory lock plus conditional insert; SQLite uses one conditional insert.
Partial batches can be retried. Historical entries default to the logging time and expose
the placed date in the editor. Personal edits leave the published card unchanged.


## Availability context and experimental player values (2026-11-18)

`python3 -m dirtiq_model availability refresh` writes
`public/data/availability/latest.json` and immutable observations in daily
`public/data/availability/history/YYYY-MM-DD.json`. It runs after the sport forecasts
in the hourly sports workflow. Feed/model errors produce unavailable context and a
visible failure field; the workflow fails while publishing the diagnostic artifact.
Expected unsupported college coverage is reported explicitly, not treated as transport
failure. Raw public responses and NBA box-score releases are cached outside git
(`../injury-cache`, or the workflow's cached sports-cache/availability directory).

`availability/feed.py` reads ESPN's public league injury endpoints for NBA, NFL, NCAAF
and NCAAB, with source and retrieval times and content hashes. It joins by athlete ids
(explicit or consistent athlete URLs), never injury-news ids or fuzzy names. Latest
Active news clears older Out rows; conflicting current statuses and team mismatches
are not valued. Future source/item timestamps are rejected. Missing/stale sources and
college feeds with no recent reports are unavailable, never "healthy". Current NFL
reports provide QB-listed flags only: starting-QB identity and point value are unverified.
Editorial injury-news prose is not republished; status and structured body-part facts
are displayed with source links. A generic team report applies only to its next game,
not every future fixture. Missing teams/opponents remain unknown.

`availability/impact.py` fits `nba-minute-ridge-v1`, a separate experimental association
model: home-field and team terms plus observed player regulation-equivalent minutes/48
against historical game margins. Fixed penalties are 1 for home field, 10 for teams,
100 for players; a 120-day weight half-life and 730-day lookback are fixed in code.
Actual player minutes enter only completed training boxes conservatively available
8 hours after tip and strictly before the snapshot. Current-season and prior-two-season
public SportsDataverse NBA player-box releases are retained by URL/hash; invalid or
unidentified played-player boxes are excluded. A fit requires 500 games. Associations
can be confounded by role, teammates and game state; they are not causal injury values.
No historical target-game injury statuses are inferred from participation.

Reference rotations average the last five complete team games (minimum three, within
21 days), scaled to 240 team minutes. A player missing throughout that reference has
zero new missing minutes: long injuries are not charged twice. Out-only scenarios and
all subsets of up to eight unresolved recent participants are considered without status
probabilities. Remaining known recent players receive replacement minutes in proportion
to spare capacity, capped at 48 each; conservation and sufficient replacement history
are required. Point changes use player-coefficient differences between the scenario
rotation and reference. A moving player needs five training appearances and 100 minutes;
otherwise the value is unavailable, not zero. A listed Out contradicted by a later
appearance, stale report, missing identity or unknown status is not automatically valued.
The reported min/max is an envelope of these roster assumptions, NOT a confidence interval.
Single-player values are explicitly "out alone" and must not be added together.

The public history retains normalized source statuses, hashes and times for all four
sports and immutable NBA game scenarios/model versions. Evaluation selects the latest
eligible observation at least one hour before tip, rejects a model trained after its
observation, and compares baseline versus the fixed listed-out scenario on the same
completed games from public results artifacts. It never chooses whichever scenario
looked best after the result. A frozen baseline timestamp must also precede its observation. Baseline, scenario and
reference-market MAE are additionally reported on the identical priced subset with a
reference quote observed within three hours of the snapshot; missing/stale quotes stay
missing. Source medians are not guaranteed executable offers. The model version is fixed per evaluation cohort. No
promotion happens automatically; zero evaluated games is displayed honestly. A new
forecast-time injury evaluation needs at least 100 paired games and a separately
reviewed comparison against the baseline and market.

The app reads this artifact only via `getAvailabilityReport` / `getAvailabilityIndex`
in `src/lib/model-reports.ts`. `/injuries` displays league coverage, players, source dates,
rotation exposure, experimental values and evaluation. Card and Tonight carry separate
availability summaries by canonical event id. Missing/future or >3-hour-old snapshots
hide current point valuations and say to refresh. Player values remain separate from
headline margins, probabilities, leans, bet-prefill fields and stakes; the staking gate
is unchanged. Models links the live evaluation report. No bets database is accessed.

Availability history stays in git/CI and is excluded from application upload/server
traces; the app only needs latest.json and its precomputed evaluation. This keeps the
request bundle bounded as the prospective dataset grows.


### Inline prediction availability (2026-11-19)

AvailabilitySummary renders team/player statuses directly within Card picks and the
Tonight prediction decision panel, independent of whether a saved market exists.
Up to four players are shown per team (QB first, then recent rotation exposure),
with remaining reports expandable. Stale player statuses and contradicted Out reports
say to recheck; a stale/future/missing whole snapshot withholds current player details.
Report time uses an explicit Eastern timezone. Full report and search links are secondary.
This is presentation of the existing timestamped artifact, not a numeric injury
adjustment: margins, totals, probabilities, leans, betting terms and stakes are unchanged.


## User-enabled injury-adjusted projection variant (2026-11-20)

This supersedes earlier statements that injury values are display-only. At the owner's
explicit request, `availability/projection.py` writes a numeric `injuryAdjustedProjection`
for each next-game availability context. The UI reads and prominently displays this
spread/total variant. It does not train, add point values or overwrite baseline forecasts.
Baseline moneyline/cover probabilities, saved leans, locked cards, terms and stakes remain
separate and unchanged. This is experimental user-enabled output, not statistical
promotion of a validated betting model. No profitability or improved accuracy is claimed.

Margin stays `nba-minute-ridge-v1`. A separate `nba-total-minute-ridge-v1` fits actual
game total on positive home/away player minutes and team terms with an unpenalized
intercept, using the existing 730-day / 120-day-decay sample, 500-game minimum and fixed
team/player penalties. Margin differences cannot be reused as total effects. The same
conserved 240-minute replacement rotations are evaluated in each model. Team margin
changes subtract away from home; team total changes add together. Only listed Out
statuses change the point estimate. Uncertain players retain reference minutes there;
play/out combinations give scenario envelopes, not confidence intervals or probabilities.

A numeric projection requires NBA, matching event/team identities, complete scenario
coverage for both teams, finite baselines/changes, an available recognized model, current
observation and baseline forecast (<=3 hours), and a game that has not started. Model
training must precede observation; baseline generation cannot follow it. Unsupported
leagues and missing evidence get status unavailable with null values, never invented
zero-impact adjustments. Display expiry independently suppresses old/post-start numbers.
Existing long-absence, stale-status, identity and replacement-capacity safeguards remain.

The variant preserves both baseline values and the fixed deltas, scenario ranges,
observation time and model versions. It is rebuilt from the original baseline each
refresh, never from a previously adjusted number. No core report numeric field is replaced
by an injury number. Availability history carries the new fields immutably. Total
prospective evaluation is a version-separated cohort with actual total outcomes; old
margin-only snapshots cannot become total observations. Both cohorts retain one-hour
pregame cutoffs and identical-game baseline/market comparisons. Totals currently have
zero graded prospective games. The original margin cohort has nine and does not yet
improve MAE. A genuine historical injury backtest remains unavailable.


## Experimental fair-line lab (2026-11-19)

`python3 -m dirtiq_model fair_lines evaluate --input-dir <OOF-CSV-directory>
--as-of YYYY-MM-DD` writes `public/data/fair-line-report.json` and ignored detailed
CSV predictions in `data/fair-lines/`. It never writes the production sport reports,
ledger, cards, bet database or model fits. Contract/protocol: `docs/fair-line-protocol.md`.

The `fair_lines` package maintains separate offense/defense scoring states, with
Eastern-date result batching and season shrinkage. These are score states, not
possession/efficiency estimates. Independent and market-residual ridge candidates
are fitted strictly before the preceding calibration season; empirical residual
probabilities use only that calibration season; the next complete season is scored.
Push probabilities derive from integer outcome bins. Fitting, scaling, calibration
and evaluation have distinct time boundaries. No candidate is automatically promoted.

Report audit includes source CSV hashes, valid-game dates, exclusions and impossible
line counts. Every variant/market reports same-game MAE/RMSE, date-cluster paired
MAE intervals, no-push Brier/log loss, separate paired-price Brier, paper selections
and seasons. Missing totals prices use an explicit 50% benchmark and a separately
labelled -110 sensitivity. Consensus spread-price paper returns may also combine
books/lines; none establish exact-book executable ROI. The server reads this report
only through `getFairLineReport` in `src/lib/model-reports.ts`, shown on `/models`.

Existing Odds API calls still request only `h2h,spreads` with unchanged schedule/quota.
`consolidate` now retains legacy perBook plus validated `bookQuotes`: exact book,
market, coherent paired line/prices, market last_update (never replaced with the
book-level clock), and book clock for reference. The normalizer also understands
totals if supplied, but this change does not request a new paid market. Latest JSON
retains validated bookQuotes; legacy consensus and ledger-close behavior is unchanged.

At snapshot publication `fair_lines.quotes.archive` writes immutable content-hashed
pregame observations under `observations/book-quotes/<sport>/<date>/`. Each carries
retrieval time, source clock, freshness-at-observation (<=15 minutes), exact quotes,
and a frozen published baseline when a unique home/away/start match (within 60 seconds)
exists and its generation time precedes observation/start. Missing/stale clocks remain
explicit; missing/ambiguous/future forecasts are not attached. Post-start observations
are excluded. Observations are committed by the sports workflow for future offline
book-specific evaluation and excluded from Vercel deployment input. These observations
are baseline records, not live candidate forecasts or claimed profitable opportunities.
No historical named-book records are fabricated from old consensus-only snapshots.
