#!/usr/bin/env python3
"""
Import one MyRacePass event into Dirt IQ.

Creates the race if needed, creates missing drivers, imports merged lineup data,
and writes final feature results from the feature session.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sqlite3
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"
MRP_TS = ROOT / "src" / "lib" / "mrp-lineup.ts"


def fetch_html(event_id: int) -> str:
    url = f"https://www.myracepass.com/events/{event_id}/races"
    return subprocess.check_output(
        ["curl", "-sL", "-A", "Mozilla/5.0", url],
        text=True,
        timeout=20,
    )


def parse_with_node(event_id: int) -> dict:
    html_path = Path("/tmp") / f"mrp-import-{event_id}.html"
    html_path.write_text(fetch_html(event_id))
    test_path = Path("/tmp/mrp-lineup-import.ts")
    source = MRP_TS.read_text()
    test_path.write_text("\n".join(source.splitlines()[1:]))
    script_path = Path("/tmp") / f"mrp-import-{event_id}.mjs"
    script_path.write_text(f"""
import fs from 'fs';
const mod = await import('file://{test_path}?x=' + Date.now());
const html = fs.readFileSync('{html_path}', 'utf8');
const parsed = mod.parseMrpEventPage(html);
const entries = mod.mergeSessions(parsed.sessions);
console.log(JSON.stringify({{...parsed, entries}}));
""")
    raw = subprocess.check_output(
        ["bash", "-lc", f"source ~/.nvm/nvm.sh && node --experimental-strip-types {script_path}"],
        text=True,
        timeout=30,
        cwd=ROOT,
    )
    import json

    return json.loads(raw)


def normalize_name(name: str) -> str:
    return " ".join(name.lower().replace(".", "").split())


def get_or_create_driver(con: sqlite3.Connection, name: str, car_number: str | None) -> int:
    target = normalize_name(name)
    rows = con.execute(
        """SELECT id, name, car_number, notes
           FROM drivers
           ORDER BY
             CASE WHEN COALESCE(notes, '') LIKE 'Created from % import%' THEN 1 ELSE 0 END,
             id"""
    ).fetchall()
    for row in rows:
        if normalize_name(row[1]) == target:
            if car_number:
                con.execute("UPDATE drivers SET car_number = COALESCE(car_number, ?) WHERE id = ?", (car_number, row[0]))
            return int(row[0])

    row = con.execute("SELECT id FROM drivers WHERE lower(name) = lower(?) LIMIT 1", (name,)).fetchone()
    if row:
        if car_number:
            con.execute("UPDATE drivers SET car_number = COALESCE(car_number, ?) WHERE id = ?", (car_number, row[0]))
        return int(row[0])

    cur = con.execute(
        "INSERT INTO drivers (name, car_number, division, notes) VALUES (?, ?, 'Open Late Model', 'Created from MRP event import')",
        (name, car_number),
    )
    return int(cur.lastrowid)


def get_or_create_race(
    con: sqlite3.Connection,
    event_id: int,
    name: str,
    track_id: int,
    race_date: str,
    division: str,
    distance: int | None,
) -> int:
    row = con.execute("SELECT id FROM races WHERE mrp_event_id = ? LIMIT 1", (event_id,)).fetchone()
    if row:
        return int(row[0])

    row = con.execute(
        "SELECT id FROM races WHERE track_id = ? AND race_date = ? AND lower(name) = lower(?) LIMIT 1",
        (track_id, race_date, name),
    ).fetchone()
    if row:
        con.execute("UPDATE races SET mrp_event_id = ?, division = ?, series_mode = ? WHERE id = ?", (event_id, division, division, row[0]))
        return int(row[0])

    cur = con.execute(
        """INSERT INTO races
             (name, track_id, race_date, division, series_mode, distance, track_condition, mrp_event_id, status)
           VALUES (?, ?, ?, ?, ?, ?, 'Tacky', ?, 'upcoming')""",
        (name, track_id, race_date, division, division, distance, event_id),
    )
    return int(cur.lastrowid)


def feature_session(parsed: dict) -> dict | None:
    sessions = [s for s in parsed["sessions"] if s["type"] == "feature"]
    if not sessions:
        return None
    return sorted(sessions, key=lambda s: len(s["entries"]), reverse=True)[0]


def merge_sessions(sessions: list[dict]) -> list[dict]:
    entries: dict[str, dict] = {}

    def row_for(entry: dict) -> dict:
        key = normalize_name(entry["driver_name"])
        if key not in entries:
            entries[key] = {
                "driver_name": entry["driver_name"],
                "car_number": entry.get("car_number"),
                "qualifying_time": None,
                "heat_position": None,
                "starting_position": None,
            }
        if not entries[key].get("car_number") and entry.get("car_number"):
            entries[key]["car_number"] = entry.get("car_number")
        return entries[key]

    for session in sessions:
        for entry in session["entries"]:
            merged = row_for(entry)
            if session["type"] == "qualifying" and entry.get("time") is not None:
                current = merged.get("qualifying_time")
                if current is None or entry["time"] < current:
                    merged["qualifying_time"] = entry["time"]
            if session["type"] == "heat" and not entry.get("dnf"):
                current = merged.get("heat_position")
                if current is None or entry["position"] < current:
                    merged["heat_position"] = entry["position"]
            if session["type"] == "feature":
                if entry.get("starting_position") is not None:
                    merged["starting_position"] = entry["starting_position"]
                elif merged.get("starting_position") is None and entry.get("position") and not entry.get("dnf"):
                    merged["starting_position"] = entry["position"]

    return list(entries.values())


def filter_sessions(parsed: dict, class_filter: str | None) -> dict:
    if not class_filter:
        return parsed
    pattern = re.compile(class_filter, re.I)
    sessions = [session for session in parsed["sessions"] if pattern.search(session["name"])]
    return {**parsed, "sessions": sessions, "entries": merge_sessions(sessions)}


def import_event(args: argparse.Namespace) -> dict:
    parsed = filter_sessions(parse_with_node(args.event_id), args.class_filter)
    feature = feature_session(parsed)
    race_id: int
    con = sqlite3.connect(DB)
    try:
        race_id = get_or_create_race(
            con,
            args.event_id,
            args.name,
            args.track_id,
            args.date,
            args.division,
            args.distance,
        )

        entry_by_name = {normalize_name(e["driver_name"]): e for e in parsed["entries"]}
        if feature:
            for row in feature["entries"]:
                key = normalize_name(row["driver_name"])
                entry_by_name.setdefault(key, row)

        added = 0
        updated = 0
        result_rows = feature["entries"] if feature else []
        feature_by_name = {normalize_name(row["driver_name"]): row for row in result_rows}

        for entry in entry_by_name.values():
            driver_id = get_or_create_driver(con, entry["driver_name"], entry.get("car_number"))
            exists = con.execute(
                "SELECT id FROM race_entries WHERE race_id = ? AND driver_id = ?",
                (race_id, driver_id),
            ).fetchone()
            result = feature_by_name.get(normalize_name(entry["driver_name"]))
            con.execute(
                """INSERT OR IGNORE INTO race_entries
                     (race_id, driver_id, car_number, starting_position, qualifying_time,
                      heat_position, finishing_position, dnf, entry_status, entry_status_updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))""",
                (
                    race_id,
                    driver_id,
                    entry.get("car_number"),
                    entry.get("starting_position"),
                    entry.get("qualifying_time"),
                    entry.get("heat_position"),
                    result.get("position") if result else None,
                    1 if result and result.get("dnf") else 0,
                ),
            )
            con.execute(
                """UPDATE race_entries
                   SET car_number = COALESCE(car_number, ?),
                       starting_position = COALESCE(?, starting_position),
                       qualifying_time = COALESCE(?, qualifying_time),
                       heat_position = COALESCE(?, heat_position),
                       finishing_position = COALESCE(?, finishing_position),
                       dnf = ?,
                       entry_status = 'confirmed',
                       entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                   WHERE race_id = ? AND driver_id = ?""",
                (
                    entry.get("car_number"),
                    entry.get("starting_position"),
                    entry.get("qualifying_time"),
                    entry.get("heat_position"),
                    result.get("position") if result else None,
                    1 if result and result.get("dnf") else 0,
                    race_id,
                    driver_id,
                ),
            )
            added += 0 if exists else 1
            updated += 1 if exists else 0

        if result_rows:
            con.execute(
                """UPDATE races
                   SET status = 'complete',
                       results_source = ?,
                       results_imported_at = COALESCE(results_imported_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                   WHERE id = ?""",
                (f"MRP {args.event_id}", race_id),
            )

        con.commit()
        return {
            "raceId": race_id,
            "eventName": parsed["event_name"],
            "sessions": [{"name": s["name"], "type": s["type"], "count": len(s["entries"])} for s in parsed["sessions"]],
            "added": added,
            "updated": updated,
            "featureRows": len(result_rows),
        }
    finally:
        con.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a MyRacePass event into Dirt IQ.")
    parser.add_argument("--event-id", type=int, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--track-id", type=int, required=True)
    parser.add_argument("--division", default="Crown Jewel / Combined")
    parser.add_argument("--distance", type=int, default=None)
    parser.add_argument("--class-filter", default="Dirt Super Late Models|Super Late Models")
    args = parser.parse_args()
    print(import_event(args))


if __name__ == "__main__":
    main()
