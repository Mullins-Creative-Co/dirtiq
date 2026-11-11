"""As-of game features for the learned layer: rest and starting-player adjustments.

Everything here is computed strictly from information available before the game:
rest from the schedule, starter adjustments from residuals of earlier games in start
order. The functions are pure (no I/O) and take the adapter frame plus the
one-step-ahead filter predictions.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

REST_CAP = 7.0          # days; a season opener and anything longer count as a full week
STARTER_HALF_LIFE = 12  # starts: weight of a residual halves after this many later starts
STARTER_PRIOR = 6.0     # pseudo-starts of zero residual that shrink a new starter to the league


def rest_features(games: pd.DataFrame) -> pd.DataFrame:
    """Per row (aligned to ``games.index``): ``home_rest, away_rest`` days since that team's
    previous game of the same season (capped at ``REST_CAP``), ``home_b2b, away_b2b``
    (rest of one day or less) and ``home_games7, away_games7`` (games in the prior 7 days)."""
    cols = ["season", "start"]
    parts = []
    for side in ("home", "away"):
        p = games[cols + [side]].rename(columns={side: "team"}).copy()
        p["_idx"] = games.index
        p["side"] = side
        parts.append(p)
    long = pd.concat(parts, ignore_index=True)
    long["start"] = pd.to_datetime(long["start"], utc=True)
    long = long.sort_values(["team", "season", "start"], kind="mergesort")
    prev = long.groupby(["team", "season"])["start"].shift(1)
    rest = (long["start"] - prev).dt.total_seconds() / 86400.0
    long["rest"] = rest.fillna(REST_CAP).clip(upper=REST_CAP)
    games7 = np.zeros(len(long), dtype=int)
    starts_ns = long["start"].dt.tz_convert(None).to_numpy().astype("datetime64[ns]").astype("int64")
    week_ns = 7 * 86400 * 10 ** 9
    for _, idx in long.groupby(["team", "season"]).indices.items():
        s = starts_ns[idx]
        lo = np.searchsorted(s, s - week_ns, side="left")
        games7[idx] = np.arange(len(s)) - lo
    long["games7"] = games7
    out = pd.DataFrame(index=games.index)
    for side in ("home", "away"):
        sub = long[long["side"] == side].set_index("_idx")
        out[f"{side}_rest"] = sub["rest"].reindex(games.index).astype(float)
        out[f"{side}_b2b"] = (out[f"{side}_rest"] <= 1.0).astype(float)
        out[f"{side}_games7"] = sub["games7"].reindex(games.index).astype(float)
    out["rest_diff"] = out["home_rest"] - out["away_rest"]
    return out


def starter_adjustments(frame: pd.DataFrame, mean_col: str = "ind_mean", home_col: str = "home_starter",
                        away_col: str = "away_starter", half_life: int = STARTER_HALF_LIFE,
                        prior: float = STARTER_PRIOR) -> pd.DataFrame:
    """As-of starter adjustments (``home_starter_adj, away_starter_adj, starter_diff, starter_known``).

    A starter's adjustment is the shrunk, exponentially weighted mean of the margin
    residuals (actual home margin minus the filter's prediction, signed for the
    starter's side) of their earlier starts. Rows are processed in start order and a
    game's own residual is added only after its feature is read, so upcoming rows and
    backtest rows see the same information a forecast would. Unknown starters get 0."""
    out = pd.DataFrame(index=frame.index, data={"home_starter_adj": 0.0, "away_starter_adj": 0.0,
                                                "starter_diff": 0.0, "starter_known": 0.0})
    if home_col not in frame.columns or away_col not in frame.columns:
        return out
    decay = 0.5 ** (1.0 / float(half_life))
    order = np.argsort(pd.to_datetime(frame["start"], utc=True).to_numpy(), kind="mergesort")
    sums: Dict[str, Tuple[float, float]] = {}  # starter -> (weighted residual sum, weight sum)
    homes = frame[home_col].to_numpy(dtype=object)
    aways = frame[away_col].to_numpy(dtype=object)
    means = pd.to_numeric(frame[mean_col], errors="coerce").to_numpy(dtype=float) if mean_col in frame.columns else np.full(len(frame), np.nan)
    margins = (pd.to_numeric(frame["home_score"], errors="coerce") - pd.to_numeric(frame["away_score"], errors="coerce")).to_numpy(dtype=float)
    done = frame["completed"].to_numpy().astype(bool) if "completed" in frame.columns else np.ones(len(frame), dtype=bool)
    h_adj = np.zeros(len(frame))
    a_adj = np.zeros(len(frame))
    known = np.zeros(len(frame))

    def est(key: Optional[str]) -> float:
        if key is None:
            return 0.0
        s, w = sums.get(key, (0.0, 0.0))
        return s / (w + prior)

    def push(key: Optional[str], resid: float) -> None:
        if key is None:
            return
        s, w = sums.get(key, (0.0, 0.0))
        sums[key] = (s * decay + resid, w * decay + 1.0)

    for i in order:
        h = _key(homes[i])
        a = _key(aways[i])
        h_adj[i], a_adj[i] = est(h), est(a)
        known[i] = float(h is not None and a is not None)
        if done[i] and not np.isnan(margins[i]) and not np.isnan(means[i]):
            r = float(margins[i] - means[i])
            push(h, r)
            push(a, -r)
    out["home_starter_adj"], out["away_starter_adj"] = h_adj, a_adj
    out["starter_diff"] = h_adj - a_adj
    out["starter_known"] = known
    return out


def _key(v: object) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, float) and np.isnan(v):
        return None
    s = str(v).strip()
    return s if s and s.lower() not in ("nan", "none", "") else None
