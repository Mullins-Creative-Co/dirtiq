#!/usr/bin/env python3
"""
Import DIRTcar Summer Nationals late model results into Dirt IQ.

Reads the public season result pages, follows completed event result links, and
updates races/race_entries with feature finish, start, qualifying, heat finish,
laps led, DNF, and purse money where available.
"""

from __future__ import annotations

import argparse
import html
import re
import sqlite3
import subprocess
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"
BASE = "https://dirtcarsummernationals.com"


@dataclass
class EventRef:
    season: int
    event_id: int
    date: str
    title: str
    track: str
    location: str
    url: str


class ResultTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_row = False
        self.in_cell = False
        self.current_label = ""
        self.current_text: list[str] = []
        self.current_cells: list[tuple[str, str]] = []
        self.rows: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if tag == "tr":
            self.in_row = True
            self.current_cells = []
        elif self.in_row and tag in {"td", "th"}:
            self.in_cell = True
            self.current_label = attr.get("data-label") or ""
            self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.in_cell and tag in {"td", "th"}:
            text = normalize_space(" ".join(self.current_text))
            self.current_cells.append((self.current_label, text))
            self.in_cell = False
        elif self.in_row and tag == "tr":
            row = {label or f"col_{idx}": value for idx, (label, value) in enumerate(self.current_cells)}
            if row and any(row.values()) and row.get("Pos") != "Pos":
                self.rows.append(row)
            self.in_row = False


def fetch(url: str) -> str:
    return subprocess.check_output(
        ["curl", "-sL", "-A", "Mozilla/5.0", url],
        text=True,
        timeout=40,
    )


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def strip_tags(value: str) -> str:
    return normalize_space(re.sub(r"<[^>]+>", " ", value or ""))


def parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.search(r"-?\d+", value.replace(",", ""))
    return int(match.group(0)) if match else None


def parse_money(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"\$?([\d,]+)", value)
    return int(match.group(1).replace(",", "")) if match else None


def parse_time(value: str | None) -> float | None:
    if not value or value.upper() in {"NT", "DNS"}:
        return None
    match = re.search(r"\d+(?:\.\d+)?", value)
    return float(match.group(0)) if match else None


def normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def slug_to_track_name(slug: str) -> str:
    return " ".join(part.capitalize() for part in slug.split("-"))


def section_blocks(late_model_html: str) -> list[tuple[str, str]]:
    blocks: list[tuple[str, str]] = []
    pattern = re.compile(
        r'<div id="results-[^"]+" class="results-section[^"]*">(?P<body>.*?</table>)',
        re.S,
    )
    for match in pattern.finditer(late_model_html):
        body = match.group("body")
        title_match = re.search(r'<h3 class="results-section-title".*?</span>\s*(.*?)</h3>', body, re.S)
        title = strip_tags(title_match.group(1)) if title_match else "Unknown"
        table_match = re.search(r"(<table\b.*?</table>)", body, re.S)
        if table_match:
            blocks.append((title, table_match.group(1)))
    return blocks


def late_model_segment(page: str) -> str:
    markers = [
        "DIRTcar Summer Nationals Results",
        "DIRTcar Summer Nationals Late Models Results",
    ]
    starts = [page.find(marker) for marker in markers if page.find(marker) != -1]
    if not starts:
        return ""
    start = min(starts)
    next_divider = page.find("results-series-divider", start + 1)
    if next_divider == -1:
        return page[start:]
    return page[start:next_divider]


def parse_table(table_html: str) -> list[dict[str, str]]:
    parser = ResultTableParser()
    parser.feed(table_html)
    return parser.rows


def parse_season_events(season: int) -> list[EventRef]:
    page = fetch(f"{BASE}/results/?season={season}")
    events: list[EventRef] = []
    card_pattern = re.compile(
        r'<div class="event-container[^"]*"\s+(?P<attrs>[^>]+)>(?P<body>.*?)(?=<div class="event-container|\Z)',
        re.S,
    )
    for card in card_pattern.finditer(page):
        attrs = card.group("attrs")
        body = card.group("body")
        if "series=helltour" not in body:
            continue
        if "Results" not in body:
            continue
        event_match = re.search(r'results/\?event=(\d+)&(?:amp;)?series=helltour', body)
        if not event_match:
            continue
        date_match = re.search(r'data-start-date="([^"]+)"', attrs)
        title_match = re.search(r'<p class="event-title[^"]*">(.*?)</p>', body, re.S)
        location_match = re.search(r'<p class="event-location">(.*?)</p>', body, re.S)
        location = strip_tags(location_match.group(1)) if location_match else ""
        if "|" in location:
            track, track_location = [part.strip() for part in location.split("|", 1)]
        else:
            track = slug_to_track_name(re.search(r'data-track="([^"]+)"', attrs).group(1)) if "data-track" in attrs else ""
            track_location = location
        event_id = int(event_match.group(1))
        events.append(
            EventRef(
                season=season,
                event_id=event_id,
                date=date_match.group(1) if date_match else f"{season}-01-01",
                title=strip_tags(title_match.group(1)) if title_match else f"DIRTcar Summer Nationals {event_id}",
                track=track,
                location=track_location,
                url=f"{BASE}/results/?event={event_id}&series=helltour",
            )
        )
    seen: set[int] = set()
    unique = []
    for event in events:
        if event.event_id in seen:
            continue
        seen.add(event.event_id)
        unique.append(event)
    return unique


def parse_event(event: EventRef) -> dict:
    page = fetch(event.url)
    segment = late_model_segment(page)
    blocks = section_blocks(segment)
    sessions = {title: parse_table(table) for title, table in blocks}

    page_title = re.search(r'<div class="dirtcar-pageheadings">(.*?)</div>', page, re.S)
    track_name = re.search(r'<span class="track-name">(.*?)</span>', page, re.S)
    track_location = re.search(r'<span class="track-location">(.*?)</span>', page, re.S)

    return {
        "event": event,
        "name": strip_tags(page_title.group(1)) if page_title else event.title,
        "track": strip_tags(track_name.group(1)) if track_name else event.track,
        "location": strip_tags(track_location.group(1)) if track_location else event.location,
        "sessions": sessions,
    }


def get_or_create_track(con: sqlite3.Connection, name: str, location: str) -> int:
    row = con.execute(
        "SELECT id FROM tracks WHERE lower(name) = lower(?) LIMIT 1",
        (name,),
    ).fetchone()
    if row:
        if location:
            con.execute("UPDATE tracks SET location = COALESCE(location, ?) WHERE id = ?", (location, row[0]))
        return int(row[0])
    cur = con.execute(
        "INSERT INTO tracks (name, location, surface_type, notes) VALUES (?, ?, 'Clay', 'Created from DIRTcar Summer Nationals import')",
        (name, location),
    )
    return int(cur.lastrowid)


def get_or_create_driver(con: sqlite3.Connection, name: str, car_number: str | None) -> int:
    row = con.execute("SELECT id FROM drivers WHERE lower(name) = lower(?) LIMIT 1", (name,)).fetchone()
    if row:
        if car_number:
            con.execute("UPDATE drivers SET car_number = COALESCE(car_number, ?) WHERE id = ?", (car_number, row[0]))
        return int(row[0])
    cur = con.execute(
        "INSERT INTO drivers (name, car_number, division, notes) VALUES (?, ?, 'Open Late Model', 'Created from DIRTcar Summer Nationals import')",
        (name, car_number),
    )
    return int(cur.lastrowid)


def get_or_create_race(con: sqlite3.Connection, parsed: dict) -> int:
    event: EventRef = parsed["event"]
    source = f"DIRTcar Summer Nationals {event.event_id}"
    row = con.execute(
        "SELECT id FROM races WHERE results_source = ? LIMIT 1",
        (source,),
    ).fetchone()
    if row:
        return int(row[0])

    track_id = get_or_create_track(con, parsed["track"], parsed["location"])
    row = con.execute(
        "SELECT id FROM races WHERE track_id = ? AND race_date = ? AND lower(name) = lower(?) LIMIT 1",
        (track_id, event.date, parsed["name"]),
    ).fetchone()
    if row:
        con.execute(
            "UPDATE races SET division = 'DIRTcar Summer Nationals', series_mode = 'DIRTcar Summer Nationals', results_source = ? WHERE id = ?",
            (source, row[0]),
        )
        return int(row[0])

    cur = con.execute(
        """INSERT INTO races
             (name, track_id, race_date, division, series_mode, distance, track_condition, status, results_source)
           VALUES (?, ?, ?, 'DIRTcar Summer Nationals', 'DIRTcar Summer Nationals', ?, 'Tacky', 'complete', ?)""",
        (parsed["name"], track_id, event.date, None, source),
    )
    return int(cur.lastrowid)


def best_heat_positions(sessions: dict[str, list[dict[str, str]]]) -> dict[str, int]:
    positions: dict[str, int] = {}
    for title, rows in sessions.items():
        if not title.lower().startswith("heat"):
            continue
        for row in rows:
            name = row.get("Driver", "")
            pos = parse_int(row.get("Pos"))
            if name and pos is not None:
                key = normalize_name(name)
                positions[key] = min(pos, positions.get(key, pos))
    return positions


def qualifying_times(sessions: dict[str, list[dict[str, str]]]) -> dict[str, float]:
    times: dict[str, float] = {}
    for title, rows in sessions.items():
        if "qualifying" not in title.lower():
            continue
        for row in rows:
            name = row.get("Driver", "")
            time = parse_time(row.get("Time"))
            if name and time is not None:
                key = normalize_name(name)
                times[key] = min(time, times.get(key, time))
    return times


def import_event(con: sqlite3.Connection, parsed: dict, dry_run: bool) -> dict[str, int]:
    sessions = parsed["sessions"]
    feature = sessions.get("Feature 1") or next(
        (rows for title, rows in sessions.items() if title.lower().startswith("feature")),
        [],
    )
    if not feature:
        return {"race_id": 0, "feature_rows": 0, "added": 0, "updated": 0}

    race_id = get_or_create_race(con, parsed)
    heats = best_heat_positions(sessions)
    quals = qualifying_times(sessions)

    added = 0
    updated = 0
    for row in feature:
        driver_name = row.get("Driver", "")
        if not driver_name:
            continue
        key = normalize_name(driver_name)
        car_number = row.get("#") or None
        driver_id = get_or_create_driver(con, driver_name, car_number)
        exists = con.execute(
            "SELECT id FROM race_entries WHERE race_id = ? AND driver_id = ?",
            (race_id, driver_id),
        ).fetchone()
        dnf = 1 if "DNF" in (row.get("Status") or "").upper() else 0
        con.execute(
            """INSERT OR IGNORE INTO race_entries
                 (race_id, driver_id, car_number, starting_position, qualifying_time,
                  heat_position, finishing_position, laps_led, dnf, money, entry_series,
                  entry_status, entry_status_updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DIRTcar Summer Nationals',
                       'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))""",
            (
                race_id,
                driver_id,
                car_number,
                parse_int(row.get("Start")),
                quals.get(key),
                heats.get(key),
                parse_int(row.get("Pos")),
                parse_int(row.get("Led")) or 0,
                dnf,
                parse_money(row.get("Money")),
            ),
        )
        con.execute(
            """UPDATE race_entries
               SET car_number = COALESCE(?, car_number),
                   starting_position = COALESCE(?, starting_position),
                   qualifying_time = COALESCE(?, qualifying_time),
                   heat_position = COALESCE(?, heat_position),
                   finishing_position = COALESCE(?, finishing_position),
                   laps_led = ?,
                   dnf = ?,
                   money = COALESCE(?, money),
                   entry_series = 'DIRTcar Summer Nationals',
                   entry_status = 'confirmed',
                   entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE race_id = ? AND driver_id = ?""",
            (
                car_number,
                parse_int(row.get("Start")),
                quals.get(key),
                heats.get(key),
                parse_int(row.get("Pos")),
                parse_int(row.get("Led")) or 0,
                dnf,
                parse_money(row.get("Money")),
                race_id,
                driver_id,
            ),
        )
        added += 0 if exists else 1
        updated += 1 if exists else 0

    con.execute(
        """UPDATE races
           SET status = 'complete',
               results_imported_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?""",
        (race_id,),
    )
    if dry_run:
        con.rollback()
    return {"race_id": race_id, "feature_rows": len(feature), "added": added, "updated": updated}


def main() -> None:
    parser = argparse.ArgumentParser(description="Import DIRTcar Summer Nationals results.")
    parser.add_argument("--season", type=int, action="append", help="Season to import. Repeatable.")
    parser.add_argument("--event-id", type=int, help="Import one event id.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    seasons = args.season or [2026, 2025, 2024]
    events: list[EventRef] = []
    for season in seasons:
        events.extend(parse_season_events(season))
    if args.event_id:
        events = [event for event in events if event.event_id == args.event_id]

    con = sqlite3.connect(DB)
    try:
        total_rows = total_added = total_updated = 0
        for event in events:
            parsed = parse_event(event)
            result = import_event(con, parsed, args.dry_run)
            total_rows += result["feature_rows"]
            total_added += result["added"]
            total_updated += result["updated"]
            print(
                f"{event.season} {event.event_id} | {event.date} | {parsed['track']} | "
                f"{result['feature_rows']} feature rows | +{result['added']} / ~{result['updated']}"
            )
        if not args.dry_run:
            con.commit()
        print(f"Imported {len(events)} events, {total_rows} feature rows, +{total_added} entries, ~{total_updated} updated.")
    finally:
        con.close()


if __name__ == "__main__":
    main()
