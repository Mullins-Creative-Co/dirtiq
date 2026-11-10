"""Race-field probability models.

* ``ConditionalLogit``   linear score per entrant, softmax over the field
  (Plackett-Luce for the winner), L2 penalty, scipy L-BFGS on the multinomial
  negative log likelihood with an analytic gradient. Standardization, median
  fill and missing indicators are fitted on the training fold only.
* ``BoostedSoftmax``     regularized XGBoost binary score whose log-odds go
  through a per-race softmax with a temperature fitted on a chronological
  slice held out from the trees.
* ``LegacyMethod``       the legacy binary XGBoost hyperparameters and the
  power-0.65 / cap-0.45 normalizer on the leak-free features (method-vs-method
  baseline on identical races).
* ``FormOnly``           softmax of -scale * last-10 average finish.
* ``Uniform``            1 / field.

Every model exposes ``fit(frame)`` and ``predict_win(frame)`` on a feature frame
with ``race_id`` and ``won`` columns; softmax models also expose ``scores`` so
Plackett-Luce sampling can produce top-3 / top-5 / expected finish.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy.optimize import minimize, minimize_scalar

LEGACY_XGB_PARAMS = dict(n_estimators=700, max_depth=4, learning_rate=0.035, subsample=0.85,
                         colsample_bytree=0.85, min_child_weight=2, reg_lambda=2.0)
BOOSTED_XGB_PARAMS = dict(n_estimators=300, max_depth=3, learning_rate=0.03, subsample=0.8,
                          colsample_bytree=0.8, min_child_weight=10, reg_lambda=1.0)


# ── field helpers ────────────────────────────────────────────────────────
def race_groups(race_ids: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Rows must be contiguous per race. Returns (order, starts, counts)."""
    order = np.argsort(race_ids, kind="stable")
    sorted_ids = race_ids[order]
    starts = np.flatnonzero(np.r_[True, sorted_ids[1:] != sorted_ids[:-1]])
    counts = np.diff(np.r_[starts, len(sorted_ids)])
    return order, starts, counts


def field_softmax(scores: np.ndarray, race_ids: np.ndarray) -> np.ndarray:
    """Softmax within each race; result aligned with the input rows and sums to one per race."""
    scores = np.asarray(scores, dtype=float)
    race_ids = np.asarray(race_ids)
    order, starts, counts = race_groups(race_ids)
    s = scores[order]
    m = np.maximum.reduceat(s, starts)
    e = np.exp(s - np.repeat(m, counts))
    z = np.add.reduceat(e, starts)
    p = e / np.repeat(z, counts)
    out = np.empty_like(p)
    out[order] = p
    return out


def _field_nll(scores: np.ndarray, race_ids: np.ndarray, won: np.ndarray) -> float:
    p = field_softmax(scores, race_ids)
    return float(-np.sum(np.log(np.clip(p[won.astype(bool)], 1e-12, None))))


def plackett_luce_stats(scores: np.ndarray, n_samples: int = 2000, seed: int = 7,
                        temperature: float = 1.0) -> Dict[str, np.ndarray]:
    """Sample finishing orders from a Plackett-Luce model (Gumbel trick).

    ``scores`` are divided by ``temperature`` first, so the sampled winner
    distribution equals ``field_softmax(scores / temperature)`` (the same
    post-hoc calibration the win probability gets). Returns top3 / top5
    probabilities, expected finishing position and the sampled ``ranks``
    (``n_samples x n``, 0 = winner) for one race.
    """
    s = np.asarray(scores, dtype=float) / float(temperature)
    n = len(s)
    if n == 0:
        return {"top3": np.array([]), "top5": np.array([]), "expected_finish": np.array([]),
                "ranks": np.zeros((0, 0), dtype=int)}
    rng = np.random.default_rng(seed)
    g = rng.gumbel(size=(n_samples, n))
    order = np.argsort(-(s[None, :] + g), axis=1)
    ranks = np.empty_like(order)
    rows = np.arange(n_samples)[:, None]
    ranks[rows, order] = np.arange(n)[None, :]
    return {
        "top3": (ranks < 3).mean(axis=0),
        "top5": (ranks < 5).mean(axis=0),
        "expected_finish": ranks.mean(axis=0) + 1.0,
        "ranks": ranks,
    }


def pairwise_ahead(ranks: np.ndarray, idx: Sequence[int]) -> np.ndarray:
    """``out[i][j]`` = P(entrant idx[i] finishes ahead of entrant idx[j]) from sampled ranks; diagonal 0.5."""
    idx = list(idx)
    k = len(idx)
    out = np.full((k, k), 0.5)
    if k == 0 or ranks.size == 0:
        return out
    sub = ranks[:, idx]
    for i in range(k):
        out[i] = (sub[:, i][:, None] < sub).mean(axis=0)
        out[i, i] = 0.5
    return out


def apply_temperature(prob: np.ndarray, race_ids: np.ndarray, temperature: float) -> np.ndarray:
    """Field probabilities rescaled by a score temperature: softmax(log p / T) within each race.

    For a softmax model this equals dividing the underlying scores by ``T``, so a
    temperature fitted on probabilities applies unchanged to the scores.
    """
    if float(temperature) == 1.0:
        return np.asarray(prob, dtype=float)
    return field_softmax(np.log(np.clip(np.asarray(prob, dtype=float), 1e-12, None)) / float(temperature), race_ids)


# ── feature transform ────────────────────────────────────────────────────
class FeatureTransform:
    """Median fill + explicit missing indicators + standardization, fitted on the training fold."""

    def __init__(self, features: Sequence[str], clip: float = 4.0):
        self.features = list(features)
        self.clip = float(clip)
        self.medians: Dict[str, float] = {}
        self.missing_cols: List[str] = []
        self.means: np.ndarray = np.zeros(0)
        self.sds: np.ndarray = np.ones(0)

    def fit(self, frame: pd.DataFrame) -> "FeatureTransform":
        X = frame[self.features].astype(float)
        self.missing_cols = [c for c in self.features if X[c].isna().any()]
        self.medians = {}
        for c in self.features:
            med = X[c].median() if X[c].notna().any() else np.nan
            self.medians[c] = float(med) if pd.notna(med) else 0.0
        Z = self._raw(frame)
        self.means = Z.mean(axis=0)
        self.sds = Z.std(axis=0)
        self.sds[self.sds < 1e-9] = 1.0
        # 0/1 flags (and the missing indicators) stay on their natural scale: a
        # rare flag standardized by its tiny sd would otherwise dominate the fit.
        binary = np.array([bool(np.all(np.isin(np.unique(Z[:, j]), [0.0, 1.0]))) for j in range(Z.shape[1])])
        self.means[binary] = 0.0
        self.sds[binary] = 1.0
        return self

    def _raw(self, frame: pd.DataFrame) -> np.ndarray:
        X = frame[self.features].astype(float)
        cols = [X[c].fillna(self.medians[c]).to_numpy() for c in self.features]
        cols += [X[c].isna().astype(float).to_numpy() for c in self.missing_cols]
        return np.column_stack(cols) if cols else np.zeros((len(frame), 0))

    def transform(self, frame: pd.DataFrame) -> np.ndarray:
        return np.clip((self._raw(frame) - self.means) / self.sds, -self.clip, self.clip)

    @property
    def names(self) -> List[str]:
        return self.features + [f"{c}__missing" for c in self.missing_cols]


# ── conditional logit ────────────────────────────────────────────────────
def cl_objective(w: np.ndarray, Z: np.ndarray, race_ids: np.ndarray, won: np.ndarray, l2: float) -> Tuple[float, np.ndarray]:
    """Penalized multinomial NLL and its gradient. ``Z`` rows need not be grouped."""
    s = np.dot(Z, w)  # np.dot: the matmul operator raises a spurious FP-flag warning on macOS numpy 2
    p = field_softmax(s, race_ids)
    won = won.astype(bool)
    nll = float(-np.sum(np.log(np.clip(p[won], 1e-300, None))))
    grad = -(Z[won].sum(axis=0) - (p[:, None] * Z).sum(axis=0))
    nll += 0.5 * l2 * float(np.dot(w, w))
    grad = grad + l2 * w
    return nll, grad


class ConditionalLogit:
    engine = "conditional_logit"
    algorithm = "Conditional logit (Plackett-Luce winner), L2, L-BFGS"

    L2_GRID = (3.0, 10.0, 30.0, 100.0, 300.0)

    def __init__(self, features: Sequence[str], l2: Optional[float] = None):
        """``l2=None`` picks the penalty from L2_GRID on a chronological validation slice of the training fold."""
        self.features = list(features)
        self.l2 = float(l2) if l2 is not None else None
        self.transform = FeatureTransform(features)
        self.weights: np.ndarray = np.zeros(0)
        self.converged = False
        self.n_races = 0

    @staticmethod
    def _solve(Z: np.ndarray, race_ids: np.ndarray, won: np.ndarray, l2: float) -> Tuple[np.ndarray, bool]:
        res = minimize(cl_objective, np.zeros(Z.shape[1]), args=(Z, race_ids, won, l2),
                       jac=True, method="L-BFGS-B", options={"maxiter": 500})
        return res.x, bool(res.success)

    def fit(self, frame: pd.DataFrame) -> "ConditionalLogit":
        frame = _trainable(frame)
        race_ids = frame["race_id"].to_numpy()
        won = frame["won"].to_numpy(dtype=float)
        self.n_races = int(len(np.unique(race_ids)))
        if self.l2 is None:
            tr, va = _chrono_split(frame, valid_share=0.25)
            if va.sum() and tr.sum():
                inner = FeatureTransform(self.features).fit(frame[tr])
                Ztr, Zva = inner.transform(frame[tr]), inner.transform(frame[va])
                best = None
                for l2 in self.L2_GRID:
                    w, _ = self._solve(Ztr, race_ids[tr], won[tr], l2)
                    nll = _field_nll(np.dot(Zva, w), race_ids[va], won[va]) / max(len(np.unique(race_ids[va])), 1)
                    if best is None or nll < best[0]:
                        best = (nll, l2)
                self.l2 = best[1]
            else:
                self.l2 = 30.0
        self.transform.fit(frame)
        Z = self.transform.transform(frame)
        self.weights, self.converged = self._solve(Z, race_ids, won, self.l2)
        return self

    def scores(self, frame: pd.DataFrame) -> np.ndarray:
        return np.dot(self.transform.transform(frame), self.weights)

    def predict_win(self, frame: pd.DataFrame) -> np.ndarray:
        return field_softmax(self.scores(frame), frame["race_id"].to_numpy())

    def feature_weights(self) -> List[Dict[str, float]]:
        return [{"name": n, "weight": round(float(w), 4)} for n, w in zip(self.transform.names, self.weights)]


# ── boosted softmax ──────────────────────────────────────────────────────
def _xgb(params: Dict[str, object], **extra: object):
    from xgboost import XGBClassifier
    return XGBClassifier(objective="binary:logistic", eval_metric="logloss", tree_method="hist",
                         n_jobs=4, random_state=42, missing=np.nan, **params, **extra)


def _chrono_split(frame: pd.DataFrame, valid_share: float = 0.15) -> Tuple[np.ndarray, np.ndarray]:
    order = frame[["race_id", "race_date"]].drop_duplicates("race_id").sort_values(["race_date", "race_id"])
    n_valid = max(int(round(len(order) * valid_share)), 1) if len(order) >= 10 else 0
    valid_ids = set(order["race_id"].iloc[len(order) - n_valid:]) if n_valid else set()
    valid = frame["race_id"].isin(valid_ids).to_numpy()
    return ~valid, valid


def _fit_temperature(logit: np.ndarray, race_ids: np.ndarray, won: np.ndarray) -> float:
    res = minimize_scalar(lambda t: _field_nll(logit / t, race_ids, won), bounds=(0.25, 8.0), method="bounded")
    return float(res.x)


class BoostedSoftmax:
    engine = "boosted_softmax"
    algorithm = "XGBoost binary score (depth 3, 300 trees, eta 0.03) with per-race temperature softmax"

    def __init__(self, features: Sequence[str]):
        self.features = list(features)
        self.model = None
        self.temperature = 1.0
        self.best_iteration: Optional[int] = None

    def fit(self, frame: pd.DataFrame) -> "BoostedSoftmax":
        frame = _trainable(frame)
        X = frame[self.features].astype(float)
        y = frame["won"].to_numpy(dtype=int)
        race_ids = frame["race_id"].to_numpy()
        tr, va = _chrono_split(frame)
        if va.sum() == 0:
            self.model = _xgb(BOOSTED_XGB_PARAMS).fit(X, y)
            self.temperature = 1.0
            return self
        probe = _xgb(BOOSTED_XGB_PARAMS, early_stopping_rounds=30)
        probe.fit(X[tr], y[tr], eval_set=[(X[va], y[va])], verbose=False)
        best = int(getattr(probe, "best_iteration", BOOSTED_XGB_PARAMS["n_estimators"] - 1)) + 1
        self.best_iteration = best
        logit_va = _logit(probe.predict_proba(X[va])[:, 1])
        self.temperature = _fit_temperature(logit_va, race_ids[va], frame["won"].to_numpy()[va])
        params = dict(BOOSTED_XGB_PARAMS)
        params["n_estimators"] = max(best, 20)
        self.model = _xgb(params).fit(X, y)
        return self

    def raw(self, frame: pd.DataFrame) -> np.ndarray:
        return self.model.predict_proba(frame[self.features].astype(float))[:, 1]

    def scores(self, frame: pd.DataFrame) -> np.ndarray:
        return _logit(self.raw(frame)) / self.temperature

    def predict_win(self, frame: pd.DataFrame) -> np.ndarray:
        return field_softmax(self.scores(frame), frame["race_id"].to_numpy())


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


# ── legacy method ────────────────────────────────────────────────────────
def legacy_normalizer(raw: np.ndarray, power: float = 0.65, max_probability: float = 0.45) -> np.ndarray:
    """The legacy ``calibrated_market_probabilities`` for one race (power transform, iterative cap)."""
    weights = [max(float(r), 1e-6) ** power for r in raw]
    total = sum(weights)
    probs = [w / total if total > 0 else 1.0 / len(weights) for w in weights]
    capped = [False] * len(probs)
    for _ in range(len(probs)):
        over = next((i for i, v in enumerate(probs) if not capped[i] and v > max_probability), None)
        if over is None:
            break
        excess = probs[over] - max_probability
        probs[over] = max_probability
        capped[over] = True
        open_idx = [i for i, c in enumerate(capped) if not c]
        open_total = sum(probs[i] for i in open_idx)
        if not open_idx or open_total <= 0:
            break
        for i in open_idx:
            probs[i] += excess * (probs[i] / open_total)
    total = sum(probs)
    return np.array([v / total if total > 0 else 1.0 / len(probs) for v in probs])


class LegacyMethod:
    engine = "legacy_method"
    algorithm = "Legacy XGBoost binary (700 trees, depth 4) + power 0.65 / cap 0.45 normalizer"

    def __init__(self, features: Sequence[str]):
        self.features = list(features)
        self.model = None

    def fit(self, frame: pd.DataFrame) -> "LegacyMethod":
        frame = _trainable(frame)
        X = frame[self.features].astype(float)
        y = frame["won"].to_numpy(dtype=int)
        spw = float((y == 0).sum()) / max(float((y == 1).sum()), 1.0)
        self.model = _xgb(LEGACY_XGB_PARAMS, scale_pos_weight=spw).fit(X, y)
        return self

    def predict_win(self, frame: pd.DataFrame) -> np.ndarray:
        raw = self.model.predict_proba(frame[self.features].astype(float))[:, 1]
        out = np.empty(len(frame))
        race_ids = frame["race_id"].to_numpy()
        for rid in np.unique(race_ids):
            idx = np.flatnonzero(race_ids == rid)
            out[idx] = legacy_normalizer(raw[idx])
        return out


# ── baselines ────────────────────────────────────────────────────────────
class FormOnly:
    engine = "form_only"
    algorithm = "softmax(-scale * last10_avg_finish)"

    def __init__(self, features: Sequence[str] = ()):
        self.scale = 0.1
        self.fill = 12.5

    def _x(self, frame: pd.DataFrame) -> np.ndarray:
        return -frame["last10_avg_finish"].astype(float).fillna(self.fill).to_numpy()

    def fit(self, frame: pd.DataFrame) -> "FormOnly":
        frame = _trainable(frame)
        med = frame["last10_avg_finish"].median()
        self.fill = float(med) if pd.notna(med) else 12.5
        x = self._x(frame)
        race_ids = frame["race_id"].to_numpy()
        won = frame["won"].to_numpy(dtype=float)
        res = minimize_scalar(lambda k: _field_nll(k * x, race_ids, won), bounds=(0.0, 5.0), method="bounded")
        self.scale = float(res.x)
        return self

    def predict_win(self, frame: pd.DataFrame) -> np.ndarray:
        return field_softmax(self.scale * self._x(frame), frame["race_id"].to_numpy())


class Uniform:
    engine = "uniform"
    algorithm = "1 / field size"

    def __init__(self, features: Sequence[str] = ()):
        pass

    def fit(self, frame: pd.DataFrame) -> "Uniform":
        return self

    def predict_win(self, frame: pd.DataFrame) -> np.ndarray:
        return field_softmax(np.zeros(len(frame)), frame["race_id"].to_numpy())


VARIANTS = {
    "cl": ConditionalLogit,
    "boosted": BoostedSoftmax,
    "legacy-method": LegacyMethod,
    "form-only": FormOnly,
    "uniform": Uniform,
}


def _trainable(frame: pd.DataFrame) -> pd.DataFrame:
    """Rows from races with exactly one recorded winner and at least two entrants."""
    g = frame.groupby("race_id")["won"]
    ok = (g.transform("sum") == 1) & (g.transform("size") >= 2)
    return frame[ok.to_numpy()].reset_index(drop=True)
