"""Descriptive out-of-fold spread evidence, with fixed buckets and no refitting.

Buckets are absolute model/market disagreement in multiples of the existing sport
threshold: [0,1), [1,2), [2,3), [3,4), [4,infinity). Pushes are reported separately
and excluded from cover rates. These are historical frequencies, not calibrated
per-game probabilities. Never use this pooled table to score its own backtest.
"""
from __future__ import annotations

import json
import math
from typing import Any, Dict, Iterable, Optional

import numpy as np
import pandas as pd

BUCKETS = ((0, 1), (1, 2), (2, 3), (3, 4), (4, None))
BREAK_EVEN = 0.524
MIN_LIVE_CLV = 100  # unique started games, leaned side only; never both sides
WILSON_Z = 1.959963984540054  # lower endpoint of a two-sided 95% Wilson interval


def finite(value: Any) -> Optional[float]:
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def wilson_lower(wins: int, losses: int) -> Optional[float]:
    n = wins + losses
    if n <= 0:
        return None
    p, z = wins / n, WILSON_Z
    return (p + z*z/(2*n) - z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n)


def clv_summary(values: Iterable[float]) -> Dict[str, Any]:
    vals = [v for v in (finite(v) for v in values) if v is not None]
    return {"count": len(vals), "meanPts": sum(vals)/len(vals) if vals else None,
            "totalPts": sum(vals), "positiveRate": sum(v > 0 for v in vals)/len(vals) if vals else None}


def spread_clv(line: Any, close_line: Any) -> Optional[float]:
    """Both handicaps are for the selected side. +3 taken vs +2 close = +1 point."""
    a, b = finite(line), finite(close_line)
    return a-b if a is not None and b is not None else None


def ledger_spread_rows(rows: Iterable[Dict[str, Any]], now: Any) -> Dict[str, Dict[str, Any]]:
    """Unique started leaned-side games with closes. Invalid/missing lean is never a lean.

    close_line is the last pre-start snapshot available, not necessarily a tip-time
    quote. Ledger replacement can lose a close; missing coverage stays missing.
    """
    from .model import config_for
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if row.get("market") != "spread" or row.get("outcome") == "void":
            continue
        start = pd.to_datetime(row.get("event_start"), utc=True, errors="coerce")
        forecast_at = pd.to_datetime(row.get("forecast_at"), utc=True, errors="coerce")
        if pd.isna(start) or pd.isna(forecast_at) or forecast_at >= start or start > pd.Timestamp(now):
            continue
        meta = row.get("meta") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except ValueError:
                continue
        if not isinstance(meta, dict):
            continue
        if meta.get("lean") not in ("home", "away") or meta.get("side") != meta.get("lean"):
            continue
        # Legacy promotion could retain a filter lean after the stacked margin
        # moved inside the threshold. Exclude inconsistent labels without rewriting
        # history or counting an unselected side as a real live lean.
        margin, line = finite(row.get("value")), finite(row.get("line"))
        try:
            threshold = finite(meta.get("selectionThreshold")) or config_for(row["sport"]).threshold
        except (KeyError, ValueError):
            continue
        if margin is None or line is None or threshold <= 0:
            continue
        home_edge = margin + line if meta["side"] == "home" else margin - line
        actual = "home" if home_edge >= threshold else "away" if home_edge <= -threshold else "none"
        if meta["lean"] != actual:
            continue
        value = spread_clv(row.get("line"), row.get("close_line"))
        if value is None:
            continue
        key = str(row["event_id"])
        if key not in out or str(row.get("forecast_at", "")) > str(out[key].get("forecast_at", "")):
            out[key] = dict(row, clvPts=value)
    return out


def staking_gate(evidence: Dict[str, Any], live: Dict[str, Any]) -> Dict[str, Any]:
    sel = evidence.get("selections") or {}
    wins, losses = int(sel.get("wins") or 0), int(sel.get("losses") or 0)
    lower = wilson_lower(wins, losses)
    passed = lower is not None and lower > BREAK_EVEN and live.get("count", 0) >= MIN_LIVE_CLV and (live.get("meanPts") or 0) > 0
    return {"passed": passed, "backtestWins": wins, "backtestLosses": losses,
            "coverRate": wins/(wins+losses) if wins+losses else None,
            "lower95": lower, "requiredLower": BREAK_EVEN, "minimumLiveGames": MIN_LIVE_CLV, "liveClv": live}


def empirical_cover(evidence: Dict[str, Any], edge: Any, threshold: Any) -> Optional[Dict[str, Any]]:
    e, t = finite(edge), finite(threshold)
    if e is None or not t or t <= 0:
        return None
    ratio = abs(e)/t
    for bucket in evidence.get("buckets") or []:
        if ratio >= bucket["minRatio"] and (bucket["maxRatio"] is None or ratio < bucket["maxRatio"]):
            return dict(bucket)
    return None


def backtest_evidence(scored: pd.DataFrame, threshold: float, headline: str) -> Dict[str, Any]:
    prefix = "stk" if headline == "stacked" else "ind"
    mean = pd.to_numeric(scored[prefix + "_mean"], errors="coerce")
    if prefix != "ind":
        mean = mean.fillna(pd.to_numeric(scored["ind_mean"], errors="coerce"))
    spread = pd.to_numeric(scored["spread_line"], errors="coerce")
    edge = mean + spread
    cover = (scored["margin"] + spread) * np.sign(edge)
    valid = mean.notna() & spread.notna() & scored["margin"].notna() & (edge != 0)
    ratio = edge.abs()/threshold
    def counts(mask: pd.Series) -> Dict[str, Any]:
        v = cover[valid & mask]
        w, l, p = int((v > 0).sum()), int((v < 0).sum()), int((v == 0).sum())
        hp = pd.to_numeric(scored.get("spread_home_price", pd.Series(np.nan, index=scored.index)), errors="coerce")
        ap = pd.to_numeric(scored.get("spread_away_price", pd.Series(np.nan, index=scored.index)), errors="coerce")
        prices = hp.where(edge > 0, ap).loc[v.index]
        prices = prices[prices.abs() >= 100]
        payout = prices.where(prices > 0, 10000/prices.abs()) / 100
        units = payout.where(v.loc[prices.index] > 0, -1.0).where(v.loc[prices.index] != 0, 0.0)
        return {"games": w+l+p, "n": w+l+p, "wins": w, "losses": l, "pushes": p, "sample": w+l,
                "coverRate": w/(w+l) if w+l else None,
                "priced": len(prices), "roi": float(units.mean()) if len(units) else None}

    buckets = [dict(minRatio=lo, maxRatio=hi, **counts((ratio >= lo) & ((ratio < hi) if hi is not None else True))) for lo, hi in BUCKETS]
    # Exactly the card's fixed disagreement rule, including its pre-existing 4x cap.
    return {"headline": headline, "threshold": threshold, "selections": dict(counts((ratio >= 1) & (ratio < 4)), rule="%s headline: %.1f <= abs(model + spread) < %.1f" % (prefix, threshold, 4*threshold)),
            "buckets": buckets, "note": "Descriptive out-of-fold frequency for the leaned side at the closing spread; pushes excluded; not a per-game probability."}


def backtest_clv(scored: pd.DataFrame, threshold: float, prefix: str) -> Dict[str, Any]:
    """Select with OPEN spread, compare with close; no closing-line selection leak.

    Descriptive only: the saved margin is a pregame forecast, not timestamped at
    opener publication. This does not backtest an executable opener strategy.
    """
    if "open_spread_line" not in scored or prefix + "_mean" not in scored:
        return clv_summary([])
    opening = pd.to_numeric(scored["open_spread_line"], errors="coerce")
    closing = pd.to_numeric(scored["spread_line"], errors="coerce")
    edge = pd.to_numeric(scored[prefix+"_mean"], errors="coerce") + opening
    eligible = edge.abs() >= threshold
    return clv_summary(((opening-closing)*np.sign(edge))[eligible].dropna())
