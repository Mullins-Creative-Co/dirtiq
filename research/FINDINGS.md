# Spread-market study — 2026-11-13

**No tested rule qualifies. I would not change card selection or stakes from this study.** Eight fixed candidate rules were assessed; none both exceeded 52.4% on holdout and made money in most reported seasons. No positive result reached z=3. This is research on the requested uncapped threshold rule, not a replay of the current daily card.

Inputs: frozen OOF forecasts and cached schedules/odds, SHA256-listed in [INPUTS.sha256](INPUTS.sha256). NFL/NCAAF holdout: 2024–25; NBA/NCAAB: ending-years 2025–26. Incomplete seasons excluded; NON_D1 and known open/close moves over 8 points dropped. Hypotheses were committed first in [PROTOCOL.md](PROTOCOL.md); final evaluation used code `0783fac`. Development-only data-integrity corrections are documented there. **These seasons had already been inspected in the earlier November 13 study: they are quarantined for this study, not genuinely untouched external validation.** Supplied base forecasts remain rolling; “strict” below freezes the new classifier before both holdout years.

Holdout results (one-unit stakes, -110, pushes excluded; marginal Wilson 95% cover intervals):

| Frozen candidate | Sport | n bets | Cover | 95% interval | ROI |
|---|---|---:|---:|---|---:|
| November ≥90% carry-over | NCAAB | 1,199 | 50.1% | 47.3–53.0% | -4.3% |
| November ≥90% carry-over | NCAAF | 217 | 51.6% | 45.0–58.2% | -1.5% |
| Opening-edge/move screen, bet at close | NBA | 209 | 50.2% | 43.5–57.0% | -4.1% |
| Opening-edge/move screen, bet at close | NCAAB | 613 | 48.9% | 45.0–52.9% | -6.6% |
| Strict market-miss classifier | NFL | 0 | — | — | — |
| Strict market-miss classifier | NCAAF | 69 | 39.1% | 28.5–50.9% | -25.3% |
| Strict market-miss classifier | NBA | 12 | 58.3% | 32.0–80.7% | +11.4% |
| Strict market-miss classifier | NCAAB | 124 | 46.0% | 37.4–54.7% | -12.2% |

1. **Error anatomy.** Development excess MAE (model minus market) was NFL +0.34, NCAAF +0.93, NBA +0.40 and NCAAB +0.21 points. NCAAF’s pooled FCS opponents were worst: +3.00 on 899 development games, then +2.64 on 292 holdout games (date-bootstrap 95% +1.28–3.93). Those held-out picks covered 49.4% (n=231), not a profitable filter. NCAAB’s worst development team, MCN, reversed from +1.09 (n=162) to -0.34 (n=65). Detailed output ranks up to ten eligible groups per dimension with intervals and seasonal results. Research-only corrections removed impossible pooled-FCS rest histories and used Eastern calendar-day back-to-backs.

2. **Early-season priors.** Held-out NCAAB fits already retain 91.4%/92.1%: the ≥90% intervention changes nothing; November MAE stays 10.0838. NCAAF MAE changes 12.2099→12.2185 (paired delta 95% -0.0100–+0.0258). These are independent-filter ablations, not refitted stacks. The roster extension was stopped: no verified preseason continuity panel was obtained. The audited [ESPN seasonal roster](https://hoopr.sportsdataverse.org/articles/espn-endpoints.html) lacked preseason as-of proof; [CFBD returning production](https://api.collegefootballdata.com/data-availability) required authentication (401). Current rosters/future minutes were not substituted.

3. **Openers.** Fixed X=1.5×threshold, Y=0.5 point. The audited inputs lack opener-time forecasts/intermediate timestamped quotes, so the requested executable open/skip rule remains untested. The counterfactual open-price screen covered NBA 46.4%, NCAAB 45.8%, with signed CLV -1.21/-0.95 points. Filtering on the eventual close removes favorable moves and introduces timing leakage; it cannot establish an opener edge. The closing-price counterpart is above.

4. **Market-miss model.** Fixed L2 logistic, p≥.55/p≤.45, no tuning. Strict classifier holdout Brier: NFL .24978, NCAAF .25189, NBA .25027, NCAAB .25028 versus .25. NFL’s tiny improvement has a confidence interval crossing zero. NBA’s 7/12 wins have z=0.41 and only 3/6 profitable reported seasons: noise. Rolling-update results also fail.

**Limits / card decision:** keep selection and stakes unchanged. Conference history was available only for NCAAB; football travel was unavailable. Basketball travel is partly missing city-centroid displacement, not an itinerary. Prior analysis already exposed these seasons, so no genuinely untouched validation is claimed. Collect timestamped opener forecasts/quotes and verified preseason continuity before a new prospective test. All seasonal metrics, ROI intervals, coverage and null results: [output/DETAILS.md](output/DETAILS.md); reproduction: [README.md](README.md). Only research files are committed; product code/data are unchanged.
