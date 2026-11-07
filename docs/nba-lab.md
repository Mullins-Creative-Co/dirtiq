# NBA Lab

Route `/nba`, linked in the shared workspace navigation. NBA code, static reports,
and raw caches are separate from football and racing artifacts. No NBA model
places wagers, modifies racing registries, or runs the NFL final test.

This first study is a starting benchmark, not a validated betting model. Development
uses the 2023–24 regular season (ESPN ending season 2024). ESPN ending seasons 2022
and 2023 provide earlier training games and out-of-sample forecast errors. No
2024–25 or later outcomes are loaded. The larger unseen NBA sample is unrun.

Public source releases:

- `espn_nba_schedules/nba_schedule_{2022,2023,2024}.parquet`
- `espn_nba_team_boxscores/team_box_{2022,2023,2024}.parquet`
- `espn_nba_player_boxscores/player_box_{2022,2023,2024}.parquet`
- `espn_nba_pbp/play_by_play_2024.parquet`

All are under https://github.com/sportsdataverse/sportsdataverse-data/releases/download/.
Raw files are cached outside git in `../nba-cache`; SHA256 values and exact source
URLs are stored in `public/nba/research.json`. Field reference:
https://py.sportsdataverse.org/docs/nba/reference/loaders/other.

Filter to ordinary NBA teams, final regular-season games, and exclude the in-season
tournament championship (which is an extra game outside regular-season standings).
All-Star teams, postponed entries, preseason, play-ins and playoffs are excluded.
This produces 1,230 development forecasts. Future-season rows are filtered before
their date, box-score, roster, or target fields are read.

Features are available one hour before each target tip; completed-game data becomes
conservatively available eight hours after its start. For each US Eastern game day,
coefficients fit only outcomes available before that day's earliest feature cutoff.
The training lookback is 730 days, with a 120-day exponential weight half-life.
Each team needs ten earlier valid box scores. Missing boxes do not erase actual
scheduled games from rest or back-to-back calculations.

Fixed comparison sequence:

1. Joint team-strength ratings plus home court.
2. Add rest-days, back-to-back, and three-games-in-four-days differences.
3. **Primary:** add lagged net efficiency, effective field-goal rate, turnover rate,
   offensive-rebound rate, and free-throws-made per field-goal attempt.
4. Add previous-game rotation change and its missing-data indicator.

Team priors use ten game-equivalents; home court one; contextual coefficients twenty.
Contexts are scaled using training-only weighted standard deviations. Team statistics
use at most forty earlier valid games, with a ten-game feature-weight half-life.
Possessions are estimated as the two teams' average of FGA + .44 FTA − OREB + TO.
This is approximate game-level efficiency, not play-by-play adjusted plus-minus.

Previous-game rotation change is half the L1 distance between its normalized player
minute shares and a weighted prior-ten-game rotation. Missing rotations have a
separate indicator rather than implying a known unchanged/healthy lineup. This
feature does not know tonight's injured players or projected replacement minutes.
No target-game participation, minutes, injury status or full-season Win Shares is
used to choose its pregame roster. Player effects are not causally isolated here.

The primary efficiency variant was designated before inspecting results, rather
than promoting the best-returning variant. Each addition is compared with its
preceding baseline on the same games. Four thousand fixed-seed weekly-block
bootstrap draws adjust approximately for the three paired additions. This is not
a correction for all previous project searches or every descriptive statistic.

Processed play-by-play `home_team_spread` is positive when home is favored, so
positive model-minus-market margin selects home. Only games with one consistent
available spread value enter market comparisons. Source book, quote availability
time, and actual spread-side prices are unverified. These may be processed/blended
values and must not be represented as executable single-book offers. The fixed
two-point selection rule is exploratory. −110 returns are illustrative, never
actual price-verified profit.

Home-cover probabilities use the empirical distribution of errors from strictly
earlier out-of-sample forecasts, with two pseudo-observations and at least 100 prior
errors. Current or not-yet-completed games cannot calibrate themselves. Brier scores
exclude exact pushes and report development performance only. No live cover
probability, moneyline recommendation, or staking size is justified by this study.

First results: market MAE 10.528 points; strength 11.044; rest 10.999; primary
efficiency 11.041; rotation 11.034. All paired intervals include zero. Primary
two-point selections finish 320–342–12, 48.3% non-push covers, with −7.58%
illustrative ROI at −110. Primary Brier is about .266, worse than a constant
50% reference (.250). No repeatable edge or reliable calibration is established.

The next material requirement is point-in-time availability and expected minutes,
including who replaces missing players. The useful adjustment is the rotation
change relative to what the baseline already represents. Win Shares can be tested
as a lagged feature, but it is not a direct missing-player spread conversion and
full-season current-year values would leak future information. Current-season
data ingestion and synchronized book snapshots are also needed before live picks.

Reproduce and verify:

```sh
OPENBLAS_NUM_THREADS=1 python scripts/nba_research.py --cache ../nba-cache
OPENBLAS_NUM_THREADS=1 python -m unittest discover -s tests -p 'test_nba*.py'
npm run build
```

Tests cover rotation changes versus unchanged absences, missing-box rest accounting,
future-box leakage, early holdout exclusion, outcome/probability timing, and
settlement with pushes and absent quotes. The earlier football work is preserved.
