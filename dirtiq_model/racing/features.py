"""One vectorized, as-of-date feature builder shared by training and scoring.

Every history feature for a race on date D is computed from completed races
whose date is strictly earlier than D (same-day races are never visible, even
at the same track). The mechanism is ``pd.merge_asof(..., allow_exact_matches=False)``
against per-driver daily snapshots of cumulative / rolling statistics, so the
same code path serves historical rows (backtest) and upcoming races (scoring).

Race-night inputs (start, heat, B-main, qualifying rank, field size) come from
the target race's own entries and are the only non-history features.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from .data import RacingData

ELO_K = 24.0
ELO_START = 1500.0
EWM_HALF_LIFE = 10.0
SHRINK_CAREER = 5.0   # pseudo-starts pulled toward the series mean
SHRINK_TRACK = 3.0
SHRINK_SIMILAR = 3.0
PRIOR_WIN = 0.045
PRIOR_TOP3 = 0.14
PRIOR_FINISH = 12.5
PRIOR_DNF = 0.06


@dataclass(frozen=True)
class Feature:
    name: str
    stage: str      # "early" (history only) or "race-night" (needs tonight's inputs)
    meaning: str


FEATURES: List[Feature] = [
    Feature("log_career_starts", "early", "log1p(completed starts before this date, any series)"),
    Feature("career_win_rate", "early", "career win rate shrunk toward the as-of series mean (5 pseudo-starts)"),
    Feature("career_top3_rate", "early", "career top-3 rate, shrunk"),
    Feature("career_avg_finish", "early", "career average finishing position, shrunk toward the series mean"),
    Feature("career_dnf_rate", "early", "career DNF rate, shrunk"),
    Feature("last5_avg_finish", "early", "average finish over the previous 5 starts"),
    Feature("last10_avg_finish", "early", "average finish over the previous 10 starts"),
    Feature("last5_win_rate", "early", "win rate over the previous 5 starts"),
    Feature("last10_win_rate", "early", "win rate over the previous 10 starts"),
    Feature("ewm_finish", "early", "exponentially weighted average finish, half-life 10 starts"),
    Feature("ewm_win", "early", "exponentially weighted win indicator, half-life 10 starts"),
    Feature("log_days_since_last_start", "early", "log1p(days since the driver's previous completed start)"),
    Feature("won_last_14d", "early", "1 if the driver won a race in the previous 14 days"),
    Feature("podium_last_14d", "early", "1 if the driver finished top-3 in the previous 14 days"),
    Feature("log_track_starts", "early", "log1p(prior starts at this track)"),
    Feature("track_win_rate", "early", "win rate at this track, shrunk toward the career rate"),
    Feature("track_top3_rate", "early", "top-3 rate at this track, shrunk"),
    Feature("track_avg_finish", "early", "average finish at this track, shrunk toward the career average"),
    Feature("log_similar_track_starts", "early", "log1p(similarity-weighted prior starts at tracks listed in track_similars)"),
    Feature("similar_track_win_rate", "early", "similarity-weighted win rate at similar tracks, shrunk"),
    Feature("similar_track_avg_finish", "early", "similarity-weighted average finish at similar tracks, shrunk"),
    Feature("prev_same_track_3d", "early", "1 if the driver raced at this track in the previous 1-3 days (multi-night event)"),
    Feature("prev_same_track_win_3d", "early", "1 if the driver won at this track in the previous 1-3 days"),
    Feature("prev_same_track_top3_3d", "early", "1 if the driver finished top-3 at this track in the previous 1-3 days"),
    Feature("prev_same_track_finish_3d", "early", "finishing position at this track in the previous 1-3 days (NaN if none)"),
    Feature("crown_prior_podium_365d", "early", "1 if top-3 at a crown-jewel event in the previous 365 days"),
    Feature("crown_prior_win_365d", "early", "1 if won a crown-jewel event in the previous 365 days"),
    Feature("eldora_prior_podium_365d", "early", "1 if top-3 at Eldora in the previous 365 days"),
    Feature("elo", "early", "pairwise finishing-order Elo rating before this date (K=24, start 1500)"),
    Feature("elo_field_rel", "early", "Elo minus the mean Elo of tonight's field"),
    Feature("field_size", "early", "number of entrants scored in this race"),
    Feature("start_pos_norm", "race-night", "feature starting position scaled 0 (pole) to 1 (last)"),
    Feature("heat_pos_norm", "race-night", "heat finishing position scaled 0 to 1 across the field"),
    Feature("bmain_pos_norm", "race-night", "B-main finishing position scaled 0 to 1 among B-main transfers"),
    Feature("used_bmain_path", "race-night", "1 if the driver reached the feature through a B-main"),
    Feature("qt_rank_norm", "race-night", "qualifying-time rank scaled 0 (fastest) to 1 (slowest)"),
]

FEATURE_NAMES: List[str] = [f.name for f in FEATURES]
EARLY_FEATURES: List[str] = [f.name for f in FEATURES if f.stage == "early"]
RACE_NIGHT_FEATURES: List[str] = FEATURE_NAMES[:]
LABEL_COLUMNS = ["finishing_position", "won", "top3", "dnf"]
META_COLUMNS = ["race_id", "driver_id", "driver_name", "race_date", "year", "division", "name", "status",
                "track_id", "series_mode", "entry_status", "is_crown", "starting_position", "heat_position",
                "qualifying_time", "bmain_position"]


def features_for_stage(stage: str) -> List[str]:
    return RACE_NIGHT_FEATURES if stage == "race-night" else EARLY_FEATURES


def _shrink(num: pd.Series, den: pd.Series, prior: pd.Series, k: float) -> pd.Series:
    return (num.fillna(0.0) + k * prior) / (den.fillna(0.0) + k)


def _norm_rank(values: pd.Series) -> pd.Series:
    """(rank - 1) / (n - 1) among rows with a positive value; NaN elsewhere."""
    valid = values.where(values > 0)
    n = valid.notna().sum()
    if n == 0:
        return pd.Series(np.nan, index=values.index)
    rank = valid.rank(method="min")
    return (rank - 1.0) / max(n - 1, 1)


def _daily_last(frame: pd.DataFrame, keys: Sequence[str]) -> pd.DataFrame:
    """Keep the last row per (keys..., race_date), sorted by race_date for merge_asof."""
    out = frame.groupby(list(keys) + ["race_date"], sort=False).tail(1)
    return out.sort_values("race_date", kind="stable").reset_index(drop=True)


def _asof(targets: pd.DataFrame, history: pd.DataFrame, by: Sequence[str]) -> pd.DataFrame:
    """Join the latest history row strictly before each target date."""
    left = targets.sort_values("race_date", kind="stable")
    merged = pd.merge_asof(left, history, on="race_date", by=list(by), allow_exact_matches=False)
    merged.index = left.index
    return merged.reindex(targets.index)


def _elo_history(hist: pd.DataFrame, k: float = ELO_K) -> pd.DataFrame:
    """Rating after each date for drivers who raced that date (pairwise within-race Elo)."""
    ratings: Dict[int, float] = {}
    rows: List[tuple] = []
    ordered = hist.sort_values(["race_date", "race_id", "finishing_position"], kind="stable")
    for date, day in ordered.groupby("race_date", sort=True):
        touched: Dict[int, float] = {}
        for _, race in day.groupby("race_id", sort=True):
            drivers = race["driver_id"].to_numpy()
            fp = race["finishing_position"].to_numpy(dtype=float)
            n = len(drivers)
            if n < 2:
                continue
            r = np.array([ratings.get(int(d), ELO_START) for d in drivers])
            expected = 1.0 / (1.0 + 10.0 ** ((r[None, :] - r[:, None]) / 400.0))
            actual = (fp[:, None] < fp[None, :]).astype(float) + 0.5 * (fp[:, None] == fp[None, :])
            np.fill_diagonal(expected, 0.0)
            np.fill_diagonal(actual, 0.0)
            delta = k * (actual.sum(axis=1) - expected.sum(axis=1)) / (n - 1)
            for d, new in zip(drivers, r + delta):
                ratings[int(d)] = float(new)
                touched[int(d)] = float(new)
        for d, val in touched.items():
            rows.append((d, date, val))
    out = pd.DataFrame(rows, columns=["driver_id", "race_date", "elo_after"])
    return out.sort_values("race_date", kind="stable").reset_index(drop=True)


def build_features(data: RacingData, race_ids: Optional[Sequence[int]] = None) -> pd.DataFrame:
    """Feature frame: one row per scored entrant with META_COLUMNS, LABEL_COLUMNS and FEATURE_NAMES.

    ``race_ids`` restricts the target rows (history still uses every completed race).
    """
    races = data.races.copy()
    ent = data.entries.merge(
        races[["race_id", "race_date", "year", "division", "name", "status", "track_id", "series_mode",
               "is_crown", "is_eldora"]], on="race_id", how="inner")

    # ── history: completed starts only ───────────────────────────────────
    hist = ent[(ent["status"] == "complete") & ent["finishing_position"].notna()].copy()
    hist = hist.sort_values(["driver_id", "race_date", "race_id", "finishing_position"], kind="stable")
    hist["won"] = (hist["finishing_position"] == 1).astype(float)
    hist["top3"] = (hist["finishing_position"] <= 3).astype(float)
    hist["dnf_f"] = hist["dnf"].astype(float)

    # ── targets ───────────────────────────────────────────────────────────
    tgt = ent[(ent["entry_status"] != "scratched")
              & ((ent["status"] != "complete") | ent["finishing_position"].notna())].copy()
    if race_ids is not None:
        tgt = tgt[tgt["race_id"].isin([int(r) for r in race_ids])]
    tgt = tgt.sort_values(["race_date", "race_id", "driver_id"], kind="stable").reset_index(drop=True)
    tgt["won"] = (tgt["finishing_position"] == 1).astype(float).where(tgt["finishing_position"].notna())
    tgt["top3"] = (tgt["finishing_position"] <= 3).astype(float).where(tgt["finishing_position"].notna())
    out = tgt[META_COLUMNS + ["finishing_position", "won", "top3", "dnf"]].copy()

    # ── per-driver cumulative and rolling stats through each row ─────────
    g = hist.groupby("driver_id", sort=False)
    hist["c_n"] = g.cumcount() + 1
    hist["c_wins"] = g["won"].cumsum()
    hist["c_top3"] = g["top3"].cumsum()
    hist["c_fin"] = g["finishing_position"].cumsum()
    hist["c_dnf"] = g["dnf_f"].cumsum()
    hist["r5_fin"] = g["finishing_position"].transform(lambda s: s.rolling(5, min_periods=1).mean())
    hist["r10_fin"] = g["finishing_position"].transform(lambda s: s.rolling(10, min_periods=1).mean())
    hist["r5_win"] = g["won"].transform(lambda s: s.rolling(5, min_periods=1).mean())
    hist["r10_win"] = g["won"].transform(lambda s: s.rolling(10, min_periods=1).mean())
    hist["ewm_fin"] = g["finishing_position"].transform(lambda s: s.ewm(halflife=EWM_HALF_LIFE).mean())
    hist["ewm_w"] = g["won"].transform(lambda s: s.ewm(halflife=EWM_HALF_LIFE).mean())
    hist["last_date"] = hist["race_date"]
    for col, mask in (("last_win_date", hist["won"] > 0), ("last_podium_date", hist["top3"] > 0),
                      ("last_crown_podium_date", (hist["top3"] > 0) & hist["is_crown"]),
                      ("last_crown_win_date", (hist["won"] > 0) & hist["is_crown"]),
                      ("last_eldora_podium_date", (hist["top3"] > 0) & hist["is_eldora"])):
        hist[col] = hist["race_date"].where(mask)
        hist[col] = hist.groupby("driver_id", sort=False)[col].cummax()
    drv_cols = ["c_n", "c_wins", "c_top3", "c_fin", "c_dnf", "r5_fin", "r10_fin", "r5_win", "r10_win",
                "ewm_fin", "ewm_w", "last_date", "last_win_date", "last_podium_date",
                "last_crown_podium_date", "last_crown_win_date", "last_eldora_podium_date"]
    drv_daily = _daily_last(hist[["driver_id", "race_date"] + drv_cols], ["driver_id"])
    d = _asof(out[["driver_id", "race_date"]], drv_daily, ["driver_id"])

    # ── series as-of means (shrinkage priors) ────────────────────────────
    ser = hist.sort_values(["division", "race_date", "race_id"], kind="stable").copy()
    sg = ser.groupby("division", sort=False)
    ser["s_n"] = sg.cumcount() + 1
    ser["s_wins"] = sg["won"].cumsum()
    ser["s_top3"] = sg["top3"].cumsum()
    ser["s_fin"] = sg["finishing_position"].cumsum()
    ser["s_dnf"] = sg["dnf_f"].cumsum()
    ser_daily = _daily_last(ser[["division", "race_date", "s_n", "s_wins", "s_top3", "s_fin", "s_dnf"]], ["division"])
    s = _asof(out[["division", "race_date"]], ser_daily, ["division"])
    prior_win = (s["s_wins"] / s["s_n"]).fillna(PRIOR_WIN)
    prior_top3 = (s["s_top3"] / s["s_n"]).fillna(PRIOR_TOP3)
    prior_fin = (s["s_fin"] / s["s_n"]).fillna(PRIOR_FINISH)
    prior_dnf = (s["s_dnf"] / s["s_n"]).fillna(PRIOR_DNF)

    n = d["c_n"].fillna(0.0)
    out["log_career_starts"] = np.log1p(n)
    out["career_win_rate"] = _shrink(d["c_wins"], n, prior_win, SHRINK_CAREER)
    out["career_top3_rate"] = _shrink(d["c_top3"], n, prior_top3, SHRINK_CAREER)
    out["career_avg_finish"] = _shrink(d["c_fin"], n, prior_fin, SHRINK_CAREER)
    out["career_dnf_rate"] = _shrink(d["c_dnf"], n, prior_dnf, SHRINK_CAREER)
    out["last5_avg_finish"] = d["r5_fin"]
    out["last10_avg_finish"] = d["r10_fin"]
    out["last5_win_rate"] = d["r5_win"]
    out["last10_win_rate"] = d["r10_win"]
    out["ewm_finish"] = d["ewm_fin"]
    out["ewm_win"] = d["ewm_w"]
    days_since = (out["race_date"] - d["last_date"]).dt.days
    out["log_days_since_last_start"] = np.log1p(days_since.astype(float))
    out["won_last_14d"] = ((out["race_date"] - d["last_win_date"]).dt.days <= 14).astype(float)
    out["podium_last_14d"] = ((out["race_date"] - d["last_podium_date"]).dt.days <= 14).astype(float)
    out["crown_prior_podium_365d"] = ((out["race_date"] - d["last_crown_podium_date"]).dt.days <= 365).astype(float)
    out["crown_prior_win_365d"] = ((out["race_date"] - d["last_crown_win_date"]).dt.days <= 365).astype(float)
    out["eldora_prior_podium_365d"] = ((out["race_date"] - d["last_eldora_podium_date"]).dt.days <= 365).astype(float)

    # ── track-specific history ───────────────────────────────────────────
    th = hist.sort_values(["driver_id", "track_id", "race_date", "race_id"], kind="stable").copy()
    tg = th.groupby(["driver_id", "track_id"], sort=False)
    th["t_n"] = tg.cumcount() + 1
    th["t_wins"] = tg["won"].cumsum()
    th["t_top3"] = tg["top3"].cumsum()
    th["t_fin"] = tg["finishing_position"].cumsum()
    th["t_last_date"] = th["race_date"]
    th["t_last_fin"] = th["finishing_position"]
    trk_daily = _daily_last(th[["driver_id", "track_id", "race_date", "t_n", "t_wins", "t_top3", "t_fin",
                                "t_last_date", "t_last_fin"]], ["driver_id", "track_id"])
    t = _asof(out[["driver_id", "track_id", "race_date"]], trk_daily, ["driver_id", "track_id"])
    tn = t["t_n"].fillna(0.0)
    out["log_track_starts"] = np.log1p(tn)
    out["track_win_rate"] = _shrink(t["t_wins"], tn, out["career_win_rate"], SHRINK_TRACK)
    out["track_top3_rate"] = _shrink(t["t_top3"], tn, out["career_top3_rate"], SHRINK_TRACK)
    out["track_avg_finish"] = _shrink(t["t_fin"], tn, out["career_avg_finish"], SHRINK_TRACK)
    gap = (out["race_date"] - t["t_last_date"]).dt.days
    within3 = (gap >= 1) & (gap <= 3)
    out["prev_same_track_3d"] = within3.astype(float)
    out["prev_same_track_win_3d"] = (within3 & (t["t_last_fin"] == 1)).astype(float)
    out["prev_same_track_top3_3d"] = (within3 & (t["t_last_fin"] <= 3)).astype(float)
    out["prev_same_track_finish_3d"] = t["t_last_fin"].where(within3)

    # ── similar-track history (track_similars, both directions) ──────────
    sim = data.similars
    if len(sim):
        keyed = out[["driver_id", "track_id", "race_date"]].copy()
        keyed["row_key"] = np.arange(len(keyed))
        expanded = keyed.merge(sim, on="track_id", how="inner")
        if len(expanded):
            sim_hist = trk_daily.rename(columns={"track_id": "similar_track_id"})[
                ["driver_id", "similar_track_id", "race_date", "t_n", "t_wins", "t_fin"]]
            expanded = expanded.reset_index(drop=True)
            m = _asof(expanded[["driver_id", "similar_track_id", "race_date"]], sim_hist,
                      ["driver_id", "similar_track_id"])
            w = expanded["weight"].to_numpy()
            agg = pd.DataFrame({
                "row_key": expanded["row_key"].to_numpy(),
                "ws_n": w * m["t_n"].fillna(0.0).to_numpy(),
                "ws_wins": w * m["t_wins"].fillna(0.0).to_numpy(),
                "ws_fin": w * m["t_fin"].fillna(0.0).to_numpy(),
            }).groupby("row_key").sum()
            agg = agg.reindex(np.arange(len(out))).fillna(0.0)
        else:
            agg = pd.DataFrame(0.0, index=np.arange(len(out)), columns=["ws_n", "ws_wins", "ws_fin"])
    else:
        agg = pd.DataFrame(0.0, index=np.arange(len(out)), columns=["ws_n", "ws_wins", "ws_fin"])
    ws_n = pd.Series(agg["ws_n"].to_numpy(), index=out.index)
    out["log_similar_track_starts"] = np.log1p(ws_n)
    out["similar_track_win_rate"] = _shrink(pd.Series(agg["ws_wins"].to_numpy(), index=out.index), ws_n,
                                            out["career_win_rate"], SHRINK_SIMILAR)
    out["similar_track_avg_finish"] = _shrink(pd.Series(agg["ws_fin"].to_numpy(), index=out.index), ws_n,
                                              out["career_avg_finish"], SHRINK_SIMILAR)

    # ── Elo ───────────────────────────────────────────────────────────────
    elo_daily = _elo_history(hist)
    e = _asof(out[["driver_id", "race_date"]], elo_daily, ["driver_id"])
    out["elo"] = e["elo_after"].fillna(ELO_START)
    out["elo_field_rel"] = out["elo"] - out.groupby("race_id")["elo"].transform("mean")

    # ── race-night inputs from the target race itself ────────────────────
    rg = out.groupby("race_id", sort=False)
    out["field_size"] = rg["driver_id"].transform("size").astype(float)
    out["start_pos_norm"] = rg["starting_position"].transform(_norm_rank)
    out["heat_pos_norm"] = rg["heat_position"].transform(_norm_rank)
    out["bmain_pos_norm"] = rg["bmain_position"].transform(_norm_rank)
    out["used_bmain_path"] = (out["bmain_position"].fillna(0) > 0).astype(float)
    out["qt_rank_norm"] = rg["qualifying_time"].transform(_norm_rank)

    for name in FEATURE_NAMES:
        out[name] = out[name].astype(float)
    return out.reset_index(drop=True)


def race_night_coverage(frame: pd.DataFrame) -> pd.DataFrame:
    """Per race: share of the field with start / heat / qualifying inputs (legacy rule inputs)."""
    g = frame.groupby("race_id")
    cov = pd.DataFrame({
        "field": g["driver_id"].size(),
        "start": g["starting_position"].apply(lambda s: (s > 0).sum()),
        "heat": g["heat_position"].apply(lambda s: (s > 0).sum()),
        "qualifying": g["qualifying_time"].apply(lambda s: (s > 0).sum()),
    })
    for c in ("start", "heat", "qualifying"):
        cov[c] = cov[c] / cov["field"].clip(lower=1)
    cov["race_night"] = (cov["start"] >= 0.70) & ((cov["heat"] >= 0.50) | (cov["qualifying"] >= 0.50))
    return cov
