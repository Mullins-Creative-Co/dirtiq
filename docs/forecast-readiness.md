# Forecast readiness on the public board

The Tonight board and team-sport pages read the existing Python forecast artifacts.
This display layer does not change model probabilities, fits, ledger rows, or lines.

- Win likelihood and spread lean are different outcomes. The summary names the
  spread side and shows that side's cover probability and saved price, even when
  the outright winner is the other team.
- A market-informed win estimate uses the market as an input. It is displayed
  separately and is not described as independent confirmation of an edge.
- `lineObservedAt` in legacy reports is the latest retrieval across the source
  bundle, not verified per-game quote time. It is labeled accordingly. No current
  report gets a fresh-quote claim from that field.
- An explicit `lineUpdatedAt` with `lineTimestampKnown: true` can be classified by
  age. The two-hour quote and 24-hour forecast recheck windows are display policies,
  not promises of executable odds or validated betting value. Invalid, missing,
  future, and timezone-free timestamps fail closed.
- Consensus prices remain saved reference prices. The current median spread and
  median side prices may come from different books. Do not infer executable EV
  from them. The UI does not calculate or claim positive EV.
- Current team forecasts do not have verified game-day injuries or confirmed
  lineups. This limit is visible in every expanded matchup. Stacked-model copy
  mentions probable pitchers only for MLB, not basketball or football starters.
- Started games, invalid start times, and games without a valid model win
  probability are excluded from Tonight at request time. A refresh button reloads
  the saved report; it does not request new sportsbook prices.
- Extreme probabilities are formatted as inequalities instead of rounding to 0%
  or 100%. Model fair prices still use the unrounded probability and are labeled
  as model output, not book quotes.

Follow-ups needed in the data layer: retain per-event source retrieval and book
quote timestamps, select current versus closing ESPN odds correctly, preserve
book/line/price identity, integrate documented availability context, and evaluate
all proposed moneyline, spread, and totals signals with chronological holdouts
and prospective ledger grading before describing an edge as established.

Regression coverage: `tests/forecast-readiness.test.ts`.
