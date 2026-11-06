# Football Lab

Route: `/football`. Linked from the public Stats navigation and the control navigation.

This is a separate research workspace inside Dirt IQ. The football page imports only
`src/lib/football/model.ts`, its own workbench, and the shared navigation. It does not
import the racing database, load racing pickle files, modify racing model registries,
place wagers, or trigger racing refresh/training jobs. No dependency changes are needed.

## Matchup sandbox

Team power ratings are in points relative to average. The calculator assumes these
ratings **already reflect** their baseline quarterbacks. Its adjusted home margin is:

`home rating - away rating + home field + current QB difference - embedded QB difference`

Both QB differences are home value minus away value. Identical quarterbacks yield a
zero change. The full-QB-addition comparison is intentionally shown as a hypothetical
overlap, not a claim about how any sportsbook prices games. Inputs are illustrative,
not learned weights. Market home margin is positive when the home team is favored;
a sportsbook home spread of -3.5 is entered as +3.5.

Scenarios can be saved in the browser under `dirtiq.football.scenarios.v1` and downloaded
as JSON. They are not synced to an account or sent to the racing backend.

## Historical comparison

Upload a pregame-feature CSV or load the clearly labeled synthetic demonstration.
The app does not yet fetch NFL play-by-play, historical lines, or current sportsbook prices.
Synthetic results prove only that the workflow runs; the generator is deliberately
simple and is not evidence of a real market weakness.

Three variants predict final home score minus away score:

1. **Team EPA:** ridge regression on home-minus-away offensive EPA/play,
   defensive EPA/play allowed, and a home-field indicator.
2. **Team EPA + manual QB:** the same prediction plus a user-selected fixed
   coefficient times home-minus-away QB EPA/play. Default 35 is an experimental
   assumption, not a researched sportsbook coefficient.
3. **Joint fit:** ridge regression learns team and quarterback feature weights
   together. This can control overlapping signals but does not guarantee their
   separation, causal attribution, or better predictions.

Each Wednesday–Tuesday UTC test block uses only games whose recorded completion time
is strictly before the earliest feature snapshot in that block. Scaling and regression
use training rows only. The same held-out games are evaluated for all three models.
Hyperparameters remain fixed across a run. Reserve an untouched final season and choose
the settings using earlier development/validation seasons; the app does not automatically
create that final holdout or select hyperparameters.

All required columns:

| Column | Meaning |
| --- | --- |
| game_id | Unique game identifier |
| kickoff | ISO kickoff timestamp with timezone |
| feature_asof | Timestamp at which all inputs were available; strictly before kickoff |
| completed_at | Recorded game completion timestamp; after kickoff |
| home_team, away_team | Team identifiers |
| home_margin | Final home score minus away score |
| market_home_margin | Market-implied home winning margin, positive for home favorite |
| home_odds, away_odds | American prices for the two sides of that spread |
| off_epa_diff | Pregame home offensive EPA/play minus away |
| def_epa_allowed_diff | Pregame home defensive EPA/play allowed minus away; lower is better |
| home_field | 1 for home game, 0 for neutral; point value is learned |
| qb_epa_diff | Pregame expected home QB EPA/play minus expected away QB EPA/play |

Missing values, nonfinite numbers, duplicate IDs/headers, inconsistent CSV rows, and
invalid timestamps are rejected. Upstream feature construction must exclude the game
being predicted and all future games. A timestamp cannot prove the underlying data
was actually available then; audit its provenance. Pregame QB choice, opponent adjustment,
time weighting, weather, and injury feeds remain upstream responsibilities.

Errors are mean absolute prediction errors in points. A side is selected only when the
absolute prediction-minus-market gap strictly exceeds the chosen threshold. All bets
risk one unit at the imported price; pushes have zero net profit. ROI includes pushes
in units risked, while win rate excludes them. The displayed Wilson 95% win-rate
intervals assume independent observations and are descriptive, not a validated strategy
confidence interval. Football games and selections can be correlated. No cover-probability,
expected-value, or profitability claims are made from a point prediction alone.

Record sportsbook, line timestamp, source version, and acquisition time alongside the
upstream dataset. Closing lines are useful benchmarks but may not have been executable
at feature time. The importer evaluates the supplied line and cannot establish that a
historical bet was available. A future version can add timestamped odds snapshots and
closing-line-value measurement.

## Data sources to connect next

- Play-by-play and EPA: https://nflfastr.com/ and https://github.com/nflverse/nflverse-data/releases/tag/pbp
- Schedules/results/market fields: https://nflreadr.nflverse.com/reference/load_schedules.html
- Field definitions: https://nflreadr.nflverse.com/articles/dictionary_schedules.html

Verify each provider's sign conventions and usage terms during ingestion rather than
assuming they match this app. Do not mix football files into the existing racing
`data/` model artifacts or maintenance scripts.

## Verification

`node --experimental-strip-types --test tests/football-model.test.ts`

Tests cover incremental quarterback changes, odds settlement, CSV integrity, timestamp
validation, future-outcome leakage, regression direction, and abstentions. Type-check
the full app with `npx tsc --noEmit` and build with `npm run build`.
