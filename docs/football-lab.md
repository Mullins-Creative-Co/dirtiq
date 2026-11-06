# Football Lab

Route: `/football`. Linked from the public Stats navigation and the control navigation.
The default QB & supporting team tab tests the team-versus-quarterback attribution
hypothesis. Overlap audit tests repeated-adjustment mechanisms; Research results
retains the broader incremental-information study.

This is a separate research workspace inside Dirt IQ. The football page imports only
its own football modules and reports, its workbench, and the shared navigation. It does not
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

The original three variants predict final home score minus away score:

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

The real archive contains 2021–2025. Development uses 2023–2024 and 2025 weeks 1–9;
2021–2022 supply earlier history. The final check uses 2025 week 10 onward (including
playoffs), with training cutoff fixed to the earliest week-10 feature snapshot. This
freezes coefficients, centering/scaling, sample weights, and the two-year training set.
Later pregame features may update using games already completed; no second-half outcomes
enter parameter fitting. This is frozen-model sequential prediction, not a simultaneous
week-9 forecast of every later matchup. The final check is explicit in the UI and has
not been run by the development report. Once inspected, it is no longer untouched.
Development periods have been examined and must not be advertised as an untouched test.
Hyperparameters are fixed, not selected automatically. Per-period metrics expose instability.

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
assumptions below. Opponent adjustment is implemented. Verified injury/announced-starter,
weather-forecast, and odds-movement inputs are not enabled.

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
python scripts/football/audit_inputs.py
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

The original 2023–2024 baseline evaluated 570 games; the expanded development study evaluates 705. All three
models had higher margin MAE than the market and negative benchmark returns. Avoid
selecting a strategy based on whichever isolated season happens to look favorable.

## Additional predictors and research protocol

### Controlled overlap audit

Run `OPENBLAS_NUM_THREADS=1 python scripts/football/overlap_audit.py` to rebuild
`public/football/overlap.json`. It uses existing pregame features and seven fixed cases:
team EPA/QB, EPA/protection, EPA/turnovers, adjusted EPA/another schedule correction,
home-aware baseline/another home indicator, total EPA/pass-run efficiency, and current
rest as a comparison input that is not explicitly duplicated in the baseline.

For each two-year training window, fit the baseline with weighted ridge (alpha 20,
365-day recency). Independently fit the signal's standalone centered points effect.
The **full-add stress test** adds that effect to the baseline, without another intercept.
This is deliberately constructed and is not a reconstruction of a sportsbook model.

To form the **new-only** alternative, standardize inputs using training-only weighted
moments, then project the signal onto baseline inputs with weighted SVD/OLS. Learn the
baseline outcome residual using only the unprojected signal, with the baseline fit
held fixed. Residual columns with weighted variance <=1e-10 are dropped, so exact
duplicates are not amplified by rescaling numerical noise. The new-only stage does
not rescale a tiny residual variance to one. No target/future outcomes enter fitting.

Held-out signal R-squared measures statistical predictability from baseline inputs;
it is not a percentage of causal player value already charged. Statistical correlation
does not establish double counting. In unregularized linear regression, partialling
out variables produces the same joint-model predictions (tested explicitly); mere
reparameterization cannot create an edge. This pipeline changes the constrained
additive estimation procedure and must earn its improvement on later games.

The audit uses 705 development games and fits by the actual common feature-snapshot
cutoff. This differs slightly from the broader workbench's earliest-cutoff weekly
grouping for unusual schedules; compare forecasts within the same audit. Baseline,
full-add, and new-only always share identical test games and training windows.
The half-2025 holdout is removed before even validating or fitting audit rows.

There are three fixed checks per case: new-only MAE against full-add, new-only MAE
against baseline, and market-error alignment. The directional diagnostic selects
only corrections of at least one point, using the sign of new-only minus full-add,
and then measures actual-minus-market margin in that direction. It is not a full
bet-selection/expected-value rule. Approximate weekly-snapshot block bootstrap
intervals use 4,000 draws and a 21-comparison adjustment. Earlier research/feature
selection is not covered by this family adjustment, so the final holdout remains
necessary. Candidate status additionally requires repetition in 2024 and 2025 weeks
1–9 and at least 50 selected sides. No current case qualifies.

Prediction examples are the five largest forecast differences chosen without using
their game outcomes. They expose baseline, standalone extra adjustment, projected
standalone component, and newly learned remainder adjustment. These are statistical
components, not causal QB/line/schedule point values. The exact-home-column control
returns to baseline; rest is not forced to appear redundant. The audit finds ways
our constructed full additions can damage forecasts, but no repeatable directional
market edge. Do not infer that a bookmaker makes those same additions.

The queue includes injury/absence, weather-baseline/extra-weather, and fatigue/rest
overlap. These remain blocked by point-in-time data or an explicit baseline definition,
and are not silently modeled as zero adjustments. Test with
`OPENBLAS_NUM_THREADS=1 python -m unittest discover -s tests -p test_football_overlap.py`.

`src/lib/football/model.ts` defines ten fixed variants: the original three, opponent-adjusted
EPA, four separate additions (rest, protection, turnovers, and pass/run matchups), full
context, and a market-anchored residual model. The new columns are optional in imported
CSVs; a variant is enabled only when all its features are present and numeric for every row.
No missing context is silently filled with a zero. The bundled archive has full context.

Opponent adjustment fits historical team-game EPA to jointly estimated offense and opposing
defense coefficients, weighted by plays and 365-day recency, with a 400-play ridge prior.
Only eligible previous observations within 730 days are used. These opponent ratings are
rebuilt at each pregame feature cutoff and never use target/future results. Negative defense
coefficients indicate lower EPA allowed. Rest is capped at 14 days per team. Protection uses
the union of sack or QB-hit events per dropback, not a direct line rating. Turnovers use the
union of interceptions or lost fumbles per eligible play and a forced-minus-committed rate.
An event tagged as both a sack and a hit is counted once. Pass/rush matchup features combine
past offensive and opposing defensive efficiencies with past dropback tendencies.

These signals overlap by construction; joint regularized weights and incremental tests
measure whether added information helps, rather than assuming every addition is independent.
The residual model learns `actual home margin - quoted market margin` on earlier rows and
adds its prediction to the target quoted line. It is research only because the exact line
snapshot time is unavailable. No sportsbook model is reverse engineered or assumed here.

The reproducible report, `public/football/research.json`, is generated by `evaluate.mts`.
It evaluates 705 development games across ten models. All use the same game set and settings
(minimum 80 training games, ridge alpha 20, two-year lookback, 365-day sample-weight half-life;
manual-QB diagnostic weight 35; selection threshold 2 points). There is no parameter grid
search or betting-filter mining. No added predictor has established an improvement here.
Market MAE is 9.852 points; the best model, Market anchored, is 9.903. Do not tune the final
holdout to reverse this result.

Each model is compared against its parent: QB additions versus raw team EPA; opponent
adjustment versus the joint fit; further context against opponent adjustment; market residual
against the quoted market. Confidence intervals use 4,000 fixed-seed paired weekly-block
bootstrap draws and a Bonferroni-style family adjustment for nine comparisons (about 99.4%
individual intervals). This is an approximate conservative diagnostic, not a guarantee against
all temporal dependence or feature-selection bias. A candidate increment must have a fully
negative interval and lower error in both 2024 and first-half 2025. It still is not a betting edge.

The QB/supporting-team table tests a fixed descriptive hypothesis. Stronger teams have positive
pregame opponent-adjusted net EPA. QB values are split at the median of earlier pregame QB
ratings in the prior two years. Both team sides can contribute to the four exhaustive buckets;
counts are team sides, not independent games. Mean actual-minus-market margin and cover records
are shown by period. No bucket is chosen because it happened to win, and there is no second-half
2025 result in this table. The currently observed stronger-team/lower-QB group covers 47.4%
(63–70 with 5 pushes), which does not support an automatic betting rule.

The input audit downloads injury archive metadata into `public/football/readiness.json`.
The checked 2024 archive has 6,215 modification-timestamped reports, but their prediction-time
availability still needs validation. The 2025 archive has 6,068 reports with no modification
or publication timestamp. Neither enters the model. Do not infer healthy rosters from missing
data or substitute realized game weather for a pregame forecast.

## Data sources

- Play-by-play and EPA: https://nflfastr.com/ and https://github.com/nflverse/nflverse-data/releases/tag/pbp
- Schedules/results/market fields: https://nflreadr.nflverse.com/reference/load_schedules.html
- Field definitions: https://nflreadr.nflverse.com/articles/dictionary_schedules.html

Verify each provider's sign conventions and usage terms during ingestion rather than
assuming they match this app. Do not mix football files into the existing racing
`data/` model artifacts or maintenance scripts.

## QB versus supporting team decomposition

The default tab is now **QB & supporting team**; the overlap audit remains available.
This directly tests the conversation's attribution hypothesis, rather than assuming
bookmakers literally apply a duplicate penalty. Reproduce with:

`OPENBLAS_NUM_THREADS=1 python scripts/football/decomposition.py --cache ../nfl-cache`

The script filters the schedule to development games before selecting play rows.
No 2025 week-10-or-later plays or scores enter fitting, rankings, or evaluation.
At each pregame snapshot, the preceding 730 days of completed games fit joint
dropback EPA/play associations for QB, offensive team passing support, and opposing
pass defense. QB scrambles count with dropbacks. Non-QB rushing has separate team
offense/defense associations. Net possession-perspective special-teams EPA counts
for both sides, with opposite signs, and is shrunk toward zero using eight prior
games. Defense combines 60% pass and 40% rush prevention. All fits weight observations
with a 365-day half-life; normal play fits also weight by play count.

Team/QB associations are partly confounded. Team and opposing-defense ridge priors
are 400 play-equivalents. The primary QB prior is 400; fixed sensitivity priors are
100 and 1600. When a team and QB always appear together, the priors determine the
allocation; the model does not causally isolate receivers, protection, coaching,
or individual player value. Substitutions and transfers provide comparison data,
not random assignment. Example cards show QB history and alternate-QB dropbacks.

For each team, the expected-QB proxy is the dominant dropback passer in its last
available game, chosen without reading target-game participation. A separate
post-prediction diagnostic compares this with the eventual dominant passer, not
the announced starter. It never changes forecasts or filters the selected games.
Live betting readiness still requires timestamped lineup confirmation.

Supporting-team rank is a fixed blend: .6 passing support + .4 rushing strength +
defense prevention + special-teams EPA/game divided by 65. This approximate scale
is a hypothesis definition, not an optimized scoring formula. QB and support ranks
are calculated across available league teams at that snapshot. Two rules are fixed:

- Back middle-50%-QB / top-25%-support teams.
- Fade top-25%-QB / below-median-support teams.

Omit a game when both sides qualify for the same rule. Report all qualifying games,
not just those with a positive fitted-model edge. Hypothetical ROI risks one unit
per game at archived American odds, includes pushes, and is not executable historical
performance because odds snapshots are not timestamp-aligned with Wednesday inputs.
The separate margin regression learns six component weights from strictly earlier
pregame rows; a three-input opponent-adjusted team-EPA baseline uses the identical
game set. Neither forecast uses market lines as inputs. A 730-day window here is
slightly different from the older audit's two-calendar-year window, so baseline
MAEs across different reports should not be directly compared.

There are 705 development games. Primary split-model MAE is 10.314 versus baseline
10.295; the improvement interval crosses zero. Primary average-QB/strong-support
results are 59–46–4 (56.2% non-push covers), with hypothetical 7.2% ROI and a mean
signed market error of +3.11 points. Its adjusted market-error interval spans zero.
The 100/1600 sensitivity cover rates are 55.1%/58.5%; the 1600 case has a positive
market-error interval but is not substituted for the primary assumption. Reverse
hypothesis results are not supportive. These are provisional development findings,
not proof of bookmaker behavior or a validated betting rule.

Intervals use 4,000 fixed-seed weekly-block bootstrap draws and nine primary
comparisons (three priors × MAE improvement and two directional-market-error tests).
ROI intervals are descriptive. Earlier project exploration is not covered by this
adjustment. Neither the method nor a strategy is frozen for promotion, and the final
2025 sample remains unrun.

Run all Python football checks with
`OPENBLAS_NUM_THREADS=1 python -m unittest discover -s tests -p 'test_football*.py'`.
They include switch identification, explicit prior sensitivity without switches,
snapshot timing, outer-model leakage, group selection and juice, and holdout exclusion.

## QB news versus line movement

The **QB news & line movement** tab implements a separate event-study importer,
not a completed historical backtest. The bundled nflverse archive does not contain
linked announcement timestamps and same-book pre/post-news spread snapshots.
No historical provider credential is configured. The Odds API documents five-minute
historical snapshots from September 2022 on paid plans:
https://the-odds-api.com/historical-odds-data/. No paid request or subscription was made.
An independently sourced, point-in-time QB announcement/observation timeline is still
needed even when odds history is available.

The module `src/lib/football/qb-movement.ts` accepts a JSON array of sourced events.
Each event records the old/new QB, changed side, kickoff, announcement/observation
times, frozen model version, baseline and revised-estimate availability, signed
home-margin QB/other changes, same-book spread/prices/update/snapshot timestamps,
and provenance strings. Result and result-availability timestamp are optional.
Input provenance is user-supplied and not independently authenticated by validation.
The importer checks all records atomically, forbids duplicate games and fictional
example identifiers, and excludes 2025 week 10 onward/later seasons before reading
their quotes, model inputs, or results. Files are not uploaded or persisted.

The decision is fixed at 30 minutes after observing the announcement. The pre-news
snapshot must be strictly before publication and no older than 60 minutes; baseline
model inputs must be available by that snapshot. The post-news snapshot must be in
the final 10 minutes before the decision, with a quote update after news observation.
Both quote updates must precede their snapshot by at most 10 minutes. Parameters must
be frozen before news, the revised model estimate available by decision, and the
decision strictly before kickoff. These windows are fixed research definitions.

All quantities use positive home winning margin, not sportsbook home-handicap signs:

- Market move = post-news home margin − pre-news home margin.
- QB-only movement gap = modeled QB change − market move.
- Final model edge = pre-news model edge + QB change + other changes − market move.

The pre-news edge matters: a QB downgrade of four versus a six-point market downgrade
creates a +2 movement gap, but an existing −5 home edge leaves a final −3 home edge.
Thus the fixed research selection uses absolute **final** edge >=2 points and requires
other news marked reviewed. It does not bet automatically or select on movement size.
Unsettled selections do not enter cover rate/ROI. Settlement risks one unit at the
selected side's actual post-news American odds; pushes return zero. The fictional
example is explicitly labeled, unsettled, kept separate, and never historical evidence.

Anticipation, simultaneous news, stale/limited availability, and selection bias still
prevent causal interpretation. Timestamp validation does not establish executability,
correct model estimates, an actual market overreaction, or repeatable betting value.
The final 2025 holdout remains unrun; no inferred timestamps or fabricated outcomes
fill the data gap.

Run `node --experimental-strip-types --test tests/football-qb-movement.test.ts` for
signs, prior-edge accounting, availability checks, frozen parameters, abstentions,
odds settlement, duplicate exclusion, and final-test protection.

## All verification commands

`node --experimental-strip-types --test tests/football-model.test.ts tests/football-research.test.ts`

Also run `python -m unittest discover -s tests -p test_football_history.py`.

Tests cover incremental quarterback changes, odds settlement, CSV integrity, timestamp
validation, future-outcome leakage, regression direction, abstentions, rolling-window
exclusions, recency weights, evaluation-season separation, and ingestion timing. Type-check
the full app with `npx tsc --noEmit` and build with `npm run build`.
