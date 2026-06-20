#!/usr/bin/env python3
"""Import official Eldora event coverage box scores into Dirt IQ.

Eldora event coverage pages publish compact result lines such as:
  1. 32-Bobby Pierce[13]; 2. 111-Max Blair[8]

The number before the driver is finish position for that session. The bracketed
number is the start position for that session. For the feature, both values feed
the core model. For heat sections, the finish position feeds heat_position.
"""

from __future__ import annotations

import argparse
import html
import re
import sqlite3
import urllib.request
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"


@dataclass
class ResultEntry:
    position: int
    car_number: str
    driver_name: str
    start: int | None
    dns: bool


@dataclass
class ResultSection:
    title: str
    entries: list[ResultEntry]


def fetch_html(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read().decode("utf-8", errors="replace")


def strip_tags(value: str) -> str:
    return re.sub(r"<[^>]+>", "", value)


def normalize_name(name: str) -> str:
    cleaned = (
        name.lower()
        .replace(".", "")
        .replace("’", "'")
        .replace("`", "'")
        .replace(" jr", " jr")
    )
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned)
    return " ".join(cleaned.split())


def parse_entry(raw: str) -> ResultEntry | None:
    item = html.unescape(strip_tags(raw)).strip()
    if not item:
        return None

    match = re.match(r"^(\d+)\.\s+(?:(\(DNS\))\s+)?(.+)$", item)
    if not match:
        return None

    position = int(match.group(1))
    dns = bool(match.group(2))
    rest = match.group(3).strip()
    start = None
    start_match = re.search(r"\[(\d+)\]\s*$", rest)
    if start_match:
        start = int(start_match.group(1))
        rest = rest[: start_match.start()].strip()

    if "-" not in rest:
        return None
    car_number, driver_name = rest.split("-", 1)
    return ResultEntry(
        position=position,
        car_number=car_number.strip(),
        driver_name=" ".join(driver_name.strip().split()),
        start=start,
        dns=dns,
    )


def parse_sections(page_html: str) -> list[ResultSection]:
    blocks = re.findall(
        r"<p>\s*<strong>(.*?)</strong>\s*<br\s*/?>\s*(.*?)</p>",
        page_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    sections: list[ResultSection] = []
    for raw_title, raw_body in blocks:
        title = html.unescape(strip_tags(raw_title)).strip()
        body = html.unescape(raw_body).replace("\n", " ")
        entries = [entry for part in body.split(";") if (entry := parse_entry(part))]
        if entries:
            sections.append(ResultSection(title=title, entries=entries))
    return sections


def section_kind(title: str) -> str:
    lowered = title.lower()
    if "heat" in lowered:
        return "heat"
    if "feature" in lowered:
        if lowered.startswith("b feature") or " b feature" in lowered:
            return "bmain"
        return "feature"
    if "dream" in lowered or "world 100" in lowered or "a-main" in lowered or "a main" in lowered:
        return "feature"
    return "other"


def get_or_create_driver(con: sqlite3.Connection, entry: ResultEntry) -> int:
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
            if entry.car_number:
                con.execute("UPDATE drivers SET car_number = COALESCE(car_number, ?) WHERE id = ?", (entry.car_number, row[0]))
            return int(row[0])

    last = normalized.split()[-1] if normalized.split() else ""
    if last and entry.car_number:
        for row in rows:
            if normalize_name(row[1]).endswith(last) and str(row[2] or "").lower() == entry.car_number.lower():
                return int(row[0])

    cur = con.execute(
        "INSERT INTO drivers (name, car_number, division, notes) VALUES (?, ?, 'Open Late Model', 'Created from Eldora official box score import')",
        (entry.driver_name, entry.car_number),
    )
    return int(cur.lastrowid)


def ensure_entry(con: sqlite3.Connection, race_id: int, driver_id: int, car_number: str) -> None:
    con.execute(
        """INSERT OR IGNORE INTO race_entries
             (race_id, driver_id, car_number, entry_status, entry_status_updated_at)
           VALUES (?, ?, ?, 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))""",
        (race_id, driver_id, car_number),
    )
    con.execute(
        """UPDATE race_entries
           SET car_number = COALESCE(NULLIF(car_number, ''), ?),
               entry_status = 'confirmed',
               entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE race_id = ? AND driver_id = ?""",
        (car_number, race_id, driver_id),
    )


def import_box_score(race_id: int, url: str, dry_run: bool = False) -> dict:
    sections = parse_sections(fetch_html(url))
    feature_sections = [section for section in sections if section_kind(section.title) == "feature"]
    heat_sections = [section for section in sections if section_kind(section.title) == "heat"]

    con = sqlite3.connect(DB)
    try:
        race = con.execute("SELECT id FROM races WHERE id = ?", (race_id,)).fetchone()
        if not race:
            raise SystemExit(f"Race {race_id} not found")

        feature_updates = 0
        heat_updates = 0
        created_or_confirmed = 0
        dns_heat_rows = 0

        for section in feature_sections[:1]:
            for entry in section.entries:
                driver_id = get_or_create_driver(con, entry)
                ensure_entry(con, race_id, driver_id, entry.car_number)
                created_or_confirmed += 1
                con.execute(
                    """UPDATE race_entries
                       SET starting_position = ?,
                           finishing_position = ?,
                           dnf = CASE WHEN ? THEN 1 ELSE dnf END
                       WHERE race_id = ? AND driver_id = ?""",
                    (entry.start, entry.position, 1 if entry.dns else 0, race_id, driver_id),
                )
                feature_updates += 1

        for section in heat_sections:
            for entry in section.entries:
                driver_id = get_or_create_driver(con, entry)
                ensure_entry(con, race_id, driver_id, entry.car_number)
                created_or_confirmed += 1
                heat_position = None if entry.dns else entry.position
                if entry.dns:
                    dns_heat_rows += 1
                con.execute(
                    """UPDATE race_entries
                       SET heat_position = ?
                       WHERE race_id = ? AND driver_id = ?""",
                    (heat_position, race_id, driver_id),
                )
                heat_updates += 1

        con.execute(
            """UPDATE races
               SET results_source = ?,
                   results_imported_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ?""",
            (f"Eldora official box score: {url}", race_id),
        )

        if dry_run:
            con.rollback()
        else:
            con.commit()

        return {
            "raceId": race_id,
            "sections": [{"title": section.title, "kind": section_kind(section.title), "rows": len(section.entries)} for section in sections],
            "featureUpdates": feature_updates,
            "heatUpdates": heat_updates,
            "confirmedRowsTouched": created_or_confirmed,
            "dnsHeatRowsCleared": dns_heat_rows,
            "dryRun": dry_run,
        }
    finally:
        con.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Import an Eldora official event coverage box score.")
    parser.add_argument("--race-id", type=int, required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(import_box_score(args.race_id, args.url, args.dry_run))


if __name__ == "__main__":
    main()
