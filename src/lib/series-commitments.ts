import "server-only";

import { getDb } from "@/lib/db";
import { createLineCaveat } from "@/lib/line-caveats";
import { updateEntryStatus, type Race } from "@/lib/races";

const WOO_DRIVERS_SOURCE = "https://worldofoutlaws.com/drivers/";
const LUCAS_DRIVERS_SOURCE = "https://www.lucasdirt.com/our-drivers/";
const LUCAS_EXPECTED_ROSTER_SOURCE = "https://www.dirtondirt.com/story_14229.html";

const DEFAULT_WOO_LATE_MODEL_FULL_TIMERS = [
  "Tristan Chamberlain",
  "Ethan Dotson",
  "Dennis Erb Jr",
  "Tyler Erb",
  "Ryan Gustin",
  "Nick Hoffman",
  "Eli Johnson",
  "Brent Larson",
  "Tim McCreadie",
  "Trey Mills",
  "Bobby Pierce",
  "Dustin Sorensen",
  "Drake Troutman",
  "Daulton Wilson",
  "Logan Zarin",
];

const DEFAULT_LUCAS_LATE_MODEL_FULL_TIMERS = [
  "Brandon Overton",
  "Brandon Sheppard",
  "Brenden Smith",
  "Brian Shirley",
  "Carson Ferguson",
  "Clay Harris",
  "Cory Lawler",
  "Dan Ebert",
  "Daniel Hilsabeck",
  "Devin Moran",
  "Dillon McCowan",
  "Freddie Carpenter",
  "Garrett Alberson",
  "Hudson O'Neal",
  "Josh Rice",
  "Kyle Bronson",
  "Max Blair",
  "Ricky Thornton Jr.",
];

const DEFAULT_LUCAS_EXPECTED_FULL_TIMERS = [
  "Cory Hedgecock",
];

export type SeriesCommitmentConflict = {
  driverId: number;
  driverName: string;
  committedSeries: string;
  raceSeries: string;
  conflictRaceId: number | null;
  conflictRaceName: string | null;
  action: "scratched" | "skipped_confirmed" | "already_scratched";
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function isLucasSeries(value: string | null | undefined) {
  const normalized = normalize(value ?? "");
  return normalized.includes("lucas");
}

function isWooSeries(value: string | null | undefined) {
  const normalized = normalize(value ?? "");
  return normalized.includes("woo") || normalized.includes("world of outlaws");
}

function conflictingSeries(series: string | null | undefined) {
  if (isLucasSeries(series)) return "WoO Late Models";
  if (isWooSeries(series)) return "Lucas Oil LMDS";
  return null;
}

function seedSeriesCommitments(data: {
  names: string[];
  series: string;
  commitmentType: string;
  sourceUrl: string;
  byName: Map<string, number>;
}) {
  const db = getDb();
  for (const name of data.names) {
    const driverId = data.byName.get(normalize(name));
    if (!driverId) continue;

    db.prepare(
      `INSERT INTO driver_series_commitments
        (driver_id, series, commitment_type, source_url, active, updated_at)
       VALUES (?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(driver_id, series) DO UPDATE SET
         commitment_type = excluded.commitment_type,
         source_url = excluded.source_url,
         active = 1,
         updated_at = excluded.updated_at`
    ).run(driverId, data.series, data.commitmentType, data.sourceUrl);
  }
}

export function seedDefaultSeriesCommitments() {
  const db = getDb();
  const drivers = db.prepare("SELECT id, name FROM drivers").all() as Array<{ id: number; name: string }>;
  const byName = new Map(drivers.map((driver) => [normalize(driver.name), driver.id]));

  seedSeriesCommitments({
    names: DEFAULT_WOO_LATE_MODEL_FULL_TIMERS,
    series: "WoO Late Models",
    commitmentType: "full_time",
    sourceUrl: WOO_DRIVERS_SOURCE,
    byName,
  });
  seedSeriesCommitments({
    names: DEFAULT_LUCAS_LATE_MODEL_FULL_TIMERS,
    series: "Lucas Oil LMDS",
    commitmentType: "full_time",
    sourceUrl: LUCAS_DRIVERS_SOURCE,
    byName,
  });
  seedSeriesCommitments({
    names: DEFAULT_LUCAS_EXPECTED_FULL_TIMERS,
    series: "Lucas Oil LMDS",
    commitmentType: "expected_full_time",
    sourceUrl: LUCAS_EXPECTED_ROSTER_SOURCE,
    byName,
  });
}

export function applySeriesCommitmentConflicts(raceId: number): SeriesCommitmentConflict[] {
  seedDefaultSeriesCommitments();

  const db = getDb();
  const race = db.prepare("SELECT * FROM races WHERE id = ?").get(raceId) as Race | undefined;
  if (!race) throw new Error("Race not found.");

  const committedSeries = conflictingSeries(race.series_mode ?? race.division);
  if (!committedSeries) return [];

  const conflictRace = db.prepare(
    `SELECT id, name
     FROM races
     WHERE id != ?
       AND status = 'upcoming'
       AND date(race_date) BETWEEN date(?, '-1 day') AND date(?, '+1 day')
       AND (
         lower(COALESCE(division, '')) LIKE ?
         OR lower(COALESCE(series_mode, '')) LIKE ?
       )
     ORDER BY ABS(julianday(race_date) - julianday(?)), id
     LIMIT 1`
  ).get(
    raceId,
    race.race_date,
    race.race_date,
    `%${committedSeries.toLowerCase().split(" ")[0]}%`,
    `%${committedSeries.toLowerCase().split(" ")[0]}%`,
    race.race_date
  ) as { id: number; name: string } | undefined;

  if (!conflictRace) return [];

  const rows = db.prepare(
    `SELECT re.driver_id, re.entry_status, d.name AS driver_name, dsc.series,
            dsc.commitment_type, dsc.source_url
     FROM race_entries re
     JOIN drivers d ON d.id = re.driver_id
     JOIN driver_series_commitments dsc ON dsc.driver_id = re.driver_id
     WHERE re.race_id = ?
       AND dsc.series = ?
       AND dsc.active = 1`
  ).all(raceId, committedSeries) as Array<{
    driver_id: number;
    entry_status: "confirmed" | "expected" | "unconfirmed" | "scratched";
    driver_name: string;
    series: string;
    commitment_type: string;
    source_url: string | null;
  }>;

  const conflicts: SeriesCommitmentConflict[] = [];

  for (const row of rows) {
    let action: SeriesCommitmentConflict["action"] = "scratched";

    if (row.entry_status === "confirmed") {
      action = "skipped_confirmed";
    } else if (row.entry_status === "scratched") {
      action = "already_scratched";
    } else {
      updateEntryStatus(raceId, row.driver_id, "scratched");
    }

    const commitmentLabel = row.commitment_type === "expected_full_time" ? "expected full-time" : "full-time";
    const note = `${row.driver_name} is listed as an ${commitmentLabel} ${row.series} driver; ${conflictRace.name} is scheduled the same weekend, so assume unavailable for this opposing-series race unless manually confirmed.`;
    const existing = db.prepare(
      `SELECT 1 FROM line_caveats
       WHERE race_id = ?
         AND driver_id = ?
         AND caveat_type = 'series_commitment_conflict'
         AND active = 1`
    ).get(raceId, row.driver_id);

    if (!existing) {
      createLineCaveat({
        raceId,
        driverId: row.driver_id,
        caveatType: "series_commitment_conflict",
        severity: action === "skipped_confirmed" ? "caution" : "scratch",
        probabilityMultiplier: action === "skipped_confirmed" ? 0.55 : 0.02,
        note,
        sourceUrl: row.source_url ?? WOO_DRIVERS_SOURCE,
      });
    }

    conflicts.push({
      driverId: row.driver_id,
      driverName: row.driver_name,
      committedSeries: row.series,
      raceSeries: race.series_mode ?? race.division,
      conflictRaceId: conflictRace.id,
      conflictRaceName: conflictRace.name,
      action,
    });
  }

  return conflicts;
}
