import "server-only";
import { getDb } from "@/lib/db";

export type Race = {
  id: number; name: string; track_id: number; track_name: string;
  race_date: string; division: string; distance: number | null;
  track_condition: string; weather_notes: string | null;
  time_of_day: string; temperature_f: number | null; humidity_pct: number | null;
  precip_48h_in: number | null; water_truck_runs: number | null; groove_stage: string | null;
  status: "upcoming" | "complete" | "cancelled"; is_live: number; created_at: string;
};

export type RaceEntry = {
  id: number; race_id: number; driver_id: number; driver_name: string;
  car_number: string | null; starting_position: number | null;
  qualifying_time: number | null; heat_position: number | null;
  finishing_position: number | null; laps_led: number; dnf: number; dnf_reason: string | null;
  engine_builder: string | null; tire_compound: string | null; crew_chief: string | null;
  margin: string | null; money: number | null;
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

export function createRace(data: { name: string; track_id: number; race_date: string; division?: string; distance?: number; track_condition?: string; weather_notes?: string; time_of_day?: string; temperature_f?: number; humidity_pct?: number; precip_48h_in?: number; water_truck_runs?: number; groove_stage?: string }): number {
  const r = getDb().prepare(`INSERT INTO races (name, track_id, race_date, division, distance, track_condition, weather_notes, time_of_day, temperature_f, humidity_pct, precip_48h_in, water_truck_runs, groove_stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.name, data.track_id, data.race_date, data.division ?? "Open", data.distance ?? null, data.track_condition ?? "Tacky", data.weather_notes ?? null, data.time_of_day ?? "night", data.temperature_f ?? null, data.humidity_pct ?? null, data.precip_48h_in ?? null, data.water_truck_runs ?? null, data.groove_stage ?? null);
  return r.lastInsertRowid as number;
}

export function addRaceEntry(data: { race_id: number; driver_id: number; car_number?: string; starting_position?: number; engine_builder?: string; tire_compound?: string; crew_chief?: string }): void {
  getDb().prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, starting_position, engine_builder, tire_compound, crew_chief) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(data.race_id, data.driver_id, data.car_number ?? null, data.starting_position ?? null, data.engine_builder ?? null, data.tire_compound ?? null, data.crew_chief ?? null);
}

export function recordResult(data: { race_id: number; driver_id: number; finishing_position?: number; laps_led?: number; dnf?: boolean; dnf_reason?: string; margin?: string; money?: number }): void {
  getDb().prepare(`UPDATE race_entries SET finishing_position = ?, laps_led = ?, dnf = ?, dnf_reason = ?, margin = ?, money = ? WHERE race_id = ? AND driver_id = ?`)
    .run(data.finishing_position ?? null, data.laps_led ?? 0, data.dnf ? 1 : 0, data.dnf_reason ?? null, data.margin ?? null, data.money ?? null, data.race_id, data.driver_id);
}

export function updatePreRaceData(data: { race_id: number; driver_id: number; qualifying_time?: number; heat_position?: number; starting_position?: number }): void {
  getDb().prepare(`UPDATE race_entries SET qualifying_time = ?, heat_position = ?, starting_position = ? WHERE race_id = ? AND driver_id = ?`)
    .run(data.qualifying_time ?? null, data.heat_position ?? null, data.starting_position ?? null, data.race_id, data.driver_id);
}

export function completeRace(raceId: number): void {
  getDb().prepare(`UPDATE races SET status = 'complete' WHERE id = ?`).run(raceId);
}

export function updateRaceConditions(data: { race_id: number; track_condition: string; weather_notes?: string; time_of_day?: string; temperature_f?: number | null; humidity_pct?: number | null; precip_48h_in?: number | null; water_truck_runs?: number | null; groove_stage?: string | null }): void {
  getDb().prepare(`UPDATE races SET track_condition = ?, weather_notes = ?, time_of_day = COALESCE(?, time_of_day), temperature_f = ?, humidity_pct = ?, precip_48h_in = ?, water_truck_runs = ?, groove_stage = ? WHERE id = ?`)
    .run(data.track_condition, data.weather_notes ?? null, data.time_of_day ?? null, data.temperature_f ?? null, data.humidity_pct ?? null, data.precip_48h_in ?? null, data.water_truck_runs ?? null, data.groove_stage ?? null, data.race_id);
}

export function setRaceLive(raceId: number, isLive: boolean): void {
  getDb().prepare(`UPDATE races SET is_live = ? WHERE id = ?`).run(isLive ? 1 : 0, raceId);
}
