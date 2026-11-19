# Fair-line review — 2026-11-19

**No candidate qualifies for promotion. There is no established edge over FanDuel or DraftKings.**

The owner asked for bookmaker-style spread and total accuracy. This study adds separate offense/defense scoring states and a market-residual candidate, then evaluates four fixed sport/market pairs with distinct fitting, calibration and test seasons. The candidate rules were committed before the first run (`0668d1f`, implementation `50e8296`). Historical seasons were already examined in prior studies; these are historical comparisons, not untouched validation.

Same-game mean absolute error (points; lower is better):

| Sport | Market | Games | Independent | Market + scores | Closing market | Market + scores minus market, 95% date interval |
|---|---|---:|---:|---:|---:|---|
| NCAAF | spread | 6367 | 12.832 | 12.208 | 12.189 | +0.019 [-0.011, +0.049] |
| NCAAF | total | 6221 | 13.229 | 12.813 | 12.801 | +0.012 [-0.005, +0.029] |
| NCAAB | spread | 29906 | 9.111 | 8.830 | 8.823 | +0.007 [+0.001, +0.013] |
| NCAAB | total | 30263 | 13.388 | 13.000 | 12.999 | +0.001 [-0.007, +0.009] |
| NBA | spread | 7146 | 11.009 | 10.585 | 10.575 | +0.010 [+0.001, +0.019] |
| NBA | total | 7305 | 14.860 | 14.227 | 14.203 | +0.024 [-0.004, +0.053] |
| NFL | spread | 2494 | 10.257 | 9.899 | 9.856 | +0.044 [+0.016, +0.070] |
| NFL | total | 2494 | 10.851 | 10.516 | 10.507 | +0.010 [-0.023, +0.044] |

All eight market-residual comparisons have a nonnegative point estimate of excess error. Independent score candidates trail the market more substantially. Neither family earns a forecast/staking change. A small profitable assumed-price slice in college totals does not overcome missing actual totals prices, prior exploration, multiple comparisons or the absence of prospective results.

## What the site gains

- `/models#fair-lines` exposes all candidates, intervals, Brier benchmarks, paired-price sample sizes, paper selection returns, season results and bad-data counts.
- The odds writer retains exact named-book coherent two-way pairs and market timestamps from existing requests. Immutable pregame observations pair them with a uniquely matched frozen published baseline; ambiguous/future baselines and post-start observations are withheld. Missing/stale source clocks never become fresh just because retrieval is recent.
- No change to paid API markets/frequency, live forecast numbers, card rules, manual $1 bulk logging, old picks, stakes or bet records. These are implemented branch changes pending review/deployment; quote collection has not retroactively occurred.

## Evidence limits

The archived CSV spread prices may be consensus medians across different books or lines. Even archived-price returns are paper comparisons, not exact-book executable ROI. Totals have no side-price columns; their Brier baseline is explicitly 50%, and -110 results are sensitivity only. Complete seasons only; pooled opponents and invalid lines are excluded and counted. Date-cluster intervals are marginal, not corrected for every trial. Source SHA256 hashes and full results are in `public/data/fair-line-report.json`; per-game details are ignored under `data/fair-lines/`.

Score-only data does not include possessions, verified starters, forecast weather, roster continuity or current player availability. This branch does not silently merge the separate injury draft or fabricate injury history.

## Next work, in order

1. Reconcile pending timestamped injury work with current main and collect prospective outcomes.
2. Audit basketball possession/efficiency data and release lag; football QB/EPA/success-rate data and timestamped weather forecasts. Require historically available inputs, never final rosters or observed game-time weather substituted for earlier forecasts.
3. Freeze one new-information experiment, then shadow it prospectively against exact-book prices and closing lines. Improving accuracy alone does not establish positive price-adjusted returns.
4. Decide totals quote coverage within the existing quota before adding that market to paid requests. The API charges per requested region/market; its market timestamp is authoritative, while bookmaker-level last_update is deprecated. [Official Odds API documentation](https://the-odds-api.com/liveapi/guides/v4/).

## Reproduce

```sh
OPENBLAS_NUM_THREADS=1 python3 -m dirtiq_model fair_lines evaluate \
  --input-dir /path/to/rolling-prediction-CSVs --as-of 2026-11-19
npm run test:py
npm run test:ts
npx tsc --noEmit
npm run lint
npm run build
```

Protocol: `docs/fair-line-protocol.md`. Source CSV fingerprints must match the report for exact reproduction. Explicit einsum contractions avoid spurious Apple Accelerate matmul warnings; the rerun matches the frozen model results to floating precision.


## Verification

171 Python tests (Python 3.9.6), 138 TypeScript tests, typecheck, production build
and lint pass (zero lint errors, two pre-existing racing warnings). Local isolated
production server: `/models` and the full JSON return HTTP 200; the rendered page
contains the 16 comparisons, book-evidence section and explicit awaiting-snapshot
state. The route trace includes the report and excludes offline observations.
Browser visual verification was attempted through the Browser skill but both
navigation methods failed with the browser connection's `timeoutMs` error; no
visual or browser-console pass is claimed. Initial build with a cross-worktree
node_modules symlink was rejected by Turbopack; a clean local `npm ci` fixed it.
No production environment files/credentials or bets database were read or changed.
