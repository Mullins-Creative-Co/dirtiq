# Experimental NFL pregame automation

`npm run matchups:refresh` downloads public nflverse schedule/play-by-play, reuses the existing team-EPA rating definitions and ridge regression, and emits `public/matchups/pregame.json`. Training is frozen to 705 development games (2023–2024 and 2025 weeks 1–9); late-2025 reserved outcomes are excluded. This is not a validated live edge.

Features include team offense/defense EPA and home field only. Prior games become eligible 24 hours after kickoff. Require three prior games, play-by-play for the latest eligible completed game, and latest team input within 21 days. Ratings use 730-day history, 8-appearance half-life, and 200-play zero-EPA prior. Current revised source vintages are not original as-published historical snapshots. Source hashes, retrieval times, feature/generation times, training cutoff and prior-game IDs are recorded.

The API matches ESPN event ID and kickoff, rejects ambiguous/future/stale/started forecasts, and never invents prices or cover probability. Artifacts expire after six hours; selected and saved automatic snapshots expire too. The UI marks EPA already included to avoid double counting.

## Refresh

GitHub workflow runs every four hours at :17, manually, and when its implementation changes on main. It runs tests, refreshes, and commits ONLY the matchup artifact with a normal rebase/push, preserving racing data. Git history preserves prospective published snapshots. A failed job retains the previous artifact, which expires. GitHub timing is best effort. No sportsbook login, betting, paid feed, or new credential is used.

## Not connected

NBA/CFB/CBB current model features; calibrated cover probabilities; current book prices; confirmed starters, injuries and weather; licensed outside-model feeds; automated settlement, drift evaluation and retraining. Manual outside-model fields remain manual. DraftKings percentage of bets placed is not a cover probability. Do not scrape restricted providers or treat consumer subscriptions as republication rights.

## Checks

```
pip install -r scripts/football/requirements.txt
python -m unittest discover -s tests -p 'test_pregame_features.py'
node --experimental-strip-types --test tests/football*.test.ts tests/matchup-*.test.ts
npm run matchups:refresh
npx tsc --noEmit
npm run build
```

Local proxy environments may need `NODE_USE_ENV_PROXY=1` for Node's ESPN fetch. Browser visual QA was blocked by Chromium's process-singleton socket restriction; successful API/build tests do not establish visual QA.
