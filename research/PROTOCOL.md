# Frozen protocol — 2026-11-13

Written before research outcomes are evaluated. Base: 56349ed. No product changes.

## Inputs and quarantine

Freeze copies of the four local OOF CSVs, cached adapter schedules/odds and published
fold hyperparameters under ignored research/output/inputs; record SHA256 manifests.
As-of date: 2026-11-13 Eastern. Exclude incomplete seasons: NFL/NCAAF 2026;
NBA/NCAAB ending-year 2027. Holdout: NFL/NCAAF 2024–2025, NBA/NCAAB 2025–2026.
Development is strictly earlier. No threshold/hyperparameter search on holdout;
run the holdout evaluation once after code and synthetic tests are frozen.
These seasons were already explored in the owner's November 13 study: quarantine
for this study does not make them genuinely never-seen external validation.

Fixed headline: independent NFL/NCAAF, stacked NBA/NCAAB, thresholds 2/3/3/3 points.
No market-aware predictions as independent features. Drop NON_D1 on either side,
nonfinal/unpriced/duplicate games, and rows with known |open-close| >8. Missing opens
are retained for closing-only experiments and their missing coverage is reported.
No new favorite/home/month/etc betting slices. November is used only for experiment 2.
Pushes excluded from cover/ROI denominators; stake one unit, win 100/110 units.
Use Wilson 95% cover intervals; normal z against exact break-even 11/21. A proposed
rule must exceed 52.4% in holdout and have positive ROI in strictly more than half of
reported OOS seasons. Mark z<3 as noise even if this necessary screen passes; none
of these marginal intervals correct for all correlated tests. Do not recommend a
card change from a single lucky slice. Report all outcomes, including null findings.

## 1 — Error anatomy

Hypothesis: specific teams and schedule contexts have higher excess absolute error.
Per priced game: abs(actual-model)-abs(actual+closing home handicap).
Development-only ranking, separately per sport and dimension, minimum n=100 games
(n=30 for team/conference). Dimensions: participating team, historical conference
when present, week since season's first game, minimum rest bucket (<=1, 1–3, 3–6,
>6 days), either-team back-to-back, abs spread (0–3, 3–7, 7–14, >14).
Top 10 by mean excess MAE per dimension, with n, a date-cluster bootstrap 95% CI
(499 resamples, seed 20261113), and fixed-headline pick statistics by season.
Team/conference participation counts a game once per participating group; do not
pool these duplicated group rows. Never rank on holdout. Conference/travel metadata
must be historical; unknown is explicit, not today's alignment backfilled.

## 2 — Early-season carry-over, NCAAB then NCAAF

Hypothesis: retaining at least 90% of last season's rating lowers November MAE.
One fixed prior-only intervention: at the test-season transition replace fitted
season_reversion by min(fitted,0.10), preserving all other earlier-season-fitted
hyperparameters. Reconstruct the original filter on prior seasons, then evaluate
an original and modified independent filter on the same November games, with daily
result batching. No tuning. This is a filter ablation, not a refitted stacked/card
model. Report both MAE and threshold-pick metrics and paired daily-bootstrap MAE CI.
Use at least the original warm-up period; never fit hyperparameters to test results.
Roster extension gate: only use freely reproducible, historically dated preseason
rosters/returning minutes for all evaluated seasons. Season-ending rosters and
current rosters do not qualify. If no such source can be verified, stop the roster
extension and explicitly report that the full roster-conditioned experiment was
not testable. Do not infer continuity from future minutes or transfers.

## 3 — Opening-line rule

Fixed rule, no grid: choose sign(model+open); require |model+open| >= 1.5 times the
sport's threshold and move toward that side <=0.5 point at decision time.
Opening and closing snapshots have no intermediate timestamped prices, and OOF
predictions are game-day predictions, not timestamped opener-time forecasts.
Therefore do NOT claim an executable bet-at-open test. Report one explicitly
counterfactual open-price sensitivity using the known close as the checkpoint;
report CLV and per-season open-price cover/ROI, alongside the executable near-close
price version of the same predeclared screen. The open-price/skip variant has timing
leakage and cannot qualify as evidence of an edge. A prospective test needs stored
opener-time predictions and a timestamped decision-time quote.

## 4 — Market-miss model

Hypothesis: market error is predictable from strictly pregame information.
Fixed L2 logistic regression C=1, StandardScaler, max_iter=2000, no tuning; fit per
sport with expanding seasons, starting at its existing first OOF season when at
least two preceding OOF seasons and 200 training games exist. Frozen train statistics
for all imputation/scaling. Features: headline disagreement, predictive SD (available
proxy for uncertainty; not pure team-rating SD), home/away rest and back-to-back,
neutral flag, week; log(1+travel km) from last known same-season venue where historical
venue/city coordinates exist, plus missing flags. No actual travel itineraries or
current geographic team alignment. No postgame rankings, scores, attendance or closes
from other future games. Missing travel in football => explicitly reduced model.
Binary target: home covers close; discard pushes. Prediction rule p>=0.55 home,
p<=0.45 away, otherwise pass. Compare Brier/log loss with p=0.5 on identical games,
and record -110 ROI, Wilson interval, fixed-rule picks by season. Holdout 2nd season
may train on 1st season's completed results, as in rolling deployment, with all rules
frozen. Also report a strict joint two-year holdout with both models trained only
before either held-out season; use this strict evaluation for the acceptance screen.

## Outputs

research/FINDINGS.md is the one-page summary. Full per-season metrics, rankings,
coverage, hashes, and source audit go to ignored research/output/results.json and
research/output/DETAILS.md. No raw or derived data files are committed or pushed.
Scripts and protocol are committed to research/spread-market-study only; never main.
