"""NCAAF games: sportsdataverse ESPN ``cfb_schedules`` releases joined to the cfbfastR
``cfb_line_odds`` betting archive (many books per game, consolidated to a median).

* Schedule files (one per season, FBS-centric, completed games only; the archive
  carries no scheduled/future rows). Upcoming games for the next ``espn_odds``
  horizon come from the ESPN scoreboard (FBS group), keyed by the same ESPN event id.
* Betting rows are keyed by the same ESPN ``game_id``. Each row is one side of one
  market at one book. The home side is identified by resolving each betting
  abbreviation to the ESPN team id it co-occurs with most often. Per game we take
  the median home spread, the median price on each side, the median moneylines and
  the median total across books. The archive ends with the 2025 season; from 2026
  the games it does not price (and all upcoming games) take ESPN per-game odds.
* Teams: ESPN abbreviation. Opponents that play fewer than ``MIN_GAMES_FOR_OWN_RATING``
  games in a season (FCS visitors) are pooled into one ``FCS`` rating.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from . import espn_odds
from .common import cache_dir_for, download, finalize

SCHEDULE_URL = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_schedules/cfb_schedule_{season}.parquet"
LINES_URL = "https://github.com/sportsdataverse/cfbfastR-data/raw/main/betting/parquet/cfb_line_odds.parquet"
FIRST_SEASON = 2010
LABEL = "NCAAF"
BOOK = "cfbfastR multi-book median"
SEASON_TYPES = {2: "regular", 3: "postseason"}
MIN_GAMES_FOR_OWN_RATING = 6
POOLED_TEAM = "FCS"


def current_season(today: Optional[pd.Timestamp] = None) -> int:
    today = today or pd.Timestamp.now(tz="UTC")
    return int(today.year if today.month >= 8 else today.year - 1)


def consolidate_lines(lines: pd.DataFrame) -> pd.DataFrame:
    """Per ESPN game id: median home spread, side prices, moneylines and total across books."""
    d = lines[lines["game_id"].notna() & lines["home_team_id"].notna() & lines["away_team_id"].notna()].copy()
    d["game_id"] = d["game_id"].astype(int).astype(str)
    d["home_team_id"] = d["home_team_id"].astype(int)
    d["away_team_id"] = d["away_team_id"].astype(int)
    # abbreviation -> team id by majority co-occurrence
    votes: Dict[str, Counter] = defaultdict(Counter)
    pairs = d[["game_id", "abbr", "home_team_id", "away_team_id"]].drop_duplicates(["game_id", "abbr"])
    for abbr, h, a in zip(pairs["abbr"], pairs["home_team_id"], pairs["away_team_id"]):
        votes[abbr][h] += 1
        votes[abbr][a] += 1
    abbr_to_id = {abbr: c.most_common(1)[0][0] for abbr, c in votes.items()}
    # strength of the majority: games behind it plus its share, so a 12-game team beats a one-game visitor
    share = {abbr: c.most_common(1)[0][1] + c.most_common(1)[0][1] / sum(c.values()) for abbr, c in votes.items()}
    sides = resolve_sides(d, abbr_to_id, share)
    d = d.merge(sides, on=["game_id", "abbr"], how="left")
    d["is_home"] = d["side"] == "home"
    d["is_away"] = d["side"] == "away"
    out = pd.DataFrame(index=d["game_id"].unique())
    sp = d[(d["market_type"] == "spread") & d["lines"].notna()]
    home_sp = sp[sp["is_home"]].groupby("game_id")
    away_sp = sp[sp["is_away"]].groupby("game_id")
    out["spread_line"] = home_sp["lines"].median()
    away_line = -away_sp["lines"].median()
    out["spread_line"] = out["spread_line"].fillna(away_line)
    out["spread_home_price"] = home_sp["odds"].median()
    out["spread_away_price"] = away_sp["odds"].median()
    ml = d[(d["market_type"] == "money_line") & d["odds"].notna()]
    out["home_ml"] = ml[ml["is_home"]].groupby("game_id")["odds"].median()
    out["away_ml"] = ml[ml["is_away"]].groupby("game_id")["odds"].median()
    tot = d[(d["market_type"] == "total") & d["lines"].notna()]
    out["total_line"] = tot.groupby("game_id")["lines"].median()
    out["books"] = sp.groupby("game_id")["book"].nunique()
    # a median of American prices can land inside (-100, 100); nudge to the nearest legal price
    for col in ("spread_home_price", "spread_away_price", "home_ml", "away_ml"):
        v = out[col]
        out[col] = np.where(v.abs() < 100, np.where(v < 0, -100.0, 100.0), v.round())
        out.loc[v.isna(), col] = np.nan
    out.index.name = "game_id"
    return out.reset_index()


def resolve_sides(d: pd.DataFrame, abbr_to_id: Dict[str, int], share: Dict[str, float]) -> pd.DataFrame:
    """Per (game, abbr) side label. The majority map decides; when both abbreviations of
    a game resolve to the same id (a one-game FCS visitor whose votes tie), the one with
    the stronger majority keeps that side and the other takes the opposite side."""
    pairs = d[["game_id", "abbr", "home_team_id", "away_team_id"]].drop_duplicates(["game_id", "abbr"]).copy()
    pairs["abbr_id"] = pairs["abbr"].map(abbr_to_id)
    pairs["share"] = pairs["abbr"].map(share).fillna(0.0)
    pairs["side"] = np.where(pairs["abbr_id"] == pairs["home_team_id"], "home",
                             np.where(pairs["abbr_id"] == pairs["away_team_id"], "away", "none"))
    counts = pairs.groupby("game_id")["side"].transform(lambda s: s.nunique())
    sizes = pairs.groupby("game_id")["side"].transform("size")
    conflict = pairs[(sizes == 2) & (counts == 1)]
    fixes = {}
    for gid, sub in conflict.groupby("game_id"):
        sub = sub.sort_values("share", ascending=False)
        strong, weak = sub.iloc[0], sub.iloc[1]
        keep = strong["side"] if strong["side"] != "none" else "home"
        fixes[(gid, strong["abbr"])] = keep
        fixes[(gid, weak["abbr"])] = "away" if keep == "home" else "home"
    if fixes:
        key = list(zip(pairs["game_id"], pairs["abbr"]))
        pairs["side"] = [fixes.get(k, side) for k, side in zip(key, pairs["side"])]
    return pairs[["game_id", "abbr", "side"]]


def pool_minor_teams(frame: pd.DataFrame) -> pd.DataFrame:
    """Rename teams with fewer than MIN_GAMES_FOR_OWN_RATING games in a season to the pooled FCS id."""
    f = frame.copy()
    long = pd.concat([f[["season", "home"]].rename(columns={"home": "team"}), f[["season", "away"]].rename(columns={"away": "team"})])
    counts = long.groupby(["season", "team"]).size()
    minor = set(counts[counts < MIN_GAMES_FOR_OWN_RATING].index)
    for col in ("home", "away"):
        key = list(zip(f["season"], f[col]))
        f[col] = [POOLED_TEAM if k in minor else t for k, t in zip(key, f[col])]
    return f[f["home"] != f["away"]]


def convert_schedule(raw: pd.DataFrame) -> pd.DataFrame:
    d = raw[raw["season_type"].isin(list(SEASON_TYPES))].copy()
    status = d["status"].astype(str)
    d = d[~status.str.contains("POSTPONED|CANCELED", regex=True)]
    start = pd.to_datetime(d["game_date"], utc=True, errors="coerce")
    completed = d["status"].astype(str).eq("STATUS_FINAL")
    home_score = pd.to_numeric(d["home_score"], errors="coerce").where(completed)
    away_score = pd.to_numeric(d["away_score"], errors="coerce").where(completed)
    completed = completed & home_score.notna() & away_score.notna() & ((home_score + away_score) > 0)
    out = pd.DataFrame({
        "game_id": d["game_id"].astype(int).astype(str),
        "season": d["season"].astype(int),
        "week": pd.to_numeric(d["week"], errors="coerce"),
        "start": start,
        "home": d["home_abbreviation"].astype(str),
        "away": d["away_abbreviation"].astype(str),
        "neutral": d["neutral_site"].astype(bool).astype(int),
        "home_score": home_score,
        "away_score": away_score,
        "completed": completed,
        "game_type": d["season_type"].map(SEASON_TYPES),
    })
    return out[out["start"].notna()]


def load_games(cache_dir: Optional[Path] = None, refresh: bool = False, last_season: Optional[int] = None,
               lines: bool = True) -> pd.DataFrame:
    cache = cache_dir_for("ncaaf", cache_dir)
    last = last_season or current_season()
    frames: List[pd.DataFrame] = []
    sources = []
    for season in range(FIRST_SEASON, last + 1):
        dest = cache / f"cfb_schedule_{season}.parquet"
        try:
            meta = download(SCHEDULE_URL.format(season=season), dest, refresh=refresh)
        except Exception as exc:
            if season >= last:
                print(f"ncaaf: no schedule file for season {season} ({exc})")
                continue
            raise
        sources.append(meta)
        frames.append(convert_schedule(pd.read_parquet(dest)))
    lines_path = cache / "cfb_line_odds.parquet"
    sources.append(download(LINES_URL, lines_path, refresh=refresh))
    archive = consolidate_lines(pd.read_parquet(lines_path))
    frame = pd.concat(frames, ignore_index=True).drop_duplicates("game_id", keep="last")
    frame = frame.merge(archive, on="game_id", how="left")
    book = BOOK
    if lines:
        # the schedule archive has no future rows: upcoming games come from the ESPN scoreboard,
        # and ESPN odds fill the games the cfbfastR archive does not price (2026 onward)
        upcoming = espn_odds.upcoming_frame("ncaaf", cache, refresh=refresh)
        upcoming = upcoming[~upcoming["game_id"].isin(set(frame["game_id"]))]
        if not upcoming.empty:
            frame = pd.concat([frame, upcoming], ignore_index=True)
        frame, odds_meta = espn_odds.attach(frame, "ncaaf", cache, refresh=refresh, overwrite=False)
        if odds_meta.get("priced"):
            sources.append(odds_meta)
            book = f"{BOOK}; {espn_odds.BOOK} from 2026"
    frame = pool_minor_teams(frame)
    return finalize(frame, sources, book, LABEL)

