"""Proper scoring rules and market comparisons shared by every sport.

All probabilities are plain floats in [0, 1]. American prices are integers
(``-110``, ``+150``). Nothing here reads a database or a network.
"""
from __future__ import annotations

import math
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

EPS = 1e-6


def clip_prob(p: float) -> float:
    return min(max(float(p), EPS), 1.0 - EPS)


def log_loss(p: float, outcome: int) -> float:
    """Binary log loss for one forecast. ``outcome`` is 1 if the selection won."""
    p = clip_prob(p)
    return -math.log(p) if outcome else -math.log(1.0 - p)


def brier(p: float, outcome: int) -> float:
    return (float(p) - (1.0 if outcome else 0.0)) ** 2


def multinomial_log_loss(probs: Sequence[float], winner_index: int) -> float:
    """Log loss of a full-field distribution (one winner among N)."""
    total = float(sum(probs))
    if total <= 0:
        return -math.log(EPS)
    return -math.log(clip_prob(probs[winner_index] / total))


def american_to_prob(price: Optional[float]) -> Optional[float]:
    """Break-even (vig-included) probability implied by an American price."""
    if price is None:
        return None
    price = float(price)
    if price == 0 or math.isnan(price):
        return None
    return -price / (-price + 100.0) if price < 0 else 100.0 / (price + 100.0)


def prob_to_american(p: float) -> int:
    p = clip_prob(p)
    if p >= 0.5:
        return int(round(-100.0 * p / (1.0 - p)))
    return int(round(100.0 * (1.0 - p) / p))


def no_vig_two_way(price_a: Optional[float], price_b: Optional[float]) -> Tuple[Optional[float], Optional[float]]:
    """Remove the overround proportionally from a two-sided market."""
    a = american_to_prob(price_a)
    b = american_to_prob(price_b)
    if a is None or b is None or a + b <= 0:
        return None, None
    return a / (a + b), b / (a + b)


def no_vig_field(prices: Sequence[Optional[float]]) -> List[Optional[float]]:
    """Remove the overround proportionally from an N-way outright market."""
    implied = [american_to_prob(x) for x in prices]
    total = sum(x for x in implied if x is not None)
    if total <= 0:
        return [None] * len(prices)
    return [None if x is None else x / total for x in implied]


def expected_value(p: float, price: Optional[float]) -> Optional[float]:
    """Expected profit per unit staked at an American price given win probability p."""
    if price is None:
        return None
    price = float(price)
    payout = price / 100.0 if price > 0 else 100.0 / -price
    return clip_prob(p) * payout - (1.0 - clip_prob(p))


def settle_units(outcome: Optional[str], price: Optional[float]) -> Optional[float]:
    """Net units from risking one unit. ``outcome`` is win/loss/push/void."""
    if outcome is None or price is None:
        return None
    if outcome in ("push", "void"):
        return 0.0
    price = float(price)
    if outcome == "win":
        return price / 100.0 if price > 0 else 100.0 / -price
    if outcome == "loss":
        return -1.0
    return None


def closing_line_value(forecast_prob_at_bet: Optional[float], close_no_vig_prob: Optional[float]) -> Optional[float]:
    """CLV in probability points: no-vig closing probability minus the price you got.

    Positive means the market moved toward the selection after the forecast.
    Pass the *no-vig* probability implied by the price you took as the first
    argument and the no-vig closing probability as the second.
    """
    if forecast_prob_at_bet is None or close_no_vig_prob is None:
        return None
    return float(close_no_vig_prob) - float(forecast_prob_at_bet)


def calibration_bins(pairs: Iterable[Tuple[float, int]], edges: Sequence[float] = (0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001)) -> List[Dict[str, float]]:
    """Reliability-diagram bins: predicted mean, observed rate and count per bin."""
    buckets: List[Dict[str, float]] = [
        {"lo": float(edges[i]), "hi": float(min(edges[i + 1], 1.0)), "n": 0, "predicted": 0.0, "observed": 0.0}
        for i in range(len(edges) - 1)
    ]
    for p, y in pairs:
        p = float(p)
        for b in buckets:
            if b["lo"] <= p < b["hi"] or (p >= 1.0 and b["hi"] >= 1.0):
                b["n"] += 1
                b["predicted"] += p
                b["observed"] += 1.0 if y else 0.0
                break
    out = []
    for b in buckets:
        n = int(b["n"])
        out.append({
            "lo": round(b["lo"], 4), "hi": round(b["hi"], 4), "n": n,
            "predicted": round(b["predicted"] / n, 4) if n else None,
            "observed": round(b["observed"] / n, 4) if n else None,
        })
    return out


def expected_calibration_error(bins: Sequence[Dict[str, float]]) -> Optional[float]:
    total = sum(int(b["n"]) for b in bins)
    if not total:
        return None
    return sum(int(b["n"]) / total * abs(float(b["predicted"]) - float(b["observed"])) for b in bins if b["n"])


def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def margin_distribution(mean: float, sd: float, limit: int = 80) -> Dict[int, float]:
    """Discrete distribution over integer final margins from a normal on the continuous margin.

    Mass for integer m is P(m - 0.5 < X <= m + 0.5). Tails are folded into ±limit.
    Sports with push-prone key numbers (NFL) can post-process this; it is a baseline.
    """
    out: Dict[int, float] = {}
    for m in range(-limit, limit + 1):
        lo = -math.inf if m == -limit else (m - 0.5 - mean) / sd
        hi = math.inf if m == limit else (m + 0.5 - mean) / sd
        out[m] = (1.0 if hi == math.inf else normal_cdf(hi)) - (0.0 if lo == -math.inf else normal_cdf(lo))
    return out


def cover_probabilities(dist: Dict[int, float], home_spread: float) -> Tuple[float, float, float]:
    """(home cover, away cover, push) for a signed home handicap; covers exclude pushes."""
    home = away = push = 0.0
    for m, mass in dist.items():
        s = m + home_spread
        if abs(s) < 1e-9:
            push += mass
        elif s > 0:
            home += mass
        else:
            away += mass
    live = home + away
    if live <= 0:
        return 0.5, 0.5, push
    return home / live, away / live, push
