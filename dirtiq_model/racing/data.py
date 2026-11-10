"""Load the racing tables through ``scripts/model_runtime.py``.

``model_runtime.connect()`` masks the audited race exclusions by shadowing the
``races`` table with a temp view, so every query here goes through that
connection. Tests pass their own ``sqlite3`` connection to the loaders.
"""
from __future__ import annotations

import importlib.util
import sqlite3
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "scripts"

SERIES_SLUGS = {
    "Lucas Oil LMDS": "lucas_oil_lmds",
    "WoO Late Models": "woo_late_models",
    "DIRTcar Summer Nationals": "dirtcar_summer_nationals",
    "Crown Jewel / Combined": "crown_jewel_combined",
}
SERIES_KEYS = {"lucas": "Lucas Oil LMDS", "woo": "WoO Late Models", "summer": "DIRTcar Summer Nationals",
               "crown": "Crown Jewel / Combined"}

# Crown-jewel name patterns, identical to scripts/train_model.py (the training
# pool) so the Crown Jewel model learns from the same WoO/Lucas marquee races.
CROWN_PATTERNS = [
    "show-me", "show me", "prairie dirt", "usa nationals", "world finals", "knoxville",
    "north/south", "north south", "topless", "dream", "world 100", "firecracker", "pdc",
    "gopher 50", "hawkeye 100", "ralph latham", "dirt million", "gateway", "jackson 100",
    "hillbilly", "national 100", "silver dollar", "florence", "eldora",
]

# An 'upcoming' race dated more than this many days before today (America/New_York)
# never received results; it is not scored and its open ledger rows are voided.
STALE_UPCOMING_DAYS = 3
RACE_DAY_TZ = "America/New_York"

_modules: Dict[str, Any] = {}


def today_race_day(today: Optional[date] = None) -> date:
    """Today's date in the race-day time zone (America/New_York)."""
    return today if today is not None else datetime.now(ZoneInfo(RACE_DAY_TZ)).date()


def race_day(value: Any) -> Optional[date]:
    """``race_date`` text or Timestamp -> date (first 10 characters), None if unparseable."""
    if value is None:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def stale_upcoming_days(status: Any, race_date: Any, today: Optional[date] = None,
                        max_days: int = STALE_UPCOMING_DAYS) -> Optional[int]:
    """Days by which an 'upcoming' race is past the stale cutoff, or None if it is not stale."""
    if str(status) != "upcoming":
        return None
    day = race_day(race_date)
    if day is None:
        return None
    age = (today_race_day(today) - day).days
    return age if age > max_days else None


def _script_module(name: str) -> Any:
    """Import ``scripts/<name>.py`` by file path (they are not a package)."""
    if name in _modules:
        return _modules[name]
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    spec = importlib.util.spec_from_file_location(f"dirtiq_scripts_{name}", SCRIPTS_DIR / f"{name}.py")
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load scripts/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _modules[name] = module
    return module


def runtime() -> Any:
    return _script_module("model_runtime")


def legacy_predict() -> Any:
    """``scripts/predict_model.py`` (series routing, slug, crown-name helpers)."""
    runtime()  # predict_model does ``from model_runtime import ...``
    return _script_module("predict_model")


def model_dir() -> Path:
    return Path(runtime().MODEL_DIR)


def data_dir() -> Path:
    return Path(runtime().DATA_DIR)


def connect() -> sqlite3.Connection:
    con = runtime().connect()
    con.row_factory = sqlite3.Row
    return con


def slug(series: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "_", series.lower()).strip("_")


def resolve_series(race: Mapping[str, Any], override: Optional[str] = None) -> Tuple[str, str]:
    """Series routing identical to the legacy scorer (imported, not copied)."""
    row = {"name": race.get("name"), "series_mode": race.get("series_mode"), "division": race.get("division")}
    return legacy_predict().resolve_race_model_series(row, override)


def is_crown_name(name: Optional[str]) -> bool:
    key = (name or "").lower()
    return any(p in key for p in CROWN_PATTERNS)


@dataclass
class RacingData:
    races: pd.DataFrame      # one row per race (complete + upcoming), with track columns
    entries: pd.DataFrame    # one row per race entry
    similars: pd.DataFrame   # symmetric (track_id, similar_track_id, weight)

    def race(self, race_id: int) -> pd.Series:
        rows = self.races[self.races["race_id"] == int(race_id)]
        if rows.empty:
            raise KeyError(f"race {race_id} not found (or excluded by the data audit)")
        return rows.iloc[0]


RACE_SQL = """
SELECT r.id AS race_id, r.name, r.race_date, r.division, r.series_mode, r.status,
       r.track_id, r.distance, t.name AS track_name, t.track_length
FROM races r
LEFT JOIN tracks t ON t.id = r.track_id
WHERE r.status IN ('complete', 'upcoming')
ORDER BY r.race_date, r.id
"""

ENTRY_SQL = """
SELECT re.race_id, re.driver_id, d.name AS driver_name, re.finishing_position, re.starting_position,
       re.qualifying_time, re.heat_position, re.bmain_position, COALESCE(re.dnf, 0) AS dnf,
       COALESCE(re.entry_status, 'expected') AS entry_status, re.entry_series
FROM race_entries re
JOIN races r ON r.id = re.race_id
JOIN drivers d ON d.id = re.driver_id
WHERE r.status IN ('complete', 'upcoming')
ORDER BY re.race_id, re.finishing_position, re.driver_id
"""

SIMILAR_SQL = "SELECT track_id, similar_track_id, similarity_weight FROM track_similars"


def load_dataset(con: Optional[sqlite3.Connection] = None) -> RacingData:
    own = con is None
    if con is None:
        con = connect()
    try:
        races = pd.read_sql_query(RACE_SQL, con)
        entries = pd.read_sql_query(ENTRY_SQL, con)
        sim = pd.read_sql_query(SIMILAR_SQL, con)
    finally:
        if own:
            con.close()
    races["race_date"] = pd.to_datetime(races["race_date"].astype(str).str.slice(0, 10))
    races["year"] = races["race_date"].dt.year
    races["is_crown"] = [is_crown_name(f"{n or ''} {t or ''}") for n, t in zip(races["name"], races["track_name"])]
    races["is_eldora"] = races["track_name"].fillna("").str.lower().str.contains("eldora")
    for col in ("finishing_position", "starting_position", "heat_position", "bmain_position"):
        entries[col] = pd.to_numeric(entries[col], errors="coerce")
    entries["qualifying_time"] = pd.to_numeric(entries["qualifying_time"], errors="coerce")
    entries["dnf"] = entries["dnf"].fillna(0).astype(int)
    # symmetric similarity table (the legacy builder also walks both directions)
    sim = sim.rename(columns={"similarity_weight": "weight"})
    sim_rev = sim.rename(columns={"track_id": "similar_track_id", "similar_track_id": "track_id"})
    similars = pd.concat([sim, sim_rev], ignore_index=True)
    similars = similars[similars["track_id"] != similars["similar_track_id"]]
    similars = similars.groupby(["track_id", "similar_track_id"], as_index=False)["weight"].max()
    return RacingData(races=races, entries=entries, similars=similars)


def series_pool_mask(races: pd.DataFrame, series: str) -> pd.Series:
    """Races a series model trains on; Crown Jewel pools crown-named WoO/Lucas races."""
    if series == "Crown Jewel / Combined":
        named = races["name"].fillna("").str.lower()
        crown_named = pd.Series(False, index=races.index)
        for p in CROWN_PATTERNS:
            crown_named |= named.str.contains(p, regex=False)
        return (races["division"] == series) | (
            races["division"].isin(["WoO Late Models", "Lucas Oil LMDS"]) & crown_named)
    return races["division"] == series


def market_prices(con: sqlite3.Connection, race_id: int) -> Dict[int, Tuple[int, str]]:
    """``driver_id -> (american price, updated_at)`` from ``market_lines`` for a race."""
    out: Dict[int, Tuple[int, str]] = {}
    try:
        rows = con.execute("SELECT driver_id, market_odds, updated_at FROM market_lines WHERE race_id = ?",
                           (int(race_id),)).fetchall()
    except sqlite3.OperationalError:
        return out
    for driver_id, odds, updated in rows:
        try:
            price = int(str(odds).replace("+", "").strip())
        except (TypeError, ValueError):
            continue
        if abs(price) >= 100:
            out[int(driver_id)] = (price, updated)
    return out
