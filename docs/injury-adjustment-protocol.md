# User-enabled injury-adjusted projections — 2026-11-20

The owner explicitly requested injury changes to predicted spreads and totals. This
adds a clearly experimental projection variant, not evidence of a profitable model.
Baseline predictions, probabilities, locked cards, stakes and personal bets remain intact.

Fixed method before new output inspection: retain NBA margin minute-ridge-v1 and its
replacement policy. Fit a separate total-points association with the same eligible
completed boxes, 730-day window, 120-day decay and team/player penalties. Total design
uses positive player minutes for both teams and an unpenalized intercept, unlike signed
margin effects. Estimate each team's replacement-induced change; subtract away from
home for margin, add team changes for total. Do not infer totals from margin coefficients.
Apply only listed Out statuses to the point estimate; enumerate unresolved-status
rotations as scenarios with no invented status probabilities. Preserve all existing
identity, freshness, replacement-capacity, minimum-history and long-absence safeguards.

Publish baseline + fixed listed-out change, plus scenario ranges and source/model times.
Missing/nonfinite/baseline timestamps after observation, mismatched event identity,
stale observations (>3 hours), model unavailable at observation or already-started games
withhold the adjustment. Never reuse a prior adjusted value as its baseline. The app
only reads numeric projections written by Python; it does not fit or add point values.

Validation: deterministic direction, separate margin/total effects, minute conservation,
no future training outcomes, stale/missing/cross-event rejection and baseline immutability.
Rerun the existing rolling prospective margin evaluation; add a version-separated total
cohort graded against fixed baseline and reference market on identical games. Historical
injury states cannot be reconstructed: no invented historical injury backtest. Prospective
sample sizes and lack of demonstrated accuracy improvement must stay visible. No new
betting confidence/probability, card-selection rule, automated stake or betting action.
