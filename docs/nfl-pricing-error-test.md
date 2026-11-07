# NFL pricing-error experiment

The default Football Lab tab is **NFL pricing errors**. It compares three forecasts
on the identical 705 development games: market alone, independent QB/supporting
team, and market plus a learned pricing-error correction. Final 2025 week 10 onward
is removed before feature construction, fitting, probability estimation, or reports.

Reproduce:

```sh
OPENBLAS_NUM_THREADS=1 python scripts/football/pricing_error.py --cache ../nfl-cache
OPENBLAS_NUM_THREADS=1 python -m unittest discover -s tests -p 'test_football*.py'
```

The primary QB prior is 400, margin/residual ridge 20, sample half-life 365 days,
training lookback 730 days, minimum 80 earlier games, and a fixed two-point edge
threshold. These retain existing research choices rather than optimizing a new
grid. All feature, projection, and regression stages use earlier available data.

The independent forecast fits final home margin from six jointly estimated QB,
passing-support, rushing, defense, special-teams, and home-field differences.
The correction fits `actual home margin - archived market home margin` from those
same features, then adds the predicted residual to the target market line. It does
not add the independent model on top of the spread or a standalone full QB penalty.
The market is a no-selection baseline, not an invented betting return or win rate.

Probabilities differ by model. Market home-cover probabilities normalize the paired
American-odds implied probabilities to remove vig. The other models use empirical
distributions of strictly earlier out-of-sample forecast errors, with two pseudo
observations and a minimum 100 earlier errors. 2022 forecasts warm up this error
distribution; reported development games begin in 2023. Future/current outcomes
cannot calibrate their own prediction. This is empirical probability estimation,
with Brier and bucket diagnostics, not a claim of validated live calibration.

Selections require absolute model-minus-market margin >=2 points. Settle at archived
side prices while risking one unit; pushes count zero. Because these quotes are not
timestamp-aligned with the Wednesday feature snapshots, all returns remain
hypothetical. No causal sportsbook behavior or executable historical edge is claimed.

Starter provenance is handled separately in `scripts/football/confirmed-starters.json`.
The initial file is intentionally empty rather than populated using postgame main
passers. Each manually reviewed record requires:

```json
{
  "gameId": "a development game identifier",
  "team": "the matching team abbreviation",
  "qbId": "the matching GSIS player identifier",
  "publishedAt": "an ISO timestamp with timezone",
  "observedAt": "an ISO timestamp with timezone",
  "source": "an HTTPS announcement provenance URL"
}
```

Keep the manifest as a JSON array. Publication must precede observation; both must
be no later than the existing frozen feature time. Later Friday/Sunday news cannot
be backdated into a Wednesday forecast. The latest timely designation overrides
the prior-game QB in the earlier-data decomposition. A QB with no earlier sample
gets zero-centered prior impact and zero historical dropbacks, never future player
data. Sources are references supplied by the input, not automatically verified by
this script. Review that the source actually designates the expected starter.

The primary comparison falls back to prior-game proxies where records are absent.
The confirmed-target subset requires both teams to have timely records and is empty
on this first run. Training may still contain proxy QB inputs unless historical
coverage is complete; do not call this an all-confirmed training experiment.

Potential source investigation: nflverse's depth-chart documentation says the source
changed after 2024; 2025+ captures include ISO timestamps and are appended daily.
Those are potential expected-QB inputs, not official confirmation that the listed
QB actually starts, nor automatically sufficient injury/availability data. Earlier
weekly depth-chart labels must not be assigned invented publication times.
https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html
https://nflreadr.nflverse.com/articles/dictionary_depth_charts.html

First development results:

| Model | Margin MAE | Selections | W–L–P | Cover rate | Hypothetical ROI |
| --- | ---: | ---: | --- | ---: | ---: |
| Market | 9.8518 | 0 | — | — | — |
| Independent | 10.3143 | 369 | 176–183–10 | 49.0% | −5.98% |
| Pricing correction | 9.8495 | 117 | 67–49–1 | 57.8% | +10.21% |

The correction ROI interval is approximately −10.2% to +31.6%; its MAE-change
interval crosses zero. Correction periods: 2023 7–11–1, 2024 32–14–0, 2025 weeks
1–9 28–24–0. A positive aggregate is largely driven by 2024 and is not stable proof.
Market Brier is .2505; correction .2522, so the probability forecast has not improved
on the market's calibration score. The already-inspected supporting-team cohort has
109 games, of which this model selects 16 (9–7). That is a diagnostic in an explored
cohort, not another fresh hypothesis or automatic backing of the qualifying team.

Intervals use fixed-seed weekly-block bootstrap draws with a two-comparison family
adjustment. Previous project searches, period breakdowns, cohort looks, and every
reported metric are not all covered. Keep the method and its negative evidence in
the record; do not treat the development return as trustworthy cover probability.

Outputs: `public/football/pricing-error.json`, including coverage, three comparators,
periods, probability buckets, confirmed-target subset, and first predictions for
leakage verification. The remaining final sample has not been run or promoted.
