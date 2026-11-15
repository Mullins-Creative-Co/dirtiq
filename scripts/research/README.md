# Miss studies

One-off scripts behind `docs/tested-hypotheses.json` and `docs/bet-review-2026-11-15.md`.
Each reads the out-of-fold backtest predictions with closing lines,
`data/sports/<sport>-backtest-predictions.csv` (untracked; written by
`python -m dirtiq_model teams backtest --sport <sport>`), and prints its tables.
Run from the repo root: `python scripts/research/market_miss.py`.

| Script | Question |
|---|---|
| `market_miss.py` | Is the model or the closing spread closer to the result, and what explains the gap? |
| `early_season_and_spread_size.py` | Do picks do worse early in the season, on big underdogs, or on big favorites? |
| `repeat_miss.py` | Does a pick on a team the model just badly missed keep losing? |
| `totals_vs_close.py` | Does a simple scoring-pace model beat closing totals? |

When a new idea is tested, add it to `docs/tested-hypotheses.json` with its sample size and
cover rate, whether it worked or not. Break-even at -110 is 52.4%.
