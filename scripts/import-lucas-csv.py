"""
Import Lucas Oil Late Model Dirt Series historical CSV results into dirtiq.db.

Usage:
  python3 scripts/import-lucas-csv.py
  python3 scripts/import-lucas-csv.py /path/to/LOLMDS_Results_2020-2026_v2.csv
"""

import csv
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "data" / "dirtiq.db"
CSV_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "LOLMDS_Results_2020-2026_v2.csv"
SERIES = "Lucas Oil LMDS"

MONTHS = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AUG": 8,
    "SEP": 9,
    "OCT": 10,
    "NOV": 11,
    "DEC": 12,
}


def norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z\s]", "", name.lower())).strip()


def parse_date(value):
    if not value:
        return None
    value = value.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return value
    year = month = day = None
    for part in value.split():
        upper = part.upper()
        if re.match(r"^\d{4}$", part):
            year = int(part)
        elif upper[:3] in MONTHS:
            month = MONTHS[upper[:3]]
        elif re.match(r"^\d{1,2}$", part):
            day = int(part)
    if not year or not month or not day:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def number(value):
    if not value:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", value)
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def is_feature(session: str) -> bool:
    s = session.lower()
    if "b-main" in s or "b main" in s or "hot laps" in s or "practice" in s:
        return False
    return bool(re.search(r"\ba[-\s]?main\b", s) or "a feature" in s)


def session_tag(session: str) -> str:
    cleaned = session.strip()
    if cleaned.lower() in {"lolmds a-main", "a-main", "a main", "a feature 1"}:
        return ""
    return f" ({cleaned})"


rows = list(csv.DictReader(CSV_PATH.open(newline="", encoding="utf-8")))
feature_rows = [row for row in rows if is_feature(row.get("session", ""))]
heat_rows = [row for row in rows if "heat" in row.get("session", "").lower()]
qual_rows = [
    row
    for row in rows
    if "qual" in row.get("session", "").lower() or "time trial" in row.get("session", "").lower()
]

print(f"Rows: {len(rows)} total | {len(feature_rows)} feature | {len(heat_rows)} heat | {len(qual_rows)} qualifying")

heat_map = {}
for row in heat_rows:
    driver = row.get("Driver", "").strip()
    event_id = row.get("event_id", "").strip()
    pos = number(row.get("Pos.") or row.get("POS"))
    if not driver or not event_id or not pos:
        continue
    key = (event_id, norm_name(driver))
    if key not in heat_map or pos < heat_map[key]:
        heat_map[key] = pos

qual_by_event = defaultdict(dict)
for row in qual_rows:
    driver = row.get("Driver", "").strip()
    event_id = row.get("event_id", "").strip()
    time = number(row.get("Time"))
    if not driver or not event_id or not time:
        continue
    driver_key = norm_name(driver)
    current = qual_by_event[event_id].get(driver_key)
    if current is None or time < current:
        qual_by_event[event_id][driver_key] = time

qual_time_map = {}
for event_id, driver_times in qual_by_event.items():
    for driver_key, time in driver_times.items():
        qual_time_map[(event_id, driver_key)] = time

feature_groups = defaultdict(list)
for row in feature_rows:
    event_id = row.get("event_id", "").strip()
    session = row.get("session", "").strip()
    if event_id and session:
        feature_groups[(event_id, session)].append(row)

con = sqlite3.connect(DB_PATH)
con.execute("PRAGMA foreign_keys=ON")

track_cache = {name.lower(): track_id for track_id, name in con.execute("SELECT id, name FROM tracks")}
driver_cache = {norm_name(name): driver_id for driver_id, name in con.execute("SELECT id, name FROM drivers")}
existing = {
    (str(event_id), name)
    for event_id, name in con.execute("SELECT mrp_event_id, name FROM races WHERE mrp_event_id IS NOT NULL")
}


def track_id(name, location):
    key = name.lower()
    if key in track_cache:
        return track_cache[key]
    cur = con.execute(
        "INSERT INTO tracks (name, location, surface_type) VALUES (?, ?, 'Clay')",
        (name, location or None),
    )
    tid = cur.lastrowid
    track_cache[key] = tid
    return tid


def driver_id(name, car_number):
    key = norm_name(name)
    if key in driver_cache:
        return driver_cache[key]
    last_name = key.split(" ")[-1] if key else ""
    first_letter = key[:1]
    for cached_name, did in list(driver_cache.items()):
        if cached_name.split(" ")[-1] == last_name and cached_name[:1] == first_letter:
            driver_cache[key] = did
            return did
    cur = con.execute(
        "INSERT INTO drivers (name, car_number, division) VALUES (?, ?, ?)",
        (name, car_number or None, SERIES),
    )
    did = cur.lastrowid
    driver_cache[key] = did
    return did


races_imported = races_skipped = entries_imported = 0

with con:
    for (event_id, session), group in feature_groups.items():
        sample = group[0]
        race_date = parse_date(sample.get("date"))
        track = sample.get("track", "").strip()
        if not race_date or not track:
            continue

        race_name = (sample.get("race_name") or "Lucas Oil Feature").strip()
        full_name = f"{race_name}{session_tag(session)}"
        if (event_id, full_name) in existing:
            races_skipped += 1
            continue

        max_laps = max((number(row.get("Laps")) or 0 for row in group if row.get("Status", "").lower() == "running"), default=0)
        tid = track_id(track, sample.get("location", "").strip())
        race_cur = con.execute(
            """
            INSERT INTO races (name, track_id, race_date, division, distance, status, mrp_event_id)
            VALUES (?, ?, ?, ?, ?, 'complete', ?)
            """,
            (full_name, tid, race_date, SERIES, int(max_laps) if max_laps else None, int(event_id)),
        )
        race_id = race_cur.lastrowid
        races_imported += 1

        for row in group:
            driver = row.get("Driver", "").strip()
            if not driver:
                continue
            finish = number(row.get("POS"))
            if not finish:
                continue
            car_number = (row.get("#") or row.get("Car") or "").strip()
            did = driver_id(driver, car_number)
            driver_key = norm_name(driver)
            start = number(row.get("Start"))
            laps_led = number(row.get("Led")) or 0
            status = row.get("Status", "").strip().lower()
            dnf = 0 if status == "running" else 1
            con.execute(
                """
                INSERT OR IGNORE INTO race_entries
                  (race_id, driver_id, car_number, starting_position, qualifying_time,
                   heat_position, finishing_position, laps_led, dnf, money)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    race_id,
                    did,
                    car_number or None,
                    int(start) if start and start > 0 else None,
                    qual_time_map.get((event_id, driver_key)),
                    int(heat_map[(event_id, driver_key)]) if (event_id, driver_key) in heat_map else None,
                    int(finish),
                    int(laps_led),
                    dnf,
                    number(row.get("Money")),
                ),
            )
            entries_imported += 1

print("\n=== Lucas import complete ===")
print(f"Races imported:   {races_imported}")
print(f"Races skipped:    {races_skipped}")
print(f"Entries imported: {entries_imported}")
