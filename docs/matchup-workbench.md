# Unified matchup workbench

Route: `/matchups`. Linked from the public Stats navigation, shared workspace navigation,
and NFL/NBA research pages. The racing models, database, research artifacts, frozen trial,
and separate lineup challenger remain unchanged.

## What is connected

- One shared forecast contract and result renderer for NFL, NBA, college football and
  men's college basketball. Sport-specific research is retained; there is no claim that
  pooled football/basketball coefficients have been trained or validated.
- Date and team lookup through the public ESPN scoreboard. This is schedule-only, with
  a fixed league allowlist, validated dates, an eight-second timeout and short cache.
  ESPN odds, scores, actual lineups and player participation do not become model inputs.
- The bundled frozen NFL trial forecasts, including their original margin distributions.
  These distributions can evaluate a different exact spread while preserving integer
  scoring margins and pushes. This is a research scenario, not a newly frozen forecast.
- The first five chronological primary NBA efficiency examples from the development
  report. Missing dates, book identities, prices and usable probabilities stay unavailable.
- Manual baseline/quote inputs for any supported sport; one final point forecast and
  optional independently sourced, conditional-on-no-push cover estimate.
- Browser-local saved scenarios (20 maximum, repeated save replaces that matchup) and
  JSON result download. Neither action changes the trial ledger or places a wager.

## Forecast rules

All margins mean home score minus away score. A home-favorite book handicap is negative.
Projected home handicap is minus projected margin. Disagreement in points is projected
margin plus the book's signed home handicap. The gap is never converted to a probability.

Only adjustments marked **new** are applied. Each needs points and a reason. Included
inputs are not added again; unknown inputs are explicitly unknown. Duplicate effect IDs
are counted once and conflicting duplicates are errors. A new adjustment invalidates
cover/push calculations from an unchanged frozen distribution, even if the net adjustment
is zero. It does not retrain or recalibrate the distribution.

Cover probabilities exclude pushes. Distribution push mass is shown separately. Manual
probabilities do not imply zero push probability. American price break-even uses each
side's price; the proportional no-vig reference requires a spread and two opposite prices.
Book/time/source fields are user-attributed, not independent quote verification.

Changing a team clears its bound baseline, quote and probability. Baseline, spread or
adjustment edits clear manual probability. Every edit clears the displayed run until the
user reruns. Cancelled lookups and late responses cannot replace a newer sport/date search.

## Current limits

Current-game trained baselines, verified announced lineups, player replacement estimates
and live sportsbook quotes are **not connected**. Selecting today's scheduled game often
shows **Model inputs needed**. NFL and NBA examples are dated research data, not today's
picks; college options support schedule lookup and manual scenarios without pretending a
live sport model exists. The NBA development probabilities are deliberately withheld.

This is the unified UI and inference contract, not completion of live multi-sport model
training or evidence of a profitable edge. No holdout outcomes are opened and no new
forecast is written into a frozen trial.

## Verification

- `npm run test:matchups`: model sign conventions, finite input validation, exact spread
  push settlement, duplicate-safe adjustments, missing data, bundled forecast parity,
  schedule parser validation and catalog provenance.
- `node --experimental-strip-types --test tests/*.test.ts`: all TypeScript tests.
- `python -m unittest discover -s tests -p 'test_*.py'` with project dependencies installed.
- `npx tsc --noEmit`, changed-file ESLint and `npm run build`.
- React DOM interaction checks exercised archive loading, repeated run/save, sport/team
  changes, manual scenarios, probability invalidation, cancellation races, upstream errors
  and empty results. Production browser checks also verified NFL forecast runs, NBA missing probabilities,
  sport switching and current schedule selection. Local preview access was unavailable;
  protected-preview access was not changed. Mobile viewport visual QA was not performed.

Full repository lint currently has an unrelated existing unescaped apostrophe in
`src/app/odds/world-100/page.tsx` and an unused-variable warning in the race scorecard.
