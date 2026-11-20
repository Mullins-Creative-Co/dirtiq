# NBA possession/efficiency candidate — frozen 2026-11-20

Goal: test whether lagged possession/efficiency information improves fair spread/total
pricing against the current model and closing market, then reject or shadow the candidate.
No card/stake/production changes from a favorable historical slice. Prior research
already examined these historical seasons: none is genuinely untouched external validation.

## Source and timing audit

Public SportsDataverse ESPN team boxes, 2016–2027, matched uniquely to cached ESPN
schedule by game ID, teams, final score and tip. NBA season denotes ending year. Keep
regular season/playoffs (types 2/3), completed finals with exactly two coherent team rows.
Reject duplicate conflicts, missing/negative/impossible counts, point sums inconsistent
with score, and missing/invalid period counts. Estimated possessions = average across
teams of FGA + .44*FTA - ORB + total_turnovers. This is an approximation, not play-by-play
possessions. Use total_turnovers (including team turnovers), never silently substitute
player turnovers. Regulation pace = possessions * 48 / (48 + 5*(period-4)).

All target features use results from earlier Eastern days, available at least 8 hours
after their tip. The 8-hour release delay is a conservative ASSUMPTION, not proof of
historical source availability. Retrospective files may include later corrections.
Capture source hashes/download dates and all exclusions. Audit the current player-box
files separately for identity/minute completeness, score/stat reconciliation and team
turnover differences. Historical injury/announced-lineup states are absent: exclude them
from this candidate instead of inferring them from target-game participation.

## One frozen candidate, two responses

State: opponent-adjusted offense/defense efficiencies per 100 estimated possessions and
team pace per 48. Fixed half-life 15 games; offense/defense allocate half the prediction
residual to each side. At a season transition, retain half the team deviation from the
league level. League offense/pace use alpha 1/500, initial 110 points/100 and 100 pace.
New teams start at the currently available league level. Rest uses Eastern dates capped
at seven; no current-game statistics enter prediction features. Reconstruct the existing
simple TotalsState in the same causal pass as a point-forecast baseline.

Features: efficiency-derived home margin and total, market disagreements, independent
OOF margin disagreement, offense difference, defense difference, pace difference from
100, rest difference/sum, both back-to-back flags, neutral site and minimum season games
(capped 20). Fixed standardized ridge alpha=100 predicts actual minus closing margin
or total. Fit only earlier seasons; calibration residuals only the immediately previous
season; evaluate the next season. At least 500 fit rows and 100 calibration rows.
No tuning/grid/side/month/threshold selection based on results.

Rolling folds from ending-season 2021 onward. Also one strict shared quarantine:
fit through 2023, calibrate 2024, evaluate 2025 AND 2026 with frozen coefficients and
residuals. State may update from earlier eligible results; outcomes never refit the
strict model. 2027 is incomplete and excluded from scoring.

## Metrics and decision

Same-game MAE/RMSE versus current stacked margin / reconstructed simple total and
closing market. Date-cluster paired MAE and Brier difference intervals (499 draws,
seed 20261120). Empirical integer-outcome residual bins give over/home-cover and push
probabilities; evaluate conditional no-push Brier/log loss. Spread benchmark uses paired
archived no-vig prices where valid, 50% otherwise; totals are a 50% reference because
side prices are absent. Show all seasons and both responses.

Fixed paper rule: conditional probability >=.55 for either side; use the corresponding
archived price or clearly separated assumed -110 sensitivity, require positive predicted
EV. Consensus historical line/prices may mix books; ALL such returns are paper returns,
never FanDuel/DraftKings executable ROI. No opener or named-book edge claim.

A candidate earns shadow consideration only if its strict two-season MAE and Brier
difference upper 95% bounds versus market are below zero in BOTH responses, with lower
MAE in both individual years. This is a deliberately fixed research screen, not proof
of profitable betting. Otherwise reject this version, publish the failure, do not retune
on the same quarantine. Any successful candidate still requires genuinely prospective
frozen forecasts and exact-book quotes/results/CLV before recommendation or staking.
