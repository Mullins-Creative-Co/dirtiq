# Race result gap backfill

Updated the local database and shipped seed database for Lucas Oil LMDS, WoO Late Models, and Crown Jewel / Combined. Used August 8, 2026—the latest result date already stored—as the coverage boundary, not the machine's current date. Crown events already classified under Lucas Oil or WoO were included.

Checked 224 source-event candidates: 34 events without finishes, 180 historical events with missing fields or split-feature indicators, and 10 historical Eldora crown events.

## Saved changes

- 49 race records changed; 12 separate split-feature races added.
- 844 finishes added (785 new entries and 59 existing entries).
- 980 starting positions, 766 heat positions, and 753 qualifying times added.
- Existing non-null result fields preserved.
- No model retraining or deployment performed. Training on the remaining conflicting history requires further reconciliation.

## Outstanding coverage

167 checked candidates remain unresolved, including some events that may legitimately have no feature:

- 102 have source-versus-database conflicts or ambiguous feature identity. Examples include Earl Pearson Jr. source finishes assigned locally to Eddie Carrier Jr., and support-class results stored as touring-series races. These require event-by-event reconciliation, not driver aliases.
- 34 have no verified touring-series feature in the parsed source. These include preliminary-only sessions and potentially cancelled nights; no cancellation status was inferred.
- 29 have unavailable MRP URLs (HTTP 404).
- 2 historical Eldora events lacked box scores at the checked official coverage URLs.

This is a verified partial backfill, not a claim of complete schedule coverage. Events missing entirely from the database, outside the identified split-feature candidates, were not audited against every season schedule. Non-transfer entries are not assigned invented feature finishing positions. Missing qualifying or heat data may reflect event format rather than an import gap.

## Verification and recovery

SQLite integrity and foreign-key checks passed. Every pre-existing non-null finish, start, heat, qualifying time, and car number was compared with the original and preserved. Changed races have no duplicate feature finishing positions. Replaying all snapshots produced zero additional fields or entries.

Original seed backup: `data/backups/gap-backfill/dirtiq.seed.before.db`.
Reviewed source snapshots: `data/backups/gap-backfill/*-snapshots.json`.
Detailed event outcomes: `reports/race-gap-backfill.json`.
Counts: `reports/race-gap-summary.json`.

`fetch_mrp_gap_snapshots.mjs` fetches read-only snapshots from a JSON array of race records (including `id` and `mrp_event_id`). `backfill_verified_mrp.py` defaults to a rolled-back dry run; `--apply` commits. Keep a database backup before applying. The scripts never settle bets or change account balances.
