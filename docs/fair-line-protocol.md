# Fair-line lab protocol — frozen 2026-11-19

Purpose: test richer score forecasts and market residual forecasts for NCAAF, NCAAB,
NBA and NFL, without changing production predictions, card rules, manual $1 logging or bets.
Prior studies already exposed these historical seasons. This is historical model
comparison, never an untouched external holdout or evidence of beating a named book.
The prior spread-market research branch and docs/tested-hypotheses.json were reviewed.

Fixed candidates, no outcome-driven grid:
- Separate team offense/defense scoring states, league scoring level and home scoring
  advantage. Update each score residual with half allocated to offense and half to
  opponent defense; gains use the existing sport totals half-lives (15/10/8/6 games).
  Season carry 0.5. League prior: 100 games at 110/70/22/28 points per team for
  NBA/NCAAB/NFL/NCAAF. No possession data exists in these inputs; do not call this pace.
- Independent ridge predicts actual margin/total from this score forecast, the saved
  rolling independent spread forecast (spread only), neutral site and schedule rest.
- Market-residual ridge predicts actual minus closing margin/total from the same
  pregame score information expressed as disagreement with market, plus the line.
  The closing line is a near-close benchmark, not an executable earlier quote.
- Ridge alpha 100 after training-only scaling; at least 200 training games. Fit only
  seasons strictly earlier than the calibration season; calibrate empirical integer
  outcome distributions on the immediately preceding complete season, then evaluate
  the following season with frozen coefficients/residuals. At least 100 calibration
  games. Score states may update only with results from earlier Eastern calendar days.
- Exclude nonfinal, noninteger/negative scores, duplicate IDs, pooled NON_D1/FCS
  opponents, missing starts and incomplete seasons. Conflicting duplicate identities
  fail closed. Remove impossible line ranges; retain and report missing prices.
- Same-game MAE/RMSE, conditional-on-no-push Brier/log loss; market probability is
  paired no-vig spread price when present, otherwise explicitly a 50% benchmark.
  Totals prices are absent from the CSV: 50% is a benchmark, not priced market Brier.
- One fixed paper selection per candidate: conditional side probability >=0.55;
  projected EV >0 at the archived side price where present. Missing prices get a
  separately labelled -110 sensitivity, never executable ROI. Count pushes, stake
  and win/loss separately; report actual-price and assumed-price subsets.
- Paired MAE difference intervals: 499 Eastern-date-cluster bootstrap draws, fixed
  seed 20261119. No post-hoc sport/side/threshold slices. Show every candidate and
  season, including failures. Intervals are marginal, not multiple-test corrected.
- No automatic promotion. A historical improvement earns prospective shadow testing,
  not higher stakes. Book-specific claims require archived exact book/side/line/price
  and market/source/retrieval times, a frozen forecast and eventual close/result.

Keep source CSV SHA256 fingerprints, source date range and audit counts in the report.
Fresh named-book quotes may be retained from the existing quota-limited snapshot call;
no new paid API markets, credentials or production bets database access in this work.
