"""NCAAB (men's Division I basketball) games from sportsdataverse ESPN schedule parquets.

Source: the ``espn_mens_college_basketball_schedules`` release of
``sportsdataverse/sportsdataverse-data`` (one ``mbb_schedule_{season}.parquet`` per
ESPN *ending* season, 2016 to the season in progress). The files are the ESPN
scoreboard schema used by the NBA adapter (``id, season, season_type, date,
home_abbreviation, away_abbreviation, home_score, away_score, status_type_name,
status_type_completed, neutral_site, home_conference_id, away_conference_id`` ...).
They carry no betting lines (the only ``*_linescores`` columns are period scores),
so the market columns are null and the report is an independent model only.

Included: regular season (season_type 2) and postseason (3: conference tournaments,
NCAA/NIT/CBI). Excluded: postponed and canceled rows.

Teams: ESPN abbreviation. Opponents outside Division I (ESPN gives them no
conference id) and any team with fewer than ``MIN_GAMES_FOR_OWN_RATING`` games in a
season are pooled into one ``NON_D1`` rating, the way the NCAAF adapter pools FCS.
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional

import pandas as pd

from .common import cache_dir_for, download, finalize

RELEASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_mens_college_basketball_schedules/mbb_schedule_{season}.parquet"
FIRST_SEASON = 2016
LABEL = "NCAAB"
BOOK = None
SEASON_TYPES = {2: "regular", 3: "postseason"}
MIN_GAMES_FOR_OWN_RATING = 6
POOLED_TEAM = "NON_D1"
NO_LINES = "ESPN schedule files carry no betting lines"


def current_ending_season(today: Optional[pd.Timestamp] = None) -> int:
    """ESPN ending-season for the season in progress on ``today`` (tip-off is early November)."""
    today = today or pd.Timestamp.now(tz="UTC")
    return int(today.year + 1 if today.month >= 10 else today.year)


def convert_frame(raw: pd.DataFrame) -> pd.DataFrame:
    """Map an ESPN schedule frame into the contract columns (pure, no I/O).

    ``home_d1``/``away_d1`` flag whether ESPN lists a conference for the team; the
    pooling step uses them, so they are kept as extra columns.
    """
    d = raw[raw["season_type"].isin(list(SEASON_TYPES))].copy()
    status = d["status_type_name"].astype(str)
    d = d[~status.str.contains("POSTPONED|CANCELED", regex=True)]
    status = d["status_type_name"].astype(str)
    start = pd.to_datetime(d["date"], utc=True, errors="coerce")
    completed = (status == "STATUS_FINAL") & d["status_type_completed"].astype(bool)
    home_score = pd.to_numeric(d["home_score"], errors="coerce").where(completed)
    away_score = pd.to_numeric(d["away_score"], errors="coerce").where(completed)
    completed = completed & home_score.notna() & away_score.notna() & ((home_score + away_score) > 0)
    season = d["season"].astype(int)
    season_start = start.groupby(season).transform("min")
    week = ((start - season_start).dt.days // 7 + 1).astype("Int64")
    out = pd.DataFrame({
        "game_id": d["id"].astype(str),
        "season": season,
        "week": week,
        "start": start,
        "home": d["home_abbreviation"].astype(str),
        "away": d["away_abbreviation"].astype(str),
        "neutral": d["neutral_site"].astype(bool).astype(int),
        "home_score": home_score,
        "away_score": away_score,
        "spread_line": float("nan"),
        "spread_home_price": float("nan"),
        "spread_away_price": float("nan"),
        "home_ml": float("nan"),
        "away_ml": float("nan"),
        "total_line": float("nan"),
        "completed": completed,
        "game_type": d["season_type"].map(SEASON_TYPES),
        "status": status,
        "home_d1": pd.to_numeric(d["home_conference_id"], errors="coerce").notna(),
        "away_d1": pd.to_numeric(d["away_conference_id"], errors="coerce").notna(),
    })
    return out[out["start"].notna()]


def pool_non_d1(frame: pd.DataFrame) -> pd.DataFrame:
    """Rename non-Division-I opponents (no ESPN conference) and teams with fewer than
    ``MIN_GAMES_FOR_OWN_RATING`` games in a season to the pooled ``NON_D1`` id, then drop
    games between two pooled teams."""
    f = frame.copy()
    home_d1 = f["home_d1"].astype(bool) if "home_d1" in f.columns else pd.Series(True, index=f.index)
    away_d1 = f["away_d1"].astype(bool) if "away_d1" in f.columns else pd.Series(True, index=f.index)
    long = pd.concat([f[["season", "home"]].rename(columns={"home": "team"}), f[["season", "away"]].rename(columns={"away": "team"})])
    counts = long.groupby(["season", "team"]).size()
    minor = set(counts[counts < MIN_GAMES_FOR_OWN_RATING].index)
    for col, flag in (("home", home_d1), ("away", away_d1)):
        key = list(zip(f["season"], f[col]))
        f[col] = [POOLED_TEAM if (not d1 or k in minor) else t for k, t, d1 in zip(key, f[col], flag)]
    f = f[f["home"] != f["away"]]
    return f.drop(columns=[c for c in ("home_d1", "away_d1") if c in f.columns])


def load_games(cache_dir: Optional[Path] = None, refresh: bool = False, last_season: Optional[int] = None) -> pd.DataFrame:
    cache = cache_dir_for("ncaab", cache_dir)
    last = last_season or current_ending_season()
    frames: List[pd.DataFrame] = []
    sources = []
    for season in range(FIRST_SEASON, last + 1):
        dest = cache / f"mbb_schedule_{season}.parquet"
        try:
            meta = download(RELEASE.format(season=season), dest, refresh=refresh)
        except Exception as exc:  # the file for a season that has not tipped off yet
            if season >= last:
                print(f"ncaab: no schedule file for season {season} ({exc})")
                continue
            raise
        sources.append(meta)
        frames.append(convert_frame(pd.read_parquet(dest)))
    frame = pd.concat(frames, ignore_index=True).drop_duplicates("game_id", keep="last")
    frame = pool_non_d1(frame)
    return finalize(frame, sources, BOOK, LABEL)
