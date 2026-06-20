import "server-only";

import { getDb } from "@/lib/db";
import { createLineCaveat } from "@/lib/line-caveats";
import type { Race, RaceEntry } from "@/lib/races";

export type FieldCarryForwardResult = {
  targetRaceId: number;
  previousRaceId: number | null;
  previousRaceName: string | null;
  confirmed: number;
  added: number;
  scratched: number;
  unconfirmed: number;
  skippedConfirmed: number;
  skippedScratched: number;
};

type EntryRow = Pick<
  RaceEntry,
  "driver_id" | "driver_name" | "car_number" | "entry_status" | "finishing_position"
>;

function normalizeStatus(status: string | null | undefined): RaceEntry["entry_status"] {
  if (status === "confirmed" || status === "unconfirmed" || status === "scratched") return status;
  return "expected";
}

function hasActiveCaveat(raceId: number, driverId: number, caveatType: string) {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1
         FROM line_caveats
         WHERE race_id = ?
           AND driver_id = ?
           AND caveat_type = ?
           AND active = 1
         LIMIT 1`
      )
      .get(raceId, driverId, caveatType)
  );
}

export function applyPreviousDayFieldCarryForward(raceId: number): FieldCarryForwardResult {
  const db = getDb();
  const target = db.prepare("SELECT * FROM races WHERE id = ?").get(raceId) as Race | undefined;
  if (!target) throw new Error("Race not found.");

  const previous = db
    .prepare(
      `SELECT *
       FROM races
       WHERE id != ?
         AND track_id = ?
         AND status = 'complete'
         AND date(race_date) BETWEEN date(?, '-2 day') AND date(?, '-1 day')
         AND lower(COALESCE(series_mode, division, '')) = lower(COALESCE(?, ?))
       ORDER BY race_date DESC, id DESC
       LIMIT 1`
    )
    .get(
      raceId,
      target.track_id,
      target.race_date,
      target.race_date,
      target.series_mode ?? target.division,
      target.division
    ) as Race | undefined;

  if (!previous) {
    return {
      targetRaceId: raceId,
      previousRaceId: null,
      previousRaceName: null,
      confirmed: 0,
      added: 0,
      scratched: 0,
      unconfirmed: 0,
      skippedConfirmed: 0,
      skippedScratched: 0,
    };
  }

  const previousRows = db
    .prepare(
      `SELECT re.driver_id,
              d.name AS driver_name,
              re.car_number,
              COALESCE(re.entry_status, 'expected') AS entry_status,
              re.finishing_position
       FROM race_entries re
       JOIN drivers d ON d.id = re.driver_id
       WHERE re.race_id = ?`
    )
    .all(previous.id) as EntryRow[];

  const targetRows = db
    .prepare(
      `SELECT re.driver_id,
              d.name AS driver_name,
              re.car_number,
              COALESCE(re.entry_status, 'expected') AS entry_status,
              re.finishing_position
       FROM race_entries re
       JOIN drivers d ON d.id = re.driver_id
       WHERE re.race_id = ?`
    )
    .all(raceId) as EntryRow[];

  const targetByDriver = new Map(targetRows.map((entry) => [entry.driver_id, entry]));
  const appearedPrevious = new Set<number>();
  const scratchedPrevious = new Set<number>();

  let confirmed = 0;
  let added = 0;
  let scratched = 0;
  let skippedConfirmed = 0;
  let skippedScratched = 0;

  const write = () => {
    db.exec("BEGIN");
    try {
    for (const entry of previousRows) {
      const status = normalizeStatus(entry.entry_status);
      if (status === "scratched") {
        scratchedPrevious.add(entry.driver_id);
      } else if (entry.finishing_position !== null || status === "confirmed") {
        appearedPrevious.add(entry.driver_id);
      }
    }

    for (const entry of previousRows) {
      const status = normalizeStatus(entry.entry_status);
      const targetEntry = targetByDriver.get(entry.driver_id);

      if (status === "scratched") {
        if (!targetEntry) continue;
        if (targetEntry.entry_status === "confirmed") {
          skippedConfirmed += 1;
          continue;
        }
        if (targetEntry.entry_status !== "scratched") {
          db.prepare(
            `UPDATE race_entries
             SET entry_status = 'scratched',
                 entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE race_id = ? AND driver_id = ?`
          ).run(raceId, entry.driver_id);
          scratched += 1;
        } else {
          skippedScratched += 1;
        }
        continue;
      }

      if (!appearedPrevious.has(entry.driver_id)) continue;

      if (!targetEntry) {
        db.prepare(
          `INSERT INTO race_entries
            (race_id, driver_id, car_number, entry_status, entry_status_updated_at)
           VALUES (?, ?, ?, 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
        ).run(raceId, entry.driver_id, entry.car_number);
        added += 1;
        confirmed += 1;
        continue;
      }

      if (targetEntry.entry_status === "scratched") {
        skippedScratched += 1;
        continue;
      }

      if (targetEntry.entry_status !== "confirmed") {
        db.prepare(
          `UPDATE race_entries
           SET entry_status = 'confirmed',
               entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               car_number = COALESCE(car_number, ?)
           WHERE race_id = ? AND driver_id = ?`
        ).run(entry.car_number, raceId, entry.driver_id);
        confirmed += 1;
      }
    }

    for (const entry of targetRows) {
      if (appearedPrevious.has(entry.driver_id) || scratchedPrevious.has(entry.driver_id)) continue;
      if (entry.entry_status !== "expected") continue;

      db.prepare(
        `UPDATE race_entries
         SET entry_status = 'unconfirmed',
             entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE race_id = ? AND driver_id = ?`
      ).run(raceId, entry.driver_id);

      if (!hasActiveCaveat(raceId, entry.driver_id, "previous_day_field_missing")) {
        createLineCaveat({
          raceId,
          driverId: entry.driver_id,
          caveatType: "previous_day_field_missing",
          severity: "caution",
          probabilityMultiplier: 0.55,
          note: `${entry.driver_name} was not in the previous same-track field for ${previous.name}; keep cautious until today's entry list or hot laps confirms attendance.`,
        });
      }
    }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  write();

  const unconfirmed = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM race_entries
       WHERE race_id = ?
         AND COALESCE(entry_status, 'expected') = 'unconfirmed'`
    )
    .get(raceId) as { count: number };

  return {
    targetRaceId: raceId,
    previousRaceId: previous.id,
    previousRaceName: previous.name,
    confirmed,
    added,
    scratched,
    unconfirmed: unconfirmed.count,
    skippedConfirmed,
    skippedScratched,
  };
}
