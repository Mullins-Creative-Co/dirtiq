#!/usr/bin/env python3
"""Write immutable, tamper-evident forecast snapshots before results exist."""

import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from model_runtime import DB, DATA_DIR, ROOT


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def lock_available(database=DB, cache_dir=None, output_dir=None, today=None):
    cache_dir = Path(cache_dir or DATA_DIR / "ml-predictions")
    output_dir = Path(output_dir or ROOT / "public/data/prediction-locks")
    today = today or datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    output_dir.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(database)
    con.row_factory = sqlite3.Row
    created = []
    skipped = []

    for cache_path in sorted(cache_dir.glob("race_*.json")):
        try:
            payload = json.loads(cache_path.read_text())
            race_id = int(payload["raceId"])
        except (KeyError, ValueError, TypeError, json.JSONDecodeError):
            skipped.append({"cache": cache_path.name, "reason": "invalid cache"})
            continue
        race = con.execute(
            "SELECT id,name,race_date,status,track_id FROM races WHERE id=?", (race_id,)
        ).fetchone()
        if not race or race["status"] != "upcoming" or race["race_date"] < today:
            continue
        result_count = con.execute(
            "SELECT count(*) FROM race_entries WHERE race_id=? AND finishing_position IS NOT NULL",
            (race_id,),
        ).fetchone()[0]
        if result_count:
            skipped.append({"raceId": race_id, "reason": "results already present"})
            continue
        predictions = sorted(payload.get("predictions", []), key=lambda row: row.get("probability", 0), reverse=True)
        if len(predictions) < 2:
            continue
        stage = payload.get("modelStage") or "early"
        destination = output_dir / f"race_{race_id}_{stage}.json"
        if destination.exists():
            continue
        inputs = [dict(row) for row in con.execute(
            """SELECT driver_id,entry_status,starting_position,heat_position,qualifying_time
               FROM race_entries WHERE race_id=? ORDER BY driver_id""", (race_id,)
        )]
        forecast = {
            "schemaVersion": 1,
            "race": {"id": race_id, "name": race["name"], "date": race["race_date"], "trackId": race["track_id"]},
            "lockedAt": datetime.now(timezone.utc).isoformat(),
            "modelStage": stage,
            "modelSeries": payload.get("modelSeries"),
            "modelSlug": payload.get("modelSlug"),
            "trainedOn": predictions[0].get("trainedOn"),
            "inputCoverage": payload.get("raceNightCoverage"),
            "resultCountAtLock": 0,
            "inputSha256": hashlib.sha256(canonical(inputs)).hexdigest(),
            "sourceCacheSha256": hashlib.sha256(cache_path.read_bytes()).hexdigest(),
            "predictions": [{
                "rank": rank,
                "driverId": row.get("driverId"),
                "driverName": row.get("driverName"),
                "probability": row.get("probability"),
                "rawProbability": row.get("rawProbability"),
            } for rank, row in enumerate(predictions, 1)],
        }
        forecast["snapshotSha256"] = hashlib.sha256(canonical(forecast)).hexdigest()
        with destination.open("x") as handle:
            json.dump(forecast, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        try:
            created.append(str(destination.relative_to(ROOT)))
        except ValueError:
            created.append(str(destination))
    con.close()
    return {"created": created, "skipped": skipped}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DB)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--today")
    args = parser.parse_args()
    print(json.dumps(lock_available(args.database, args.cache_dir, args.output_dir, args.today)))
