import "server-only";
import { getDb } from "@/lib/db";

export type Track = {
  id: number; name: string; location: string | null;
  surface_type: string; track_length: number | null;
  banking_angle: number | null; clay_type: string | null;
  avg_caution_rate: number | null;
  track_family: string | null; notes: string | null; created_at: string;
};

export type TrackSimilar = {
  id: number; track_id: number; similar_track_id: number;
  similar_name: string; similarity_weight: number; notes: string | null;
};

export function listTracks(): Track[] {
  return getDb().prepare("SELECT * FROM tracks ORDER BY name ASC").all() as Track[];
}

export function getTrack(id: number): Track | null {
  return (getDb().prepare("SELECT * FROM tracks WHERE id = ?").get(id) as Track) ?? null;
}

export function getTrackSimilars(trackId: number): TrackSimilar[] {
  return getDb().prepare(`
    SELECT ts.id,
      CASE WHEN ts.track_id = ? THEN ts.track_id    ELSE ts.similar_track_id END AS track_id,
      CASE WHEN ts.track_id = ? THEN ts.similar_track_id ELSE ts.track_id    END AS similar_track_id,
      t.name AS similar_name,
      ts.similarity_weight, ts.notes
    FROM track_similars ts
    JOIN tracks t ON t.id = (CASE WHEN ts.track_id = ? THEN ts.similar_track_id ELSE ts.track_id END)
    WHERE ts.track_id = ? OR ts.similar_track_id = ?
    ORDER BY ts.similarity_weight DESC
  `).all(trackId, trackId, trackId, trackId, trackId) as TrackSimilar[];
}

export function createTrack(data: { name: string; location?: string; surface_type?: string; track_length?: number; banking_angle?: number; clay_type?: string; avg_caution_rate?: number; track_family?: string; notes?: string }): number {
  const r = getDb().prepare(`INSERT INTO tracks (name, location, surface_type, track_length, banking_angle, clay_type, avg_caution_rate, track_family, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.name, data.location ?? null, data.surface_type ?? "Clay", data.track_length ?? null, data.banking_angle ?? null, data.clay_type ?? null, data.avg_caution_rate ?? null, data.track_family ?? null, data.notes ?? null);
  return r.lastInsertRowid as number;
}

export function updateTrack(id: number, data: { name?: string; location?: string; surface_type?: string; track_length?: number | null; banking_angle?: number | null; clay_type?: string | null; avg_caution_rate?: number | null; track_family?: string | null; notes?: string | null }): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (data.name !== undefined)             { sets.push("name = ?");             vals.push(data.name); }
  if (data.location !== undefined)         { sets.push("location = ?");         vals.push(data.location ?? null); }
  if (data.surface_type !== undefined)     { sets.push("surface_type = ?");     vals.push(data.surface_type); }
  if (data.track_length !== undefined)     { sets.push("track_length = ?");     vals.push(data.track_length); }
  if (data.banking_angle !== undefined)    { sets.push("banking_angle = ?");    vals.push(data.banking_angle); }
  if (data.clay_type !== undefined)        { sets.push("clay_type = ?");        vals.push(data.clay_type); }
  if (data.avg_caution_rate !== undefined) { sets.push("avg_caution_rate = ?"); vals.push(data.avg_caution_rate); }
  if (data.track_family !== undefined)     { sets.push("track_family = ?");     vals.push(data.track_family); }
  if (data.notes !== undefined)            { sets.push("notes = ?");            vals.push(data.notes); }
  if (sets.length === 0) return;
  db.prepare(`UPDATE tracks SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function upsertTrackSimilar(trackId: number, similarTrackId: number, weight: number, notes?: string): void {
  const db = getDb();
  // Always store with the lower id first so the UNIQUE constraint fires correctly
  const [a, b] = trackId < similarTrackId ? [trackId, similarTrackId] : [similarTrackId, trackId];
  db.prepare(`
    INSERT INTO track_similars (track_id, similar_track_id, similarity_weight, notes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(track_id, similar_track_id) DO UPDATE SET similarity_weight = excluded.similarity_weight, notes = excluded.notes
  `).run(a, b, weight, notes ?? null);
}

export function removeTrackSimilar(trackId: number, similarTrackId: number): void {
  const [a, b] = trackId < similarTrackId ? [trackId, similarTrackId] : [similarTrackId, trackId];
  getDb().prepare("DELETE FROM track_similars WHERE track_id = ? AND similar_track_id = ?").run(a, b);
}
