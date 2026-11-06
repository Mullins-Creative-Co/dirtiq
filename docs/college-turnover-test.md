# College turnover-inflated blowout study

The College turnover test is the default Football Lab tab. It is independent of
NFL and racing models. This is a completed development study, not a validated
live betting model.

The supplied rule is fixed: previous win margin >=21, takeaways minus giveaways
>=3, and winner YPP minus opponent YPP <=1. The selection fades that team in its
immediate next game. Both prior and target must be FBS-v-FBS regular-season games
within the same season. This scope excludes FCS mismatches, bowls, and offseason
follow-ups before inspecting results. Byes do not break the immediate-game link.
If both teams qualify, the game supplies no directional selection and is skipped.

YPP uses full-game ESPN box scores: total yards divided by rush attempts plus pass
attempts. NCAA sack rushing treatment is retained. Validate total yards against
net passing plus rushing yards, and giveaways against interceptions plus fumbles
lost. Missing or inconsistent stats make the prior game unknown; never skip it
and reuse an older qualifying game. Scoreboard blowouts can lower late-game YPP
when teams change approach, so this measure does not isolate underlying skill.

Public inputs (cached outside the git repository):

- Schedule: https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/cfb_schedules
- Box scores: https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_cfb_team_box
- Archived spreads: https://github.com/sportsdataverse/cfbfastR-data/tree/main/betting/parquet
- Field definitions: https://py.sportsdataverse.org/docs/cfb/reference/loaders/team

Use schedule/box seasons 2022, 2023, 2024, and 2026; do not load 2025 scores or box
stats. 2026 feeds only a prospective flag screen. The odds file contains multiple
seasons, but its rows are restricted to 2022–2024 before joining; no 2025 outcome
is in this file or evaluated by the script. Primary ATS evaluation uses DraftKings
alone with paired home/away spread values that negate each other, no book selection
by performance, no average across books, and no assumption that game start time
is a quote timestamp. Source hashes are included in the generated JSON report.

The source has no spread-side prices for these seasons, so actual price-required
profitability cannot be evaluated. The −110 result is a clearly labeled hypothetical
scenario, not a claim that −110 was offered. Quotes also lack a point-in-time history,
so these are archived-spread retrospective results, not executable historical bets.

A simple opponent-adjusted margin regression learns one team strength per team and
a home-field coefficient. Compare it against the identical regression plus
home-trigger minus away-trigger as a joint predictor. Team priors are five games,
home-field prior one game, and trigger prior twenty games. Training uses preceding
730 days, a 365-day exponential half-life, and only games conservatively available
24 hours after kickoff and strictly before the week's Monday coefficient freeze.
The incoming trigger is also based on completed earlier games; no target-game box
score enters a feature. There is no threshold or hyperparameter search.

The common 2023–2024 evaluation has 1,502 games, 57 without the selected book's
spread. Twenty games qualify for the fade: 2023 4–5, 2024 6–5, total 10–10.
Hypothetical −110 ROI is −4.55%, mean cover margin −1.0 points, with a weekly-block
interval spanning zero. Baseline MAE is 13.2943 points; augmented MAE 13.2955.
The model increment is not supported. All cases, including losses, remain visible.
Do not tune this failed definition and describe the tuned result as confirmation.

The generated report also screens the next eight days from its generation time.
It does not estimate new current-season margins, verify current quarterbacks, or
join a live book. Lack of a flag is not a clean bill for games with missing prior
stats. Current first run: November 7 has 48/50 matchups with both prior boxes
available, and no verified flag in the loaded eight-day screen.

Reproduce:

```sh
OPENBLAS_NUM_THREADS=1 python scripts/football/college_turnovers.py --cache ../cfb-cache
OPENBLAS_NUM_THREADS=1 python -m unittest discover -s tests -p 'test_football_college.py'
```

The report is `public/football/college-turnovers.json`. The primary rule itself is
not trained; regression measures whether its signal improves a basic forecast.
Weekly-block bootstrap intervals are descriptive diagnostics, not a guarantee
against selection bias or all prior project searches. Final-2025 outcomes remain
unrun. A useful future model still needs better point-in-time input coverage and
honest prospective calibration; this result does not justify a paid bet.
