# NBA possession candidate: findings — 2026-11-20

**Decision: reject this version. No production model or staking change.**

The owner asked for one disciplined test aimed at beating sportsbook prices. The method was frozen in `020cbd2`; implementation and synthetic tests were committed as `ca04409` before outcome evaluation. One candidate added lagged opponent-adjusted efficiencies and overtime-normalized estimated possessions to a closing-market residual model. Historical injury/starter/minute forecasts were excluded because those inputs lack verified pregame history.

## Fixed strict test: ending-seasons 2025 and 2026

Fit through 2023; calibrate on 2024; freeze the residual coefficients and calibration across both test years. Lagged states and the existing independent OOF input may incorporate earlier completed test-year results, as they would in an expanding live baseline. This is a frozen new residual layer, not a claim that every underlying input model is frozen. Prior studies already exposed these seasons: the test is a fixed quarantine, not untouched external validation.

| Market | Games | Existing baseline MAE | Candidate MAE | Market MAE | Candidate minus market, 95% date-cluster interval | Brier / benchmark |
|---|---:|---:|---:|---:|---|---|
| spread | 2628 | 11.2329 | 10.8301 | 10.8172 | +0.0129 [-0.0041, +0.0304] | 0.250601 / 0.249669 |
| total | 2628 | 14.9486 | 14.3721 | 14.3261 | +0.0460 [+0.0073, +0.0876] | 0.251250 / 0.250000 |

Lower error/Brier is better. The spread error interval crosses zero and spread Brier is worse. Total error and Brier are worse. The fixed screen fails. Improvement over the old independent model does not validate the possession features: the candidate uses the market as an input. The total baseline is a causal reconstruction of the simple production TotalsState on the audited history, not an archived live total forecast.

## Rolling comparison (2021–2026)

| Market | Games | Candidate MAE | Market MAE | MAE difference interval |
|---|---:|---:|---:|---|
| spread | 6705 | 10.6147 | 10.6031 | [-0.0054, +0.0263] |
| total | 6705 | 14.2479 | 14.1934 | [+0.0271, +0.0863] |

No post-hoc sport/month/side filter or penalty/threshold search followed the result. This version will not be retuned on the same quarantine. All season metrics, coefficients, calibration and paper selections are in `reports/nba-possession-study.json`. The strict spread paper rule selected 12 bets (6–6, −0.696 paper units); total sensitivity selected 132 (63–69, −11.727 at assumed −110). Historical consensus prices can mix books/lines; these are not executable FanDuel/DraftKings ROI.

## Input audit

- 13,053 eligible matched games across the available history; 700 overtime games normalized to 48-minute pace. Game/team identities, score sums and tip times are checked.
- The 2018 release has missing total team turnovers on 2,624 of 2,626 team rows. Those rows are excluded, leaving one eligible game that season; player turnovers are not substituted. Season carry accounts for elapsed years.
- 449 impossible historical spreads and 879 impossible totals are withheld in the joined sample. Both valid lines are required because both are pregame candidate inputs.
- Current player-box audit: 5,702 matched team-games; no played rows missing athlete IDs and no duplicate player keys. Seven score-sum mismatches; 609 minute sums differ by over one minute, eight by over five, five by over ten. Small minute discrepancies can be rounding. These player inputs were not used in the candidate.
- First-publication timestamps are unknown. The eight-hour result delay is an assumption; retrospective source revisions may remain. Current injury reports or target-game participation cannot supply historically announced starters or expected minutes.

## What changes next

The useful next work is evidence collection and input integrity, not another threshold search: investigate/quarantine material player-box inconsistencies, retain timestamped pregame expected minutes/availability, and deploy the already prepared exact-book observation infrastructure (PR #3) before claiming named-book results. The user-enabled live injury variant remains explicitly experimental and is not promoted by this study. This research does not change it.

## Reproduce

Sources: [SportsDataverse team boxes](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_nba_team_boxscores), [player boxes](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_nba_player_boxscores), and the existing NBA adapter schedule/OOF sources. Counts and exact input SHA256s are in the report. Possessions are a declared box-score approximation; [NBA glossary](https://www.nba.com/stats/help/glossary) provides the underlying statistic definitions.

Frozen input copies are retained locally under ignored `data/nba-possession-study/inputs/`, with a checked SHA256 manifest. Raw sources and detailed prediction CSVs are not committed or uploaded.

```sh
OPENBLAS_NUM_THREADS=1 python3 -m dirtiq_model nba_lab evaluate \
  --boxes data/nba-possession-study/inputs/boxes \
  --schedules data/nba-possession-study/inputs/schedules \
  --players data/nba-possession-study/inputs/players \
  --predictions data/nba-possession-study/inputs/predictions/nba-backtest-predictions.csv \
  --as-of 2026-11-20
npm run test:py
```

Validation: eight new synthetic tests; 181 Python tests pass on Python 3.9.6. No production data, credentials, bets database, UI, cards, locked terms or stakes were changed.


Post-evaluation compatibility correction: explicit `["select"]` column access avoids
a DataFrame method-name collision on the newer CI dataframe library. The synthetic
paper-return test reproduces that collision on the local runtime. This changes no
features, fits, calibration, selection rule or reported result; no quarantine retuning.
