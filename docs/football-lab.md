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

Click **Load real NFL history** to load the bundled nflverse-derived archive. You can
also upload a pregame-feature CSV or load the clearly labeled synthetic demonstration.
Current sportsbook prices and injury/announced-starter feeds are not connected.
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

Each Wednesday–Tuesday UTC test block uses only games whose completion/availability
boundary is strictly before the earliest feature snapshot in that block. The default
fit uses only games with kickoffs in the preceding **two calendar years**. Training
observations have a 365-day exponential half-life, normalized to mean weight one.
Centering, scaling, and ridge regression all use those training weights only.
The archive can be longer than the model's training window. Training dates/counts are
included in every exported prediction. The same test games are used for all models.

The real archive contains 2021–2025. Default evaluation is 2023–2024; 2021–2022 supply
earlier history. The UI excludes 2025 from predictions unless the user explicitly selects
the final check or combined retrospective review. Once inspected, 2025 is no longer an
untouched holdout. Hyperparameters are not selected automatically, and repeated tuning
against evaluation results will overfit them. Per-season metrics expose instability.

All required columns:

| Column | Meaning |
| --- | --- |
| game_id | Unique game identifier |
| kickoff | ISO kickoff timestamp with timezone |
| feature_asof | Timestamp at which all inputs were available; strictly before kickoff |
| completed_at | Recorded completion or conservative availability boundary; after kickoff |
| home_team, away_team | Team identifiers |
| home_margin | Final home score minus away score |
| market_home_margin | Market-implied home winning margin, positive for home favorite |
| home_odds, away_odds | American prices for the two sides of that spread |
| off_epa_diff | Pregame home offensive EPA/play minus away |
| def_epa_allowed_diff | Pregame home defensive EPA/play allowed minus away; lower is better |
| home_field | 1 for home game, 0 for neutral; point value is learned |
| qb_epa_diff | Pregame home QB EPA/play rating minus away QB rating |

Missing values, nonfinite numbers, duplicate IDs/headers, inconsistent CSV rows, and
invalid timestamps are rejected. Upstream feature construction must exclude the game
being predicted and all future games. A timestamp cannot prove the underlying data
was actually available then; audit its provenance. See the reconstructed archive's
assumptions below. Opponent adjustment, weather, and injury feeds are not implemented.

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

## Rebuilding the real archive

```sh
python -m pip install -r scripts/football/requirements.txt
python scripts/football/build_history.py --start-season 2021 --end-season 2025
node --experimental-strip-types scripts/football/evaluate.mts
```

The ingestion script downloads schedules and season parquet files into the ignored
`.football-cache/`, aggregates offensive/defensive scrimmage EPA (excluding kneels/spikes),
and writes `public/football/history.json`. The public file is an intentional snapshot,
not a live feed. `--refresh` replaces cached inputs; otherwise reruns reuse them.
Checksums, build time, source URLs, coverage, and exclusions accompany the snapshot.
Every eligible game requires actual archived prices for both spread sides; missing
prices are excluded rather than filled with -110. The archived spread already uses
positive = home favorite; it must not be negated.

Features freeze on Wednesday 18:00 UTC. A prior game becomes eligible at kickoff +24h;
`completed_at` in this archive is that conservative boundary, not a recorded final
whistle. Team/QB EPA ratings use only earlier eligible observations within 730 days,
an eight-appearance half-life, and a 200-play zero-EPA prior. QB identity is the team's
last eligible game's dominant dropback passer; the target game's actual starter is
never inspected to choose the proxy. A switched or injured QB may therefore be missed.
The target game's plays and future outcomes cannot enter its aggregated features.

Historical EPA comes from the downloaded nflfastR model vintage, which may have been
trained/revised after the games. Features are reconstructed, not verified contemporaneous
snapshots. Source model-vintage leakage/revision effects are not solved by lagging the
aggregation. Likewise, archived spread/price timestamps and sportsbook identities are
not supplied. This is a retrospective research benchmark, not an executable historical
betting ledger. Do not describe its returns as a proven betting edge.

Default 2023–2024 results, before any parameter tuning, evaluated 570 games. All three
models had higher margin MAE than the market and negative benchmark returns. Avoid
selecting a strategy based on whichever isolated season happens to look favorable.

## Data sources

- Play-by-play and EPA: https://nflfastr.com/ and https://github.com/nflverse/nflverse-data/releases/tag/pbp
- Schedules/results/market fields: https://nflreadr.nflverse.com/reference/load_schedules.html
- Field definitions: https://nflreadr.nflverse.com/articles/dictionary_schedules.html

Verify each provider's sign conventions and usage terms during ingestion rather than
assuming they match this app. Do not mix football files into the existing racing
`data/` model artifacts or maintenance scripts.

## Verification

`node --experimental-strip-types --test tests/football-model.test.ts`

Also run `python -m unittest discover -s tests -p test_football_history.py`.

Tests cover incremental quarterback changes, odds settlement, CSV integrity, timestamp
validation, future-outcome leakage, regression direction, abstentions, rolling-window
exclusions, recency weights, evaluation-season separation, and ingestion timing. Type-check
the full app with `npx tsc --noEmit` and build with `npm run build`.
