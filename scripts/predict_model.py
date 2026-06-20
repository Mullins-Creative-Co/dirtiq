#!/usr/bin/env python3
"""
Score a Dirt IQ race with the trained gradient-boosting model artifacts.

The feature builder mirrors scripts/train_model.py and only uses data available
before the target race plus any entered pre-race fields for that target race.
"""

import json
import pickle
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"

CROWN_PATTERNS = [
    "show-me",
    "show me",
    "prairie dirt",
    "usa nationals",
    "world finals",
    "knoxville",
    "north/south",
    "north south",
    "topless",
    "dream",
    "world 100",
    "firecracker",
    "pdc",
    "gopher 50",
    "hawkeye 100",
    "ralph latham",
    "dirt million",
    "gateway",
    "jackson 100",
    "hillbilly",
    "national 100",
    "silver dollar",
    "florence",
    "eldora",
    "dirt track world championship",
    "dtwc",
]


def normalize(value):
    return re.sub(r"[^a-z0-9\s/]+", "", (value or "").lower()).strip()


def slug(series):
    return re.sub(r"[^a-z0-9]+", "_", series.lower()).strip("_")


def race_primary_series(value):
    key = normalize(value)
    if "crown" in key or "combined" in key:
        return "Crown Jewel / Combined"
    if "lucas" in key:
        return "Lucas Oil LMDS"
    if "woo" in key or "world of outlaws" in key:
        return "WoO Late Models"
    if "summer nationals" in key or "hell tour" in key or "helltour" in key or "dirtcar" in key:
        return "DIRTcar Summer Nationals"
    return None


def is_crown_jewel_name(value):
    key = normalize(value)
    return any(normalize(pattern) in key for pattern in CROWN_PATTERNS)


def is_crown_event_name(race_name, track_name):
    key = normalize(f"{race_name or ''} {track_name or ''}")
    return any(normalize(pattern) in key for pattern in CROWN_PATTERNS)


def parse_date(value):
    return datetime.strptime(str(value)[:10], "%Y-%m-%d")


def resolve_race_model_series(race, model_override=None):
    if model_override:
        return model_override, "manual override"

    race_name = race["name"] or ""
    if is_crown_jewel_name(race_name):
        return "Crown Jewel / Combined", "crown jewel event name"

    series = race_primary_series(race["series_mode"] or race["division"])
    if series:
        return series, "race series"

    key = normalize(race["series_mode"] or race["division"])
    if "independent" in key or "open" in key or "late model" in key:
        return "Crown Jewel / Combined", "open/independent late model race"

    return "WoO Late Models", "fallback"


def track_size_label(length):
    if length is None or length <= 0:
        return None
    known = {
        0.25: "1/4",
        0.30: "3/10",
        1 / 3: "1/3",
        0.375: "3/8",
        0.40: "4/10",
        0.4375: "7/16",
        0.50: "1/2",
        0.625: "5/8",
    }
    return min(known.items(), key=lambda item: abs(item[0] - length))[1]


def distance_bucket(laps):
    laps = laps or 40
    if laps <= 40:
        return 0.0
    if laps <= 70:
        return 1.0
    if laps <= 100:
        return 2.0
    return 3.0


def track_len_bucket(length):
    length = length or 0
    if length <= 0.01:
        return 0.0
    if length <= 0.3:
        return 1.0
    if length <= 0.45:
        return 2.0
    if length <= 0.6:
        return 3.0
    return 4.0


def nanmean(values):
    return float(np.mean(values)) if values else np.nan


def resolve_metric_series(con, driver_id, race_series, entry_series):
    entry_primary = race_primary_series(entry_series)
    available = {
        row["series"]
        for row in con.execute(
            "SELECT series FROM driver_model_metrics WHERE driver_id = ?", (driver_id,)
        ).fetchall()
    }
    if entry_primary and entry_primary in available:
        return entry_primary
    if race_series and race_series in available:
        return race_series

    driver = con.execute("SELECT division FROM drivers WHERE id = ?", (driver_id,)).fetchone()
    driver_series = race_primary_series(driver["division"] if driver else None)
    if driver_series and driver_series in available:
        return driver_series

    season = con.execute(
        """SELECT series
           FROM driver_season_stats
           WHERE driver_id = ?
           ORDER BY season DESC, starts DESC
           LIMIT 1""",
        (driver_id,),
    ).fetchone()
    if season and season["series"] in available:
        return season["series"]

    best = con.execute(
        """SELECT series
           FROM driver_model_metrics
           WHERE driver_id = ?
           ORDER BY COALESCE(feature_wins, 0) + COALESCE(top5s, 0) * 0.25 + COALESCE(laps_led, 0) * 0.01 DESC
           LIMIT 1""",
        (driver_id,),
    ).fetchone()
    return best["series"] if best else (race_series or "WoO Late Models")


def prior_rows(con, driver_id, track_id, race_id, race_date, series):
    params = {
        "driver_id": driver_id,
        "track_id": track_id,
        "race_id": race_id,
        "race_date": race_date,
        "series": series,
    }
    params["crown"] = "Crown Jewel / Combined"
    crown_where = ""
    if series == "Crown Jewel / Combined":
        crown_where = """AND (
             r.division = 'Crown Jewel / Combined'
             OR (
               r.division IN ('WoO Late Models', 'Lucas Oil LMDS')
               AND (
                 lower(r.name) LIKE '%show-me%' OR lower(r.name) LIKE '%show me%' OR
                 lower(r.name) LIKE '%prairie dirt%' OR lower(r.name) LIKE '%usa nationals%' OR
                 lower(r.name) LIKE '%world finals%' OR lower(r.name) LIKE '%knoxville%' OR
                 lower(r.name) LIKE '%north/south%' OR lower(r.name) LIKE '%north south%' OR
                 lower(r.name) LIKE '%topless%' OR lower(r.name) LIKE '%dream%' OR
                 lower(r.name) LIKE '%world 100%' OR lower(r.name) LIKE '%firecracker%' OR
                 lower(r.name) LIKE '%pdc%' OR lower(r.name) LIKE '%gopher 50%' OR
                 lower(r.name) LIKE '%hawkeye 100%' OR lower(r.name) LIKE '%ralph latham%' OR
                 lower(r.name) LIKE '%dirt million%' OR lower(r.name) LIKE '%gateway%' OR
                 lower(r.name) LIKE '%jackson 100%' OR lower(r.name) LIKE '%hillbilly%' OR
                 lower(r.name) LIKE '%national 100%' OR lower(r.name) LIKE '%silver dollar%' OR
                 lower(r.name) LIKE '%florence%' OR lower(r.name) LIKE '%eldora%'
               )
             )
           )"""
    else:
        crown_where = "AND r.division = :series"

    rows = con.execute(
        f"""SELECT r.id AS race_id, r.name AS race_name, r.race_date, r.track_id,
                  t.name AS track_name, re.finishing_position, re.starting_position, re.dnf
           FROM race_entries re
           JOIN races r ON r.id = re.race_id
           JOIN tracks t ON t.id = r.track_id
           WHERE re.driver_id = :driver_id
             AND r.status = 'complete'
             {crown_where}
             AND re.finishing_position IS NOT NULL
             AND re.dnf = 0
             AND (r.race_date < :race_date OR (r.race_date = :race_date AND r.id < :race_id))
           ORDER BY r.race_date, r.id""",
        params,
    ).fetchall()
    track_rows = [row for row in rows if row["track_id"] == track_id]
    return rows, track_rows


def prior_similar_track_rows(con, driver_id, track_id, race_id, race_date, series):
    params = {
        "driver_id": driver_id,
        "track_id": track_id,
        "race_id": race_id,
        "race_date": race_date,
        "series": series,
    }
    if series == "Crown Jewel / Combined":
        crown_where = """AND (
             r.division = 'Crown Jewel / Combined'
             OR (
               r.division IN ('WoO Late Models', 'Lucas Oil LMDS')
               AND (
                 lower(r.name) LIKE '%show-me%' OR lower(r.name) LIKE '%show me%' OR
                 lower(r.name) LIKE '%prairie dirt%' OR lower(r.name) LIKE '%usa nationals%' OR
                 lower(r.name) LIKE '%world finals%' OR lower(r.name) LIKE '%knoxville%' OR
                 lower(r.name) LIKE '%north/south%' OR lower(r.name) LIKE '%north south%' OR
                 lower(r.name) LIKE '%topless%' OR lower(r.name) LIKE '%dream%' OR
                 lower(r.name) LIKE '%world 100%' OR lower(r.name) LIKE '%firecracker%' OR
                 lower(r.name) LIKE '%pdc%' OR lower(r.name) LIKE '%gopher 50%' OR
                 lower(r.name) LIKE '%hawkeye 100%' OR lower(r.name) LIKE '%ralph latham%' OR
                 lower(r.name) LIKE '%dirt million%' OR lower(r.name) LIKE '%gateway%' OR
                 lower(r.name) LIKE '%jackson 100%' OR lower(r.name) LIKE '%hillbilly%' OR
                 lower(r.name) LIKE '%national 100%' OR lower(r.name) LIKE '%silver dollar%' OR
                 lower(r.name) LIKE '%florence%' OR lower(r.name) LIKE '%eldora%'
               )
             )
           )"""
    else:
        crown_where = "AND r.division = :series"

    return con.execute(
        f"""SELECT
             re.finishing_position,
             CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END AS win,
             CASE WHEN re.finishing_position <= 3 THEN 1 ELSE 0 END AS top3,
             ts.similarity_weight
           FROM track_similars ts
           JOIN races r
             ON r.track_id = CASE
               WHEN ts.track_id = :track_id THEN ts.similar_track_id
               ELSE ts.track_id
             END
           JOIN race_entries re ON re.race_id = r.id
           WHERE (ts.track_id = :track_id OR ts.similar_track_id = :track_id)
             AND re.driver_id = :driver_id
             AND r.status = 'complete'
             {crown_where}
             AND re.finishing_position IS NOT NULL
             AND re.dnf = 0
             AND (r.race_date < :race_date OR (r.race_date = :race_date AND r.id < :race_id))""",
        params,
    ).fetchall()


def prior_same_track_multinight(con, driver_id, track_id, race_id, race_date, series):
    params = {
        "driver_id": driver_id,
        "track_id": track_id,
        "race_id": race_id,
        "race_date": race_date,
        "series": series,
    }
    if series == "Crown Jewel / Combined":
        crown_where = """AND (
             r.division = 'Crown Jewel / Combined'
             OR (
               r.division IN ('WoO Late Models', 'Lucas Oil LMDS')
               AND (
                 lower(r.name) LIKE '%show-me%' OR lower(r.name) LIKE '%show me%' OR
                 lower(r.name) LIKE '%prairie dirt%' OR lower(r.name) LIKE '%usa nationals%' OR
                 lower(r.name) LIKE '%world finals%' OR lower(r.name) LIKE '%knoxville%' OR
                 lower(r.name) LIKE '%north/south%' OR lower(r.name) LIKE '%north south%' OR
                 lower(r.name) LIKE '%topless%' OR lower(r.name) LIKE '%dream%' OR
                 lower(r.name) LIKE '%world 100%' OR lower(r.name) LIKE '%firecracker%' OR
                 lower(r.name) LIKE '%pdc%' OR lower(r.name) LIKE '%gopher 50%' OR
                 lower(r.name) LIKE '%hawkeye 100%' OR lower(r.name) LIKE '%ralph latham%' OR
                 lower(r.name) LIKE '%dirt million%' OR lower(r.name) LIKE '%gateway%' OR
                 lower(r.name) LIKE '%jackson 100%' OR lower(r.name) LIKE '%hillbilly%' OR
                 lower(r.name) LIKE '%national 100%' OR lower(r.name) LIKE '%silver dollar%' OR
                 lower(r.name) LIKE '%florence%' OR lower(r.name) LIKE '%eldora%'
               )
             )
           )"""
    else:
        crown_where = "AND r.division = :series"

    return con.execute(
        f"""SELECT re.finishing_position,
                  julianday(:race_date) - julianday(r.race_date) AS days_since
           FROM race_entries re
           JOIN races r ON r.id = re.race_id
           WHERE re.driver_id = :driver_id
             AND r.track_id = :track_id
             AND r.status = 'complete'
             {crown_where}
             AND re.finishing_position IS NOT NULL
             AND COALESCE(re.dnf, 0) = 0
             AND r.race_date < :race_date
             AND (julianday(:race_date) - julianday(r.race_date)) <= 3
             AND r.id != :race_id
           ORDER BY r.race_date DESC, r.id DESC""",
        params,
    ).fetchall()


def build_row(con, race, entry, ranks, features, model_series=None):
    driver_id = entry["driver_id"]
    race_series = race_primary_series(race["series_mode"] or race["division"])
    metric_series = model_series or resolve_metric_series(con, driver_id, race_series, entry["entry_series"])
    aggregate_metric_series = metric_series
    if metric_series == "Crown Jewel / Combined":
        aggregate_metric_series = resolve_metric_series(con, driver_id, None, entry["entry_series"])
    rows, track_rows = prior_rows(
        con,
        driver_id,
        race["track_id"],
        race["id"],
        race["race_date"],
        metric_series,
    )
    similar_rows = prior_similar_track_rows(
        con,
        driver_id,
        race["track_id"],
        race["id"],
        race["race_date"],
        metric_series,
    )
    multinight_rows = prior_same_track_multinight(
        con,
        driver_id,
        race["track_id"],
        race["id"],
        race["race_date"],
        metric_series,
    )

    finishes = [row["finishing_position"] for row in rows]
    track_finishes = [row["finishing_position"] for row in track_rows]
    similar_starts = sum(float(row["similarity_weight"]) for row in similar_rows)
    similar_wins = sum(float(row["win"]) * float(row["similarity_weight"]) for row in similar_rows)
    similar_top3 = sum(float(row["top3"]) * float(row["similarity_weight"]) for row in similar_rows)
    similar_finish_points = sum(
        float(row["finishing_position"]) * float(row["similarity_weight"]) for row in similar_rows
    )
    wins = [1 if pos == 1 else 0 for pos in finishes]
    top3 = [1 if pos <= 3 else 0 for pos in finishes]
    top5 = [1 if pos <= 5 else 0 for pos in finishes]
    plus_minus_values = [
        row["starting_position"] - row["finishing_position"]
        for row in rows
        if row["starting_position"] is not None
    ]
    deep_start_top3 = [
        row for row in rows
        if row["starting_position"] is not None
        and row["starting_position"] > 8
        and row["finishing_position"] <= 3
    ]
    deep_start_wins = [
        row for row in rows
        if row["starting_position"] is not None
        and row["starting_position"] > 8
        and row["finishing_position"] == 1
    ]
    track_wins = [1 if pos == 1 else 0 for pos in track_finishes]
    track_top3 = [1 if pos <= 3 else 0 for pos in track_finishes]
    current_date = parse_date(race["race_date"])
    recent_7 = [
        row for row in rows
        if 0 < (current_date - parse_date(row["race_date"])).days <= 7
    ]
    recent_14 = [
        row for row in rows
        if 0 < (current_date - parse_date(row["race_date"])).days <= 14
    ]
    recent_365 = [
        row for row in rows
        if 0 < (current_date - parse_date(row["race_date"])).days <= 365
    ]
    last_start = rows[-1] if rows else None
    prev_same_track_win_3d = any(row["finishing_position"] == 1 for row in multinight_rows)
    prev_same_track_top3_3d = any(row["finishing_position"] <= 3 for row in multinight_rows)
    win_days = [
        float(row["days_since"])
        for row in multinight_rows
        if row["finishing_position"] == 1 and row["days_since"] is not None
    ]

    streak = 0
    for row in reversed(rows):
        if row["finishing_position"] <= 3:
            streak += 1
        else:
            break

    metric = con.execute(
        """SELECT
             last5_avg_finish AS agg_last5_avg_finish,
             avg_finish AS agg_avg_finish,
             avg_start AS agg_avg_start,
             avg_qual_position AS agg_avg_qual_position,
             quick_times AS agg_quick_times,
             qual_attempts AS agg_qual_attempts,
             feature_wins,
             laps_led_per_win,
             top5s,
             top10s,
             laps_led AS agg_laps_led,
             hard_charger_count,
             heat_wins AS agg_heat_wins
           FROM driver_model_metrics
           WHERE driver_id = ? AND series = ?""",
        (driver_id, aggregate_metric_series),
    ).fetchone()
    metric = dict(metric) if metric else {}

    equipment = con.execute(
        """SELECT chassis_family, engine_family, shock_family
           FROM driver_equipment_profiles
           WHERE driver_id = ?""",
        (driver_id,),
    ).fetchone()
    equipment = dict(equipment) if equipment else {}

    track_size = track_size_label(race["track_length"])
    track_size_wins = 0.0
    if track_size:
        row = con.execute(
            """SELECT wins
               FROM driver_track_size_wins
               WHERE driver_id = ? AND series = ? AND track_size = ?""",
            (driver_id, aggregate_metric_series, track_size),
        ).fetchone()
        track_size_wins = float(row["wins"]) if row else 0.0

    qual_attempts = metric.get("agg_qual_attempts") or 0
    quick_times = metric.get("agg_quick_times") or 0

    year = int(str(race["race_date"])[:4])
    values = {
        "career_starts": len(rows),
        "career_win_rate": nanmean(wins),
        "career_avg_finish": nanmean(finishes),
        "career_top3_rate": nanmean(top3),
        "last5_avg_finish": nanmean(finishes[-5:]),
        "last10_avg_finish": nanmean(finishes[-10:]),
        "last5_win_rate": nanmean(wins[-5:]),
        "recent_wins_3": sum(wins[-3:]),
        "recent_wins_5": sum(wins[-5:]),
        "recent_podiums_3": sum(top3[-3:]),
        "won_last_7d": 1.0 if any(row["finishing_position"] == 1 for row in recent_7) else 0.0,
        "won_last_14d": 1.0 if any(row["finishing_position"] == 1 for row in recent_14) else 0.0,
        "podium_last_14d": 1.0 if any(row["finishing_position"] <= 3 for row in recent_14) else 0.0,
        "top5_last_14d": 1.0 if any(row["finishing_position"] <= 5 for row in recent_14) else 0.0,
        "last_start_was_win": 1.0 if last_start and last_start["finishing_position"] == 1 else 0.0,
        "last_start_was_podium": 1.0 if last_start and last_start["finishing_position"] <= 3 else 0.0,
        "finished_top5_last_start": 1.0 if last_start and last_start["finishing_position"] <= 5 else 0.0,
        "prior_deep_start_top3_count": len(deep_start_top3),
        "prior_deep_start_win_count": len(deep_start_wins),
        "prior_plus_minus_avg": nanmean(plus_minus_values),
        "last5_plus_minus_avg": nanmean(plus_minus_values[-5:]),
        "streak_top3": streak,
        "track_starts": len(track_rows),
        "track_win_rate": nanmean(track_wins),
        "track_avg_finish": nanmean(track_finishes),
        "track_top3_rate": nanmean(track_top3),
        "same_track_prior_win": 1.0 if any(pos == 1 for pos in track_finishes) else 0.0,
        "same_track_prior_top3": 1.0 if any(pos <= 3 for pos in track_finishes) else 0.0,
        "similar_track_starts": similar_starts,
        "similar_track_win_rate": similar_wins / similar_starts if similar_starts else np.nan,
        "similar_track_top3_rate": similar_top3 / similar_starts if similar_starts else np.nan,
        "similar_track_avg_finish": similar_finish_points / similar_starts if similar_starts else np.nan,
        "similar_track_prior_win": 1.0 if similar_wins > 0 else 0.0,
        "similar_track_prior_top3": 1.0 if similar_top3 > 0 else 0.0,
        "crown_prior_top3_365d": 1.0 if any(
            row["finishing_position"] <= 3 and is_crown_event_name(row["race_name"], row["track_name"])
            for row in recent_365
        ) else 0.0,
        "crown_prior_win_365d": 1.0 if any(
            row["finishing_position"] == 1 and is_crown_event_name(row["race_name"], row["track_name"])
            for row in recent_365
        ) else 0.0,
        "crown_prior_deep_top3_365d": 1.0 if any(
            row["finishing_position"] <= 3
            and row["starting_position"] is not None
            and row["starting_position"] > 8
            and is_crown_event_name(row["race_name"], row["track_name"])
            for row in recent_365
        ) else 0.0,
        "eldora_prior_top3_365d": 1.0 if any(
            row["finishing_position"] <= 3 and "eldora" in normalize(row["track_name"])
            for row in recent_365
        ) else 0.0,
        "prev_same_track_win_3d": 1.0 if prev_same_track_win_3d else 0.0,
        "prev_same_track_top3_3d": 1.0 if prev_same_track_top3_3d else 0.0,
        "days_since_same_track_win": min(win_days) if win_days else np.nan,
        "start_pos_norm": ranks["start"].get(driver_id, np.nan),
        "heat_pos_norm": ranks["heat"].get(driver_id, np.nan),
        "bmain_pos_norm": ranks["bmain"].get(driver_id, np.nan),
        "used_bmain_path": 1.0 if entry.get("bmain_position") is not None else 0.0,
        "qt_rank_norm": ranks["qt"].get(driver_id, np.nan),
        "dist_bucket": distance_bucket(race["distance"]),
        "track_len_bucket": track_len_bucket(race["track_length"]),
        "years_since_2021": max(0, year - 2021),
        "agg_last5_avg_finish": metric.get("agg_last5_avg_finish", np.nan),
        "agg_avg_finish": metric.get("agg_avg_finish", np.nan),
        "agg_avg_start": metric.get("agg_avg_start", np.nan),
        "agg_avg_qual_position": metric.get("agg_avg_qual_position", np.nan),
        "agg_qual_rate": quick_times / qual_attempts if qual_attempts else np.nan,
        "laps_led_per_win": metric.get("laps_led_per_win", np.nan),
        "log_feature_wins": np.log1p(metric.get("feature_wins") or 0),
        "log_top5s": np.log1p(metric.get("top5s") or 0),
        "log_top10s": np.log1p(metric.get("top10s") or 0),
        "log_agg_laps_led": np.log1p(metric.get("agg_laps_led") or 0),
        "log_hard_charger_count": np.log1p(metric.get("hard_charger_count") or 0),
        "log_agg_heat_wins": np.log1p(metric.get("agg_heat_wins") or 0),
        "log_aggregate_track_size_wins": np.log1p(track_size_wins),
        "chassis_longhorn": 1.0 if equipment.get("chassis_family") == "Longhorn" else 0.0,
        "chassis_rocket": 1.0 if equipment.get("chassis_family") == "Rocket" else 0.0,
        "engine_clements": 1.0 if equipment.get("engine_family") == "Clements" else 0.0,
        "engine_cornett": 1.0 if equipment.get("engine_family") == "Cornett" else 0.0,
        "engine_durham": 1.0 if equipment.get("engine_family") == "Durham" else 0.0,
        "engine_vic_hill": 1.0 if equipment.get("engine_family") == "Vic Hill" else 0.0,
        "shock_ohlins": 1.0 if equipment.get("shock_family") == "Ohlins" else 0.0,
        "shock_bilstein": 1.0 if equipment.get("shock_family") == "Bilstein" else 0.0,
        "shock_penske": 1.0 if equipment.get("shock_family") == "Penske" else 0.0,
        "shock_integra": 1.0 if equipment.get("shock_family") == "Integra" else 0.0,
    }
    return [values.get(feature, np.nan) for feature in features], metric_series


def normalized_rank(entries, key, ascending=True):
    valid = [entry for entry in entries if entry[key] is not None and entry[key] > 0]
    if not valid:
        return {}
    if key == "qualifying_time":
        valid.sort(key=lambda entry: entry[key])
    else:
        valid.sort(key=lambda entry: entry[key], reverse=not ascending)
    n = len(valid)
    out = {}
    for index, entry in enumerate(valid):
        if key == "qualifying_time":
            out[entry["driver_id"]] = index / max(n - 1, 1)
        else:
            out[entry["driver_id"]] = (entry[key] - 1) / max(n - 1, 1)
    return out


def calibrated_market_probabilities(predictions, power=0.65, max_probability=0.45):
    """Convert binary XGB scores into field probabilities for a betting board.

    XGBoost is trained as winner-vs-field, so live lineup inputs can create very
    confident raw scores. Those raw scores are useful for ranking, but normalized
    directly they can imply impossible dirt-race prices. A power transform keeps
    the order while flattening the board, then a cap redistributes excess.
    """
    if not predictions:
        return []

    weights = [max(float(row.get("rawProbability") or 0.0), 1e-6) ** power for row in predictions]
    total = sum(weights)
    probabilities = [weight / total if total > 0 else 1 / len(weights) for weight in weights]

    # Iteratively cap any runaway favorite and spread the excess over uncapped
    # drivers in proportion to their current probability.
    capped = [False] * len(probabilities)
    for _ in range(len(probabilities)):
        over_index = next((i for i, value in enumerate(probabilities) if not capped[i] and value > max_probability), None)
        if over_index is None:
            break

        excess = probabilities[over_index] - max_probability
        probabilities[over_index] = max_probability
        capped[over_index] = True

        open_indices = [i for i, is_capped in enumerate(capped) if not is_capped]
        open_total = sum(probabilities[i] for i in open_indices)
        if not open_indices or open_total <= 0:
            break
        for i in open_indices:
            probabilities[i] += excess * (probabilities[i] / open_total)

    total = sum(probabilities)
    return [value / total if total > 0 else 1 / len(probabilities) for value in probabilities]


def score_race(race_id, model_override=None):
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row

    race = con.execute(
        """SELECT r.*, t.name AS track_name, t.track_length
           FROM races r
           JOIN tracks t ON t.id = r.track_id
           WHERE r.id = ?""",
        (race_id,),
    ).fetchone()
    if not race:
        raise SystemExit(f"Race {race_id} not found")

    entries = con.execute(
        """SELECT re.driver_id, re.entry_series, re.starting_position, re.heat_position,
                  re.bmain_position, re.qualifying_time, d.name AS driver_name
           FROM race_entries re
           JOIN drivers d ON d.id = re.driver_id
           WHERE re.race_id = ?
             AND COALESCE(re.entry_status, 'expected') != 'scratched'
           ORDER BY d.name""",
        (race_id,),
    ).fetchall()
    entries = [dict(row) for row in entries]

    ranks = {
        "start": normalized_rank(entries, "starting_position"),
        "heat": normalized_rank(entries, "heat_position"),
        "bmain": normalized_rank(entries, "bmain_position"),
        "qt": normalized_rank(entries, "qualifying_time"),
    }

    params_cache = {}
    model_cache = {}
    predictions = []

    race_model_series, model_reason = resolve_race_model_series(race, model_override)
    series_slug = slug(race_model_series)
    model_path = ROOT / "data" / f"dirtiq_model_{series_slug}.pkl"
    params_path = ROOT / "data" / f"feature_params_{series_slug}.json"

    if not model_path.exists() or not params_path.exists():
        con.close()
        return {
            "raceId": race_id,
            "modelSeries": race_model_series,
            "modelSlug": series_slug,
            "modelReason": model_reason,
            "predictions": [],
        }

    params_cache[series_slug] = json.loads(params_path.read_text())
    with open(model_path, "rb") as handle:
        model_cache[series_slug] = pickle.load(handle)

    for entry in entries:
        model_path = ROOT / "data" / f"dirtiq_model_{series_slug}.pkl"
        params_path = ROOT / "data" / f"feature_params_{series_slug}.json"
        features = params_cache[series_slug]["features"]
        vector, metric_series = build_row(con, race, entry, ranks, features, race_model_series)
        frame = pd.DataFrame([vector], columns=features).astype(float)
        raw_probability = float(model_cache[series_slug].predict_proba(frame)[0, 1])
        predictions.append(
            {
                "driverId": int(entry["driver_id"]),
                "driverName": entry["driver_name"],
                "metricSeries": metric_series,
                "modelSlug": series_slug,
                "modelSeries": race_model_series,
                "modelReason": model_reason,
                "rawProbability": raw_probability,
                "trainedOn": params_cache[series_slug].get("trained_on"),
                "testAuc": params_cache[series_slug].get("test_auc"),
                "top1Accuracy": params_cache[series_slug].get("top1_acc"),
                "modelEngine": params_cache[series_slug].get("model_engine"),
                "modelAlgorithm": params_cache[series_slug].get("model_algorithm"),
                "featureCount": len(features),
            }
        )

    probabilities = calibrated_market_probabilities(predictions)
    for row, probability in zip(predictions, probabilities):
        row["probability"] = probability
        row["calibration"] = "power_0.65_cap_0.45"

    con.close()
    return {
        "raceId": race_id,
        "modelSeries": race_model_series,
        "modelSlug": series_slug,
        "modelReason": model_reason,
        "predictions": predictions,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: predict_model.py <race_id> [--cache] [--model crown|auto|lucas|woo|summer]")
    race_id = int(sys.argv[1])
    cache = "--cache" in sys.argv[2:]
    model_override = None
    if "--model" in sys.argv:
        value = sys.argv[sys.argv.index("--model") + 1]
        model_override = {
            "auto": None,
            "crown": "Crown Jewel / Combined",
            "lucas": "Lucas Oil LMDS",
            "woo": "WoO Late Models",
            "summer": "DIRTcar Summer Nationals",
        }[value]

    payload = score_race(race_id, model_override)
    if model_override:
        payload["modelOverride"] = model_override
    text = json.dumps(payload, separators=(",", ":"))
    if cache:
        out_dir = ROOT / "data" / "ml-predictions"
        out_dir.mkdir(parents=True, exist_ok=True)
        suffix = f"_{slug(model_override)}" if model_override else ""
        out_path = out_dir / f"race_{race_id}{suffix}.json"
        out_path.write_text(text)
    print(text)
