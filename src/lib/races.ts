import "server-only";
import { getDb } from "@/lib/db";

export type Race = {
  id: number; name: string; track_id: number; track_name: string;
  race_date: string; division: string; distance: number | null;
  track_condition: string; weather_notes: string | null;
  status: "upcoming" | "complete" | "cancelled"; is_live: number; created_at: string;
};

export type RaceEntry = {
  id: number; race_id: number; driver_id: number; driver_name: string;
  car_number: string | null; starting_position: number | null;
  qualifying_time: number | null; heat_position: number | null;
  finishing_position: number | null; laps_led: number; dnf: number; dnf_reason: string | null;
};

export function listRaces(): Race[] {
  return getDb().prepare(`SELECT r.*, t.name AS track_name FROM races r JOIN tracks t ON t.id = r.track_id ORDER BY r.race_date DESC`).all() as Race[];
}

export function getRace(id: number): Race | null {
  return (getDb().prepare(`SELECT r.*, t.name AS track_name FROM races r JOIN tracks t ON t.id = r.track_id WHERE r.id = ?`).get(id) as Race) ?? null;
}

export function getRaceEntries(raceId: number): RaceEntry[] {
  return getDb().prepare(`SELECT e.*, d.name AS driver_name FROM race_entries e JOIN drivers d ON d.id = e.driver_id WHERE e.race_id = ? ORDER BY COALESCE(e.finishing_position, 999), e.starting_position`).all(raceId) as RaceEntry[];
}

export function createRace(data: { name: string; track_id: number; race_date: string; division?: string; distance?: number; track_condition?: string; weather_notes?: string }): number {
  const r = getDb().prepare(`INSERT INTO races (name, track_id, race_date, division, distance, track_condition, weather_notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(data.name, data.track_id, data.race_date, data.division ?? "Open", data.distance ?? null, data.track_condition ?? "Tacky", data.weather_notes ?? null);
  return r.lastInsertRowid as number;
}

export function addRaceEntry(data: { race_id: number; driver_id: number; car_number?: string; starting_position?: number }): void {
  getDb().prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, starting_position) VALUES (?, ?, ?, ?)`)
    .run(data.race_id, data.driver_id, data.car_number ?? null, data.starting_position ?? null);
}

export function recordResult(data: { race_id: number; driver_id: number; finishing_position?: number; laps_led?: number; dnf?: boolean; dnf_reason?: string }): void {
  getDb().prepare(`UPDATE race_entries SET finishing_position = ?, laps_led = ?, dnf = ?, dnf_reason = ? WHERE race_id = ? AND driver_id = ?`)
    .run(data.finishing_position ?? null, data.laps_led ?? 0, data.dnf ? 1 : 0, data.dnf_reason ?? null, data.race_id, data.driver_id);
}

export function updatePreRaceData(data: { race_id: number; driver_id: number; qualifying_time?: number; heat_position?: number; starting_position?: number }): void {
  getDb().prepare(`UPDATE race_entries SET qualifying_time = ?, heat_position = ?, starting_position = ? WHERE race_id = ? AND driver_id = ?`)
    .run(data.qualifying_time ?? null, data.heat_position ?? null, data.starting_position ?? null, data.race_id, data.driver_id);
}

export function completeRace(raceId: number): void {
  getDb().prepare(`UPDATE races SET status = 'complete' WHERE id = ?`).run(raceId);
}

export function updateRaceConditions(data: { race_id: number; track_condition: string; weather_notes?: string; track_notes?: string }): void {
  getDb().prepare(`UPDATE races SET track_condition = ?, weather_notes = ? WHERE id = ?`)
    .run(data.track_condition, data.weather_notes ?? null, data.race_id);
}

export function setRaceLive(raceId: number, isLive: boolean): void {
  getDb().prepare(`UPDATE races SET is_live = ? WHERE id = ?`).run(isLive ? 1 : 0, raceId);
}
