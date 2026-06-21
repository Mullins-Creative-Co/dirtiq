import "server-only";
import { getDb } from "@/lib/db";

export type Race = {
  id: number; name: string; track_id: number; track_name: string;
  race_date: string; division: string; distance: number | null;
  series_mode: string | null;
  track_condition: string; weather_notes: string | null;
  time_of_day: string; temperature_f: number | null; humidity_pct: number | null;
  precip_48h_in: number | null; water_truck_runs: number | null; groove_stage: string | null;
  status: "upcoming" | "complete" | "cancelled"; is_live: number; created_at: string;
  mrp_event_id: number | null; betting_status: "open" | "locked" | "settled" | "void";
  betting_locked_at: string | null; betting_lock_reason: string | null;
  results_source: string | null; results_imported_at: string | null; settled_at: string | null;
};

export type RaceEntry = {
  id: number; race_id: number; driver_id: number; driver_name: string;
  car_number: string | null; starting_position: number | null;
  qualifying_time: number | null; heat_position: number | null; bmain_position: number | null;
  finishing_position: number | null; laps_led: number; dnf: number; dnf_reason: string | null;
  engine_builder: string | null; tire_compound: string | null; crew_chief: string | null;
  entry_series: string | null;
  entry_status: "confirmed" | "expected" | "unconfirmed" | "scratched";
  entry_status_updated_at: string | null;
  margin: string | null; money: number | null;
};

export function todayDateString() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  return `${partMap.get("year")}-${partMap.get("month")}-${partMap.get("day")}`;
}

export function isLateModelDivision(division: string | null | undefined) {
  const normalized = (division ?? "").toLowerCase();
  if (normalized.includes("sprint")) return false;
  return (
    normalized.includes("late model") ||
    normalized.includes("lucas oil lmds") ||
    normalized.includes("crown jewel") ||
    normalized.includes("dirtcar summer nationals") ||
    normalized.includes("hell tour") ||
    normalized.includes("helltour") ||
    normalized === "independent"
  );
}

export function isActiveModelTarget(race: { division: string | null; series_mode?: string | null }) {
  return isLateModelDivision(`${race.division ?? ""} ${race.series_mode ?? ""}`);
}

export function isFocusedModelSeries(race: { name?: string | null; division: string | null; series_mode?: string | null }) {
  const normalized = `${race.name ?? ""} ${race.division ?? ""} ${race.series_mode ?? ""}`.toLowerCase();
  return (
    normalized.includes("lucas oil lmds") ||
    normalized.includes("lucas oil late model") ||
    normalized.includes("woo late models") ||
    normalized.includes("world of outlaws") ||
    normalized.includes("crown jewel") ||
    normalized.includes("combined") ||
    normalized.includes("dirtcar summer nationals") ||
    normalized.includes("hell tour") ||
    normalized.includes("helltour")
  );
}

export function isRaceBettingOpen(race: {
  race_date: string;
  division: string | null;
  series_mode?: string | null;
  status: string;
  is_live: number;
  betting_status: string | null;
}) {
  return (
    race.status === "upcoming" &&
    race.race_date >= todayDateString() &&
    !race.is_live &&
    (race.betting_status ?? "open") === "open" &&
    isActiveModelTarget(race)
  );
}

export function listRaces(): Race[] {
  return getDb().prepare(`
    SELECT r.*, t.name AS track_name
    FROM races r
    JOIN tracks t ON t.id = r.track_id
    ORDER BY
      CASE r.status WHEN 'upcoming' THEN 0 WHEN 'complete' THEN 1 ELSE 2 END,
      CASE WHEN r.status = 'upcoming' THEN r.race_date END ASC,
      CASE WHEN r.status != 'upcoming' THEN r.race_date END DESC,
      r.id ASC
  `).all() as Race[];
}

export function listOpenBettingRaces(limit = 8): Race[] {
  return getDb().prepare(`
    SELECT r.*, t.name AS track_name
    FROM races r
    JOIN tracks t ON t.id = r.track_id
    WHERE r.status = 'upcoming'
      AND r.race_date >= ?
      AND r.is_live = 0
      AND COALESCE(r.betting_status, 'open') = 'open'
      AND (
        lower(COALESCE(r.division, '')) LIKE '%late model%'
        OR lower(COALESCE(r.series_mode, '')) LIKE '%late model%'
        OR lower(COALESCE(r.division, '')) LIKE '%lucas oil lmds%'
        OR lower(COALESCE(r.series_mode, '')) LIKE '%lucas oil lmds%'
        OR lower(COALESCE(r.division, '')) LIKE '%crown jewel%'
        OR lower(COALESCE(r.series_mode, '')) LIKE '%crown jewel%'
        OR lower(COALESCE(r.division, '')) LIKE '%dirtcar summer nationals%'
        OR lower(COALESCE(r.series_mode, '')) LIKE '%dirtcar summer nationals%'
        OR lower(COALESCE(r.division, '')) LIKE '%hell tour%'
        OR lower(COALESCE(r.series_mode, '')) LIKE '%hell tour%'
        OR lower(COALESCE(r.series_mode, '')) LIKE '%helltour%'
      )
      AND lower(COALESCE(r.division, '')) NOT LIKE '%sprint%'
      AND lower(COALESCE(r.series_mode, '')) NOT LIKE '%sprint%'
    ORDER BY r.race_date ASC, r.id ASC
    LIMIT ?
  `).all(todayDateString(), limit) as Race[];
}

export function getRace(id: number): Race | null {
  return (getDb().prepare(`SELECT r.*, t.name AS track_name FROM races r JOIN tracks t ON t.id = r.track_id WHERE r.id = ?`).get(id) as Race) ?? null;
}

export function getRaceEntries(raceId: number): RaceEntry[] {
  return getDb().prepare(`SELECT e.*, d.name AS driver_name FROM race_entries e JOIN drivers d ON d.id = e.driver_id WHERE e.race_id = ? ORDER BY COALESCE(e.finishing_position, 999), e.starting_position`).all(raceId) as RaceEntry[];
}

export function createRace(data: { name: string; track_id: number; race_date: string; division?: string; series_mode?: string; distance?: number; track_condition?: string; weather_notes?: string; time_of_day?: string; temperature_f?: number; humidity_pct?: number; precip_48h_in?: number; water_truck_runs?: number; groove_stage?: string }): number {
  const division = data.division ?? "Open";
  const r = getDb().prepare(`INSERT INTO races (name, track_id, race_date, division, series_mode, distance, track_condition, weather_notes, time_of_day, temperature_f, humidity_pct, precip_48h_in, water_truck_runs, groove_stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.name, data.track_id, data.race_date, division, data.series_mode ?? division, data.distance ?? null, data.track_condition ?? "Tacky", data.weather_notes ?? null, data.time_of_day ?? "night", data.temperature_f ?? null, data.humidity_pct ?? null, data.precip_48h_in ?? null, data.water_truck_runs ?? null, data.groove_stage ?? null);
  return r.lastInsertRowid as number;
}

export function addRaceEntry(data: { race_id: number; driver_id: number; car_number?: string; starting_position?: number; entry_series?: string; entry_status?: string; engine_builder?: string; tire_compound?: string; crew_chief?: string }): void {
  getDb().prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, starting_position, entry_series, entry_status, entry_status_updated_at, engine_builder, tire_compound, crew_chief) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?, ?)`)
    .run(data.race_id, data.driver_id, data.car_number ?? null, data.starting_position ?? null, data.entry_series ?? null, data.entry_status ?? "expected", data.engine_builder ?? null, data.tire_compound ?? null, data.crew_chief ?? null);
}

export function updateEntryStatus(raceId: number, driverId: number, entryStatus: RaceEntry["entry_status"]): void {
  getDb()
    .prepare("UPDATE race_entries SET entry_status = ?, entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE race_id = ? AND driver_id = ?")
    .run(entryStatus, raceId, driverId);
}

export function recordResult(data: { race_id: number; driver_id: number; finishing_position?: number; starting_position?: number | null; laps_led?: number; dnf?: boolean; dnf_reason?: string; margin?: string; money?: number }): void {
  getDb().prepare(`
    UPDATE race_entries
    SET finishing_position = ?,
        starting_position = COALESCE(?, starting_position),
        laps_led = ?,
        dnf = ?,
        dnf_reason = ?,
        margin = ?,
        money = ?
    WHERE race_id = ? AND driver_id = ?
  `).run(data.finishing_position ?? null, data.starting_position ?? null, data.laps_led ?? 0, data.dnf ? 1 : 0, data.dnf_reason ?? null, data.margin ?? null, data.money ?? null, data.race_id, data.driver_id);
}

export function updatePreRaceData(data: { race_id: number; driver_id: number; qualifying_time?: number; heat_position?: number; starting_position?: number }): void {
  getDb().prepare(`UPDATE race_entries SET qualifying_time = ?, heat_position = ?, starting_position = ? WHERE race_id = ? AND driver_id = ?`)
    .run(data.qualifying_time ?? null, data.heat_position ?? null, data.starting_position ?? null, data.race_id, data.driver_id);
}

export function lockBetting(raceId: number, reason: string): void {
  getDb()
    .prepare(
      `UPDATE races
       SET betting_status = CASE WHEN status = 'complete' THEN 'settled' ELSE 'locked' END,
           betting_locked_at = COALESCE(betting_locked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
           betting_lock_reason = ?
       WHERE id = ? AND betting_status != 'settled'`
    )
    .run(reason, raceId);
}

export function reopenBetting(raceId: number): void {
  getDb()
    .prepare(
      `UPDATE races
       SET betting_status = 'open',
           betting_locked_at = NULL,
           betting_lock_reason = NULL,
           is_live = 0
       WHERE id = ? AND status = 'upcoming'`
    )
    .run(raceId);
}

export function completeRace(raceId: number, source = "manual"): void {
  getDb()
    .prepare(
      `UPDATE races
       SET status = 'complete',
           is_live = 0,
           betting_status = 'settled',
           betting_locked_at = COALESCE(betting_locked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
           betting_lock_reason = COALESCE(betting_lock_reason, 'results posted'),
           results_source = ?,
           results_imported_at = COALESCE(results_imported_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
           settled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .run(source, raceId);
}

export function updateRaceConditions(data: { race_id: number; track_condition: string; weather_notes?: string; time_of_day?: string; temperature_f?: number | null; humidity_pct?: number | null; precip_48h_in?: number | null; water_truck_runs?: number | null; groove_stage?: string | null }): void {
  getDb().prepare(`UPDATE races SET track_condition = ?, weather_notes = ?, time_of_day = COALESCE(?, time_of_day), temperature_f = ?, humidity_pct = ?, precip_48h_in = ?, water_truck_runs = ?, groove_stage = ? WHERE id = ?`)
    .run(data.track_condition, data.weather_notes ?? null, data.time_of_day ?? null, data.temperature_f ?? null, data.humidity_pct ?? null, data.precip_48h_in ?? null, data.water_truck_runs ?? null, data.groove_stage ?? null, data.race_id);
}

export function setRaceLive(raceId: number, isLive: boolean): void {
  const db = getDb();
  db.prepare(`UPDATE races SET is_live = ? WHERE id = ?`).run(isLive ? 1 : 0, raceId);
  if (isLive) {
    lockBetting(raceId, "race marked live");
  }
}
