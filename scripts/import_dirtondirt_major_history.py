#!/usr/bin/env python3
"""Import Dirt on Dirt major-event history pages into Dirt IQ.

These pages are useful for long-horizon crown history. They usually provide
feature finishing positions, car numbers, chassis, earnings, date, track, and
sanction. They do not generally provide feature starts, heats, or qualifying, so
this importer leaves those race-night columns untouched.
"""

from __future__ import annotations

import argparse
import html
import re
import sqlite3
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"
MONTHS = {
    "jan": "01",
    "feb": "02",
    "mar": "03",
    "apr": "04",
    "may": "05",
    "jun": "06",
    "jul": "07",
    "aug": "08",
    "sep": "09",
    "oct": "10",
    "nov": "11",
    "dec": "12",
}


@dataclass
class MajorEntry:
    position: int
    driver_name: str
    car_number: str | None
    chassis: str | None
    earnings: int | None


@dataclass
class MajorRace:
    year: int
    race_date: str
    event_name: str
    track_name: str
    sanction: str | None
    entries: list[MajorEntry]


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read().decode("utf-8", errors="replace")


def strip_tags(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value)).replace("\xa0", " ")


def normalize_space(value: str) -> str:
    return " ".join(value.split())


def normalize_name(name: str) -> str:
    cleaned = (
        name.lower()
        .replace(".", "")
        .replace("’", "'")
        .replace("`", "'")
    )
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned)
    return " ".join(cleaned.split())


def event_name(page_html: str, fallback: str) -> str:
    matches = re.findall(r"<h2>(.*?)</h2>", page_html, flags=re.IGNORECASE | re.DOTALL)
    if not matches:
        return fallback
    # Dirt on Dirt's template has a site slogan h2 before the actual history title.
    return normalize_space(strip_tags(matches[-1])) or fallback


def parse_date(year: int, value: str) -> str:
    match = re.search(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\b", value)
    if not match:
        return f"{year}-01-01"
    month_key = match.group(1).lower()[:3]
    month = MONTHS.get(month_key, "01")
    return f"{year}-{month}-{int(match.group(2)):02d}"


def parse_header(text: str, year: int) -> tuple[str, str, str | None]:
    # Example: May 24 - Lucas Oil Speedway, Wheatland, Mo. (Lucas Oil)
    race_date = parse_date(year, text)
    rest = text.split("-", 1)[1].strip() if "-" in text else text
    sanction = None
    sanction_match = re.search(r"\(([^)]+)\)\s*$", rest)
    if sanction_match:
        sanction = sanction_match.group(1).strip()
        rest = rest[: sanction_match.start()].strip()
    track_name = rest.split(",", 1)[0].strip()
    return race_date, track_name, sanction


def parse_entry(text: str) -> MajorEntry | None:
    line = normalize_space(text)
    match = re.match(r"^(\d+)\.\s+(.+)$", line)
    if not match:
        return None

    position = int(match.group(1))
    rest = match.group(2)
    first_chunk, *chunks = [part.strip() for part in rest.split(",")]
    driver = first_chunk
    car_number = None
    car_match = re.search(r"\(([^)]+)\)\s*$", driver)
    if car_match:
        car_number = car_match.group(1).strip()
        driver = driver[: car_match.start()].strip()

    earnings = None
    money_index = None
    for index, chunk in enumerate(chunks):
        money_match = re.search(r"\$([\d,]+)", chunk)
        if money_match:
            earnings = int(money_match.group(1).replace(",", ""))
            money_index = index
            break

    chassis = None
    if money_index is not None and money_index > 0:
        chassis = chunks[money_index - 1].strip() or None

    return MajorEntry(
        position=position,
        driver_name=driver,
        car_number=car_number,
        chassis=chassis,
        earnings=earnings,
    )


def parse_page(page_html: str, fallback_name: str) -> list[MajorRace]:
    name = event_name(page_html, fallback_name)
    year_blocks = re.split(
        r'<h3 class="borderTop">(\d{4})</h3 class="borderTop">',
        page_html,
        flags=re.IGNORECASE,
    )
    races: list[MajorRace] = []
    for index in range(1, len(year_blocks), 2):
        year = int(year_blocks[index])
        block = year_blocks[index + 1]
        paragraphs = [
            normalize_space(strip_tags(match))
            for match in re.findall(r"<p[^>]*>(.*?)</p>", block, flags=re.IGNORECASE | re.DOTALL)
        ]
        header = next((item for item in paragraphs if " - " in item), None)
        if not header:
            continue
        race_date, track_name, sanction = parse_header(header, year)
        entries = [entry for paragraph in paragraphs if (entry := parse_entry(paragraph))]
        if entries:
            races.append(
                MajorRace(
                    year=year,
                    race_date=race_date,
                    event_name=name,
                    track_name=track_name,
                    sanction=sanction,
                    entries=entries,
                )
            )
    return races


def get_or_create_track(con: sqlite3.Connection, track_name: str) -> int:
    row = con.execute("SELECT id FROM tracks WHERE lower(name) = lower(?) LIMIT 1", (track_name,)).fetchone()
    if row:
        return int(row[0])
    cur = con.execute(
        "INSERT INTO tracks (name, location, track_length, surface_type, notes) VALUES (?, '', NULL, 'Clay', 'Created from Dirt on Dirt major history import')",
        (track_name,),
    )
    return int(cur.lastrowid)


def get_or_create_driver(con: sqlite3.Connection, entry: MajorEntry) -> int:
    existing = find_driver(con, entry)
    if existing is not None:
        if entry.car_number:
            con.execute("UPDATE drivers SET car_number = COALESCE(car_number, ?) WHERE id = ?", (entry.car_number, existing))
        return existing
    cur = con.execute(
        "INSERT INTO drivers (name, car_number, division, notes) VALUES (?, ?, 'Open Late Model', 'Created from Dirt on Dirt major history import')",
        (entry.driver_name, entry.car_number),
    )
    return int(cur.lastrowid)


def find_driver(con: sqlite3.Connection, entry: MajorEntry) -> int | None:
    normalized = normalize_name(entry.driver_name)
    rows = con.execute(
        """SELECT id, name, car_number, notes
           FROM drivers
           ORDER BY
             CASE WHEN COALESCE(notes, '') LIKE 'Created from % import%' THEN 1 ELSE 0 END,
             id"""
    ).fetchall()
    for row in rows:
        if normalize_name(row[1]) == normalized:
            return int(row[0])
    return None


def division_for_sanction(sanction: str | None, fallback: str) -> str:
    key = (sanction or "").lower()
    if "lucas" in key:
        return "Lucas Oil LMDS"
    if "woo" in key or "world of outlaws" in key:
        return "WoO Late Models"
    return fallback


def find_or_create_race(con: sqlite3.Connection, race: MajorRace, track_id: int, division: str, source_url: str) -> tuple[int, bool]:
    event_key = race.event_name.lower().replace("-", " ")
    event_like = "%show%me%" if "show" in event_key and "me" in event_key else f"%{event_key}%"
    row = con.execute(
        """SELECT id
           FROM races
           WHERE track_id = ?
             AND substr(race_date, 1, 4) = ?
             AND (
               lower(name) LIKE ?
               OR race_date = ?
             )
           ORDER BY
             CASE WHEN race_date = ? THEN 0 ELSE 1 END,
             CASE WHEN lower(name) LIKE '%prelim%' OR lower(name) LIKE '%night%' THEN 1 ELSE 0 END,
             id
           LIMIT 1""",
        (track_id, str(race.year), event_like, race.race_date, race.race_date),
    ).fetchone()
    if row:
        con.execute(
            """UPDATE races
               SET name = CASE
                            WHEN lower(name) LIKE 'lucas oil speedway %' THEN ?
                            ELSE name
                          END,
                   results_source = COALESCE(results_source, ?),
                   results_imported_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ?""",
            (f"{race.year} {race.event_name}", f"Dirt on Dirt major history: {source_url}", row[0]),
        )
        return int(row[0]), False

    cur = con.execute(
        """INSERT INTO races
             (name, track_id, race_date, division, series_mode, track_condition, status,
              results_source, results_imported_at)
           VALUES (?, ?, ?, ?, NULL, 'Tacky', 'complete', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))""",
        (
            f"{race.year} {race.event_name}",
            track_id,
            race.race_date,
            division,
            f"Dirt on Dirt major history: {source_url}",
        ),
    )
    return int(cur.lastrowid), True


def import_major_history(args: argparse.Namespace) -> dict:
    page_html = fetch(args.url)
    races = [
        race
        for race in parse_page(page_html, args.event_name)
        if race.year >= args.min_year and (args.max_year is None or race.year <= args.max_year)
    ]
    con = sqlite3.connect(DB)
    try:
        race_count = 0
        entry_count = 0
        for race in races:
            track_id = get_or_create_track(con, race.track_name)
            division = division_for_sanction(race.sanction, args.division)
            race_id, created_race = find_or_create_race(con, race, track_id, division, args.url)
            race_count += 1

            for entry in race.entries:
                duplicate_finish = con.execute(
                    "SELECT 1 FROM race_entries WHERE race_id = ? AND finishing_position = ? LIMIT 1",
                    (race_id, entry.position),
                ).fetchone()
                driver_id = find_driver(con, entry)
                has_entry = (
                    con.execute(
                        "SELECT 1 FROM race_entries WHERE race_id = ? AND driver_id = ? LIMIT 1",
                        (race_id, driver_id),
                    ).fetchone()
                    if driver_id is not None
                    else None
                )
                if driver_id is None:
                    if not created_race and duplicate_finish:
                        continue
                    driver_id = get_or_create_driver(con, entry)
                elif not created_race and not has_entry and duplicate_finish:
                    continue

                con.execute(
                    """INSERT OR IGNORE INTO race_entries
                         (race_id, driver_id, car_number, finishing_position, dnf, money, entry_status, entry_status_updated_at)
                       VALUES (?, ?, ?, ?, 0, ?, 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))""",
                    (race_id, driver_id, entry.car_number, entry.position, entry.earnings),
                )
                con.execute(
                    """UPDATE race_entries
                       SET car_number = COALESCE(NULLIF(car_number, ''), ?),
                           finishing_position = COALESCE(finishing_position, ?),
                           money = COALESCE(money, ?),
                           entry_status = 'confirmed',
                           entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                       WHERE race_id = ? AND driver_id = ?""",
                    (entry.car_number, entry.position, entry.earnings, race_id, driver_id),
                )
                entry_count += 1

        if args.dry_run:
            con.rollback()
        else:
            con.commit()
        return {
            "source": args.url,
            "races": race_count,
            "entries": entry_count,
            "minYear": args.min_year,
            "maxYear": args.max_year,
            "dryRun": args.dry_run,
        }
    finally:
        con.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a Dirt on Dirt major-event history page.")
    parser.add_argument("--url", required=True)
    parser.add_argument("--event-name", default="Major Event")
    parser.add_argument("--min-year", type=int, default=2021)
    parser.add_argument("--max-year", type=int)
    parser.add_argument("--division", default="Crown Jewel / Combined")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(import_major_history(args))


if __name__ == "__main__":
    main()
