import "server-only";
import { getDb } from "@/lib/db";

export type DriverSpecialty = {
  id: number;
  driver_id: number;
  track_family: string | null;
  track_id: number | null;
  track_name: string | null;
  bonus_score: number;
  notes: string | null;
  created_at: string;
};

export function getDriverSpecialties(driverId: number): DriverSpecialty[] {
  return getDb().prepare(`
    SELECT ds.*, t.name AS track_name
    FROM driver_specialties ds
    LEFT JOIN tracks t ON t.id = ds.track_id
    WHERE ds.driver_id = ?
    ORDER BY ds.bonus_score DESC
  `).all(driverId) as DriverSpecialty[];
}

export function upsertDriverSpecialty(data: {
  driver_id: number;
  track_family?: string | null;
  track_id?: number | null;
  bonus_score: number;
  notes?: string | null;
}): number {
  const db = getDb();
  // If both track_family and track_id are set, prefer the combo; otherwise check individually
  const existing = db.prepare(`
    SELECT id FROM driver_specialties
    WHERE driver_id = ?
      AND (track_family IS ? OR (track_family IS NULL AND ? IS NULL))
      AND (track_id IS ? OR (track_id IS NULL AND ? IS NULL))
  `).get(
    data.driver_id,
    data.track_family ?? null, data.track_family ?? null,
    data.track_id ?? null, data.track_id ?? null
  ) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE driver_specialties SET bonus_score = ?, notes = ? WHERE id = ?
    `).run(data.bonus_score, data.notes ?? null, existing.id);
    return existing.id;
  }

  const r = db.prepare(`
    INSERT INTO driver_specialties (driver_id, track_family, track_id, bonus_score, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.driver_id, data.track_family ?? null, data.track_id ?? null, data.bonus_score, data.notes ?? null);
  return r.lastInsertRowid as number;
}

export function removeDriverSpecialty(id: number): void {
  getDb().prepare("DELETE FROM driver_specialties WHERE id = ?").run(id);
}

// Used by odds.ts to get specialty bonus for a driver at a given track
export function getDriverSpecialtyBonus(driverId: number, trackId: number, trackFamily: string | null): number {
  const db = getDb();
  const rows = db.prepare(`
    SELECT bonus_score FROM driver_specialties
    WHERE driver_id = ?
      AND (track_id = ? OR (track_family IS NOT NULL AND track_family = ?))
    ORDER BY bonus_score DESC
    LIMIT 1
  `).all(driverId, trackId, trackFamily) as Array<{ bonus_score: number }>;
  // Return the highest applicable bonus
  return rows.length > 0 ? rows[0].bonus_score : 0;
}
