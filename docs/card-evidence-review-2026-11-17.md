# Card evidence review — 2026-11-17

Implementation branch: `feat/card-evidence-gate`, based on `origin/main` at `073bb47`,
in `/Users/writewise/dirtiq-card-evidence`. The conflicted `feat/real-starter-signal`
worktree was not modified. This change has not been deployed.

## What changed

- Staking requires the lower endpoint of a two-sided 95% Wilson interval to exceed
  52.4%, plus positive mean live spread CLV over at least 100 unique started games.
  The cover sample uses the published headline model, the existing sport threshold,
  and the existing under-4× cap. Pushes are excluded from cover-rate denominators.
  Live CLV uses only the explicitly leaned side, excludes missing closes, invalid
  leans and labels inconsistent with the stored margin/line, and requires a forecast timestamp before kickoff. Missing evidence fails.
  The Wilson interval is the standard binomial interval; it does not model dependence
  between repeated teams. The minimum live sample is fixed, not selected to make a
  sport pass. The old NBA pause is removed; NBA can appear as unstaked tracking picks.
- Failed sports remain listed and graded with zero stake. A failing gate also zeros
  current unstarted picks, retaining `originallyListedStakeUnits`; started/past stakes
  and existing results stay intact. A previously zero-stake pick is not automatically
  upgraded. Bulk logging selects positive-stake picks only; individual logging can
  still record a bet actually placed. Spread logging does not store an uncalibrated
  model number as a cover probability.
- Historical cover frequencies come from the out-of-fold scored rows used by the
  report, using fixed disagreement buckets [0,1), [1,2), [2,3), [3,4), [4,infinity)
  in multiples of the unchanged threshold. Card, Tonight, readiness summaries and
  sport tables show samples and descriptive cover rates. These are not calibrated
  per-game probabilities. Raw values remain explicitly named `uncalibrated*CoverProb`.
- Backtests retain opening fields and publish spread CLV for independent and stacked
  variants. Side selection uses the opening spread, not the closing spread. This is
  a descriptive comparison with pregame model margins, **not** an executable opener
  strategy: predictions are not timestamped at opener publication. Market-input
  variants cannot be reused without leaking the closing line and are left unavailable.
  NFL has no opening pairs in its source. Missing coverage is not imputed.
- Card CLV is the listed selected-side handicap minus its closing handicap: +3 taken
  versus +2 close is +1 point. The normal card build appends it after start, and the
  running record reports total/mean points and sample size alongside W–L. Win-loss
  includes tracking picks; P&L uses actual historical card stakes. Closes are the last
  available pre-start ledger snapshots, not guaranteed tip-time quotes. Hourly ledger
  replacement can lose older snapshots, so missing CLV remains a coverage limitation.

## Data check A: the extreme NCAAB tail

The supplied local CSV has 47,645 games through `2026-11-10 04:59 UTC`. For the
independent margin, absolute model/market disagreements over 15 points contain
140 games: 115 wins, 22 losses, 3 pushes (82.14% of all games; 83.94% of decisions).
The earlier “about 125” sample is not the exact version currently on disk.

The main confirmed bug is a price masquerading as a handicap in ESPN's nested close.
For [event 401489751](https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/401489751/competitions/401489751/odds?limit=50),
ESPN BET reports `details: "MTSU -49.5"`, top-level/current handicap -49.5, but
`homeTeamOdds.close.pointSpread.american: "-110"`. The parser previously preferred
that malformed close. A second example is event 401489513: current -57.5, close -110.
The raw response is committed as `tests/fixtures/espn-malformed-handicap.json`.

The cache contains malformed |handicap| >= 100 entries in 5,576 NCAAB prediction
rows and 1,306 NBA events. These counts mean at least one bad book, not necessarily
an unusable event. Sixty-eight of the original 140 extreme games contain such a book.
The fix validates **each book before taking a median**, including existing compact
caches. Otherwise a bad -110 combined with a valid -49.5 becomes a plausible-looking
but false -79.75. Invalid close handicaps are omitted, never replaced with a current
quote falsely labeled as a close. Other valid books may still price the event.

There is also conflicting favorite direction in some historical books. For
[event 401090034](https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/401090034/competitions/401090034/odds?limit=50),
Westgate has WEB -10.5 while several Caesars-family feeds have WEB +10.5. The parser
withholds side markets with opposing signs rather than vote across duplicated brands
or choose a sign from model/results accuracy. Totals remain available. This also
withholds genuine near-pick'em line movement; it is a conservative coverage tradeoff.

Holding the original model margins fixed and applying both validations reduces the
entire >15-point group to **65 games: 42 wins, 20 losses, 3 pushes** (64.62% of games,
67.74% of decisions). Ten original tail games have conflicting signs after malformed
books are removed. This explains much of the inflated result, but **does not certify
all remaining unanimous historical quotes as correct**. No universal sign flip was
applied. Thresholds, rating logic and fitting procedures were not tuned.

Machine-readable reproduction: `docs/card-data-audit-2026-11-17.json`.

## Data check B: 224 of 225 apparent leans

Reproduced exactly on the first 225 chronological ledger games from November 11:
`lean != "none"` counts 224, but **176 are home/away labels, 48 are NaN, and one
is explicit "none"**. Only **141** actually clear the threshold at the stored margin/line. The current artifact has two additional games through November
16: 178 home/away labels / 227 games, 48 NaN and one explicit none; only **143**
actually clear the threshold. The window uses ledger `event_start` dates in UTC. Both spread sides are
recorded for every priced game; `ledger_rows()` does not filter on whether it leans.

Cause: pandas turns a missing `ind_pick` into floating NaN; NaN is truthy, so
`row.get("ind_pick") or "none"` serialized NaN in metadata. It is now normalized by
accepting only explicit `home`/`away` values. Evidence calculations also ignore invalid
legacy values; the historical ledger was not rewritten.

A second confirmed bug explains the 35 extra explicit labels: `promote_variant()`
replaced the filter's margin with the stacked margin but retained the filter's lean
when the valid stacked prediction had no lean. For example, event 401918978 stores
margin 8.7101, home spread -11.5, edge -2.79, but says `away` despite a 3-point bar.
Promotion now clears that lean. Fallback happens only when the stacked prediction
itself is missing. The live gate verifies old labels against saved terms, and new
ledger metadata includes the selection threshold. Regression tests cover both the
no-lean case and the genuine missing-prediction fallback. The saved CSV originally had
no games overlapping these dates, so its roughly 56.2% independent / 52.1% stacked
historical early-November lean rates were not a comparison on the same games.

After refreshing the public 2027 schedule, a diagnostic replay uses the **exact saved
rolling-fold hyperparameters**, unchanged prior-season training, and the normal as-of
filter/stack procedure. It writes only an audit CSV, not production reports/ledger.
There are **224 shared games**, with 143 mathematical live leans versus 118 backtest
leans at the live line (also 118 at the close). Mean absolute forecast-margin difference
is **2.0251 points**; mean absolute live/closing-line difference is **0.5982 points**.
Thus real live forecasts do differ; the ledger was not a leans-only sample. Production
uses a season-keyed cached fit and different forecast times, while the replay uses the
rolling-fold fit. We did not tune or force those fitted parameters to agree, and cannot
attribute every difference without the original per-run training snapshots. Three
ledger games are absent from the refreshed completed schedule: 401917529, 401921760,
401926073. They remain unverified in this comparison.

## Validation and limits

- Full rolling backtests rerun for NFL, NCAAF, NBA and NCAAB using the existing fitting
  procedure, with model-versus-market comparisons on the same priced games.
- Forecasts regenerated with `--no-ledger`. No production credentials or bets database
  were read or changed. No personal bet was submitted or graded during verification.
- All original fields on every archived pick for November 12–16 were compared against
  the branch base and preserved; only CLV fields were appended by the normal builder.
- Python tests cover gate success/failure/missing data, minimum samples, confidence
  bounds, current stake reduction, historical preservation, empirical buckets/pushes,
  opening-side selection, CLV signs/deduplication/timing, invalid NaN leans, and raw/cache
  malformed handicaps. TypeScript tests cover bulk exclusion and parser parity.
- Local HTTP checks of `/card` and `/models` returned 200 and confirmed the unstaked
  notice, disabled bulk logging button, cover sample text, and CLV/gate table. This was
  response rendering verification, not a visual browser review or a real bet write.
- Earlier contract tests expected the removed raw cover-probability fields and prefill;
  those expectations were updated. The first build failed because Turbopack rejects a
  worktree-external node_modules symlink; using a local dependency copy resolved it.
- Numerical routines emit existing `RuntimeWarning: divide by zero encountered in
  matmul`, `overflow encountered in matmul`, and `invalid value encountered in matmul`
  warnings from `stack.py`/scikit-learn. They were not suppressed; the unchanged fitting
  code and finite serialized results are checked separately. Lint retains two existing
  unused-variable warnings in racing pages.

## Backtest change on the fixed original sample

All 47,645 NCAAB games are retained in the before/after backtest. Side-market coverage
falls from 43,454 to 42,086 games after validation. Independent margin MAE over all
games is unchanged at 9.5816. Market MAE goes from 8.9418 to 8.8126 as corrupt quotes
are removed/corrected. The original independent threshold rule (before the card's 4×
cap) moves from 5,694–5,412–112, 51.27% decided covers and -2.23% ROI to
5,402–5,221–104, **50.85% covers and -3.02% ROI**. The source correction makes the
negative result clearer; it does not turn the rule profitable.

The report's independent/market ML Brier scores move from 0.1840/0.1785 to
0.1816/0.1761, each on that report's same priced games. This is a **coverage change**,
not an improvement to the forecasting method. On the identical 41,348 ML-priced games,
both before and after are **0.1816 model versus 0.1761 market**. On the identical
42,086 spread-priced games, model MAE is 9.0948 both times; market MAE is 8.8142 before,
8.8126 after. The backtest cutoff is explicitly `backtest.predictionThrough`; the
fresh current-season diagnostic above is kept separate from this fixed-sample report.

## Gate and CLV results

The lower-bound requirement is strictly above 52.4%; the live condition requires at
least 100 consistent unique started leaned-side games and strictly positive mean CLV.
The cover sample below is the headline rule with the existing under-4× cap, so it differs
from the uncapped independent rule used in the before/after paragraph.

| Sport | Cover W–L | Cover rate | 95% lower bound | Live CLV mean / games | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| NFL | 684–704 | 49.28% | 46.66% | -0.250 pts / 2 | Unstaked |
| NCAAF | 2140–2343 | 47.74% | 46.28% | -0.060 pts / 25 | Unstaked |
| NBA | 1734–1763 | 49.59% | 47.93% | -0.083 pts / 12 | Unstaked |
| NCAAB | 5231–5001 | 51.12% | 50.16% | +0.294 pts / 153 | Unstaked |

| Sport | Descriptive opening-to-close headline CLV | Paired games |
| --- | ---: | ---: |
| NFL | Unavailable | 0 |
| NCAAF | +0.923 pts | 396 |
| NBA | +0.692 pts | 1300 |
| NCAAB | +0.570 pts | 4050 |

Current card: **8 tracked picks, 0.0 units**. Archived card CLV: +15.5 total points across 48 available closes.

Reproduction commands (provide the original CSV separately to retain the fixed baseline):

```sh
python3 -m dirtiq_model teams backtest --sport ncaab --cache /path/to/cache/ncaab
python3 scripts/research/replay_current_ncaab_fold.py --cache /path/to/cache/ncaab --output /tmp/current-ncaab.csv
python3 scripts/research/audit_card_data.py --predictions /path/to/original-ncaab-backtest-predictions.csv --cache /path/to/cache/ncaab --comparison-predictions /tmp/current-ncaab.csv
python3 scripts/refresh_spread_evidence.py
python3 -m dirtiq_model card build
```

`replay_current_ncaab_fold.py` reuses the saved current-fold hyperparameters; it does
not re-optimize from a different initialization or write public artifacts. The audit
serializer represents an empty comparison as missing, not NaN. All source-data and
forecast dates remain visible rather than treating a new generation time as new history.

Final checks (Python 3.9.6):

```text
Python: Ran 154 tests in 6.260s — OK
TypeScript: tests 138, pass 138, fail 0
Typecheck: exit 0, no output
Lint: 0 errors, 2 pre-existing racing warnings
Production build: exit 0
Strict JSON: all sport reports and current card contain no non-finite JSON values
History: every original November 12–16 pick field preserved
Current card: every empirical bucket matches its regenerated sport report; total stake 0.0
```

The new evidence suite also runs in the sports refresh workflow before publication.

Resolved intermediate failures (no outstanding failing checks):

```text
AssertionError: 'homeCoverProb' not found in forecast upcoming entry
AssertionError: null !== 0.6
```

These were old contract/prefill expectations; tests now require explicitly uncalibrated
raw fields and no actionable raw spread probability.

```text
TurbopackInternalError: Symlink [project]/node_modules is invalid,
it points out of the filesystem root
```

Resolved by replacing the shared worktree dependency symlink with a local copy.

```text
ValueError: Out of range float values are not JSON compliant: nan
```

The audit's initially empty shared-game comparison had an undefined mean. The
serializer now emits null for unavailable comparison means. Refreshing the public
schedule and replaying the saved current fold produced the 224-game comparison above.
