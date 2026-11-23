# Historical model audit — November 23, 2026

**All four baseline models trail the closing market on the same games. College basketball is closest to break-even; college football is not historically profitable. No production forecast or stake changed.**

This is a new reproducible diagnosis of the frozen November 18 rolling-prediction CSVs, not a new untouched validation. NBA/NCAAB ending-seasons 2019–2026 and NFL/NCAAF calendar-seasons 2015–2025 are included. Current partial seasons, pooled NON_D1/FCS opponents, missing and impossible spreads are excluded. The exact per-sport source hashes and exclusions are in the adjacent JSON. The historical headline is stacked for basketball and independent for football; current experimental injuries and the separate NFL workbench are not evaluated.

## Same-game results

Each spread MAE uses identical games. A smaller number is better. Selections use the existing threshold and four-times-threshold cap; pushes are excluded from cover rates. Prices are archived consensus side prices and paper ROI, not verified executable offers at a named book.

| Sport | Games compared | Model MAE | Market MAE | Selected W–L–push | Cover rate | Mean predicted cover* | Paper ROI |
|---|---:|---:|---:|---:|---:|---:|---:|
| NBA | 9,723 | 10.824 | 10.409 | 1708–1731–34 | 49.67% | 64.82% | -5.14% |
| NFL | 3,028 | 10.168 | 9.807 | 658–669–32 | 49.59% | 61.98% | -3.95% |
| NCAAB | 41,662 | 9.057 | 8.797 | 5109–4894–94 | 51.07% | 65.79% | -2.59% |
| NCAAF | 8,141 | 12.925 | 12.298 | 1703–1864–61 | 47.74% | 63.15% | -9.69% |

*Predicted cover is conditioned on a non-push outcome and averaged over decided selections. This is a diagnostic of the historical raw probabilities, not a currently validated betting probability. Exact selected counts and priced subsets are in JSON.

## What is actually going wrong

1. **Winning a game and covering a line are different objectives.** `choose_headline` in `dirtiq_model/teams/backtest.py` selects the headline using moneyline log loss. It does not require spread calibration, positive price-adjusted returns, or superiority to the market. Good winner prediction is insufficient for spread recommendations. The same-game paired-moneyline audit also trails the market in all four sports. Full-dataset college winner metrics can look better simply because they include more easy, unpriced games.

2. **Raw cover probabilities are overconfident at the offered line.** The selected-side averages above are far above observed cover rates. Conditioning the evaluation on disagreement with a stronger market is crucial: general margin residuals and winner calibration do not establish selected-bet calibration. The stack also constructs its residual distribution from its own fitted training residuals (`fit_stack`); a separate forward calibration stage is warranted. This is an implementation fact and a candidate contributor, not a quantified causal explanation of the entire gap. The current card already calls these probabilities uncalibrated and keeps evidence-failing picks unstaked.

3. **Underdog bias is structural, not a newly discovered betting angle.** Margin compression versus the market produces many underdog selections. The figures below describe these saved forecasts. A regression of actual-minus-market margin on model-minus-market margin is descriptive only: 1 would support the full disagreement; 0 means no average linear correction. It is not a fitted live betting weight.

| Sport | Underdog share of selections | Model / market margin SD | Disagreement slope |
|---|---:|---:|---:|
| NBA | 86.8% | 0.831 | +0.001 |
| NFL | 74.0% | 0.907 | -0.003 |
| NCAAB | 65.6% | 0.957 | +0.067 |
| NCAAF | 60.6% | 0.967 | -0.048 |

4. **Available production features leave material information out.** The baseline learned layer has rating difference/uncertainty, rest, back-to-backs, recent scheduling, a starter adjustment where available, and site. It has no verified historical pregame NBA expected minutes/rotation, NFL confirmed QB and supporting-lineup scenarios, or timestamped forecast weather in this baseline audit. Missing information is a plausible reason to trail the market; this study does not measure the isolated impact of each missing feature. A separate NFL EPA/QB workbench exists and must not be confused with the card baseline or have its reserved final test consumed by this audit.

5. **Quote integrity can manufacture an apparent edge.** The Mercyhurst home/away reversal was a real current-quote bug, now fixed by team-ID alignment. Older caches do not consistently retain identities and publication times, so this history is not certified free of those issues. Previous possession research also quarantined impossible lines and player-box inconsistencies. No result above proves a particular historical miss was a mapping error. Exact-book collection now supplies prospective evidence; historical consensus ROI is not a claim of beating FanDuel or DraftKings.

6. **The usual quick fixes already failed or lack evidence.** Earlier form/rest/spread-size corrections and score-state candidates did not establish market superiority. The frozen NBA possession candidate improved over the independent baseline but still trailed the market and was rejected (research branch findings dated November 20). More features alone do not establish an edge. Removing early-season games is not supported by this diagnostic: early selected cover rates exceed later rates in all four sports. These are descriptive slices, not newly selected betting rules.

## Repair sequence and acceptance criteria

1. **Certify evaluation inputs first.** Audit historical event/team identities, home/away orientation, results, price/line pairing, provider, and as-of timestamps. Quarantine unverifiable records and publish counts. Keep original personal bets and locked terms unchanged. Rebuild a full rolling evaluation only after changes to the inputs or model, rather than relabeling the old evaluation as clean.

2. **Separate the objectives.** Evaluate game-winner probabilities, fair spreads/totals, and price-specific betting decisions independently. Require same-game market comparisons and strictly earlier calibration. Select/freeze a candidate before looking at its evaluation period. Moneyline log loss alone cannot authorize a spread-model promotion.

3. **NBA first: verified pregame player impact and expected minutes.** Continue timestamped availability/rotation collection and material player-box reconciliation. Compare a single frozen candidate against the current baseline and the actual book line on identical games. Do not retune the rejected possession candidate on the same inspected seasons.

4. **NFL: reconcile QB/team context and forecast timing.** Use the existing separate EPA/QB research, verify expected starter provenance and weather-forecast availability, and evaluate the intended quote time. Preserve its reserved final experiment until explicitly authorized; this audit does not run it. Treat key-number cover and push probabilities separately from continuous margin error.

5. **College: retain as research, then improve priors/context.** NCAAB is closest, but roughly 51% cover does not clear typical -110 costs (52.38% break-even). Test roster/conference carry and schedule/neutral-site handling with verified as-of inputs. CFB requires an actual accuracy improvement before increasing selection volume. Pate ratings may be a dated external benchmark, but ordinal ranks are not point spreads and cannot be treated as numeric team-strength gaps.

6. **Promote only with prospective evidence.** Report paired MAE/Brier and calibration, actual coherent-book prices, closing-line value and uncertainty around returns. Define the sample/stopping rule in advance. Keep unproven probabilities and $1 tracking separate from evidence-based stakes. No threshold search, hand-set blend, staking change, or promise of profit follows from this report.

## Reproduction

```sh
OPENBLAS_NUM_THREADS=1 python3 scripts/research/historical_model_audit.py \
  --input-dir /path/to/frozen/data/sports \
  --output docs/historical-model-audit-2026-11-23.json
OPENBLAS_NUM_THREADS=1 python3 -m unittest discover -s tests -p test_historical_model_audit.py
```

The script fits no candidate and searches no threshold. Date-bootstrap MAE intervals and Wilson cover intervals are descriptive, not adjusted for all prior research. No credentials, production personal-bet database, historical stakes, or locked card records were read or changed.
