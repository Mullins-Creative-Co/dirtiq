# Availability and injury-value context

Implemented in PR #2 (`feat/injury-context`); deployment status is tracked on the PR. The branch is reconciled with current main, preserving personal $1 bulk logging and the current card sport policy. Availability context does not alter forecast stakes.

The scores-only baseline has no current injuries. This change collects current public
ESPN reports and gives them a useful, transparent numeric context where possible:

- NBA: listed-out and unresolved regulation minutes relative to the last five team
  games, plus a separate player/minute ridge association model. A scenario redistributes
  the missing minutes to other recent players and measures the change in fitted point
  contribution. It is not raw points-per-game subtraction.
- NFL: current reports and QB-listed flags, with the starter and point conversion
  explicitly unverified. There is no arbitrary quarterback penalty.
- NCAAB/NCAAF: the tested ESPN endpoints are empty or stale. The site says unavailable
  and gives no player values, rather than interpreting missing entries as healthy.

NBA values are experimental associations, confounded by player role/teammates/game
state. The scenarios are not confidence intervals. All subsets of up to eight uncertain
participants are considered; questionable/doubtful/probable do not receive invented
probabilities. A long absence already represented by zero recent minutes is not charged
again. A player who appeared after an old Out report, stale statuses, uncertain identities
and insufficient replacement history remain unvalued. Player identities come from
athlete ids/URLs; news ids and player-name guesses are not used.

Current contextual values **never change** the baseline margin, a cover probability,
lean, log-bet terms or stake. The app shows them alongside the forecast, with sources
and dates. Snapshot age over three hours hides current values. NBA official reports are
linked for cross-checking; the automated feed is ESPN, not a certification that the
league's full report has been received.

Every refresh retains normalized source observations for all four sports and NBA game
scenarios with hashes, retrieval/source times and model version. Evaluating the method
starts with these snapshots. Past-game injuries are never reconstructed from today's
report or from actual game participation. The paired evaluation uses the latest snapshot
at least one hour before tip, the original fixed listed-out scenario and public final
scores. At least 100 paired games are required before reviewing any proposed integration;
there is no automatic promotion. The initial sample is zero. Baseline/scenario/reference-market MAE are also reported on
the same priced subset; missing or >3-hour-old reference quotes are excluded rather
than imputed. A baseline generated after its snapshot is ineligible.

## Reproduce

```sh
OPENBLAS_NUM_THREADS=1 python3 -m dirtiq_model availability refresh
OPENBLAS_NUM_THREADS=1 python3 -m unittest discover -s tests -p 'test_availability.py'
npm run test:ts
npm run build
```

Raw sources live outside the repository in `../injury-cache`. The hourly workflow uses
its cached `sports-cache/availability` directory. Latest reports and compact history are
published under `public/data/availability/`; all app reads go through model-reports.ts.
Raw injury-news prose is not republished. No credentials, bets database or personal bets
are used by the collector, learner, scenario builder or evaluator.

## Validation of this implementation

The first working collector fit 2,638 eligible NBA games and produced point scenarios
for 9 of 15 NBA next-game contexts; the remainder were explicitly unvalued. The feeds
contained 108 listed NBA players (77 updated within seven days) and 188 NFL players
(177 recent). NCAAB had no usable entries; the college-football feed had an old entry
and no recent reports. These are coverage facts, not proof of prediction accuracy.

Python tests cover source timing/identity/deduplication, Active clearing old Out reports,
empty/stale/future feeds, team conflicts, replacement-minute conservation and capacity,
existing long absences, mixed uncertain-player combinations, future box/outcome exclusion,
insufficient player history, next-game scoping, and evaluation/model/baseline/quote cutoffs.
TypeScript tests cover stale/unknown summaries, experimental labels and immutable forecasts.

166 Python tests and 140 TypeScript tests pass; typecheck and production build pass.
Lint has no errors and the same two existing racing-page warnings. Local HTTP checks
returned 200 for NBA/NFL/college injury views, Card and Models, with the expected values,
QB warning, unavailable college state and unstaked-card context. This is response-rendering
verification; no real bet action or bets database was used.

All existing numerical forecasts and saved market terms across the four focus sports
were compared with the main-branch base and preserved. Historical card picks, terms,
stakes and existing outcomes were also preserved. Prior validated spread backtests were
carried forward using the report writer and matching scored CSVs; their cutoff remains
explicit. There is no retrospective backtest claiming today's injuries were known earlier.

An initial NBA box export contained unidentified player rows. The collector initially
reported `Cannot convert non-finite values (NA or inf) to integer`; it now excludes games
with unidentified positive-minute players and ignores unidentified zero-minute rows.
A regression test covers that failure. An initial lint error (`Cannot call impure function
during render: Date.now`) was fixed by moving request-time acquisition into the server
loader. There are no outstanding failing checks. The injury-specific evaluation remains
at zero completed games; no accuracy improvement or betting edge has been established.


Deployment packaging was checked against the built route traces. The application needs
latest.json, while offline history stays in git/CI. A broad tracing include initially
retained the history despite the exclude setting; explicit runtime-artifact includes
now omit it. An incremental build then reported `next/font/google queries have exactly
one entry` / missing internal Google-font module. After stopping the local server and
clearing the generated build directory, a clean production build passed. Fresh trace
checks for Injuries, Card and Models include latest.json and exclude history.


## Source checking (2026-11-19)

Card and Tonight expose “Check injuries” and date-specific matchup injury-news searches,
including when the automated snapshot is missing or stale. The Injuries page keeps
sport selection and upcoming matchup checks available even without feed coverage.
Search results are source discovery, not verified availability. Existing player/league
source links and timestamps remain visible; experimental values do not alter forecasts.
Reconciled with current main: personal $1 bulk logging and current card sports policy
are preserved exactly. Refreshed all four feeds with zero collector errors.
Validation: 167 Python tests, 141 TypeScript tests, typecheck, lint (zero errors, two
existing racing warnings), production build; Card/NBA/college source links render over
HTTP 200 in an isolated production server. Numeric forecast/card artifacts are identical
to main. No production credentials or bets database were accessed.
