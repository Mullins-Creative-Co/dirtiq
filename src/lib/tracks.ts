import "server-only";
import { getDb } from "@/lib/db";

export type Track = {
  id: number; name: string; location: string | null;
  surface_type: string; track_length: number | null; notes: string | null; created_at: string;
};

export function listTracks(): Track[] {
  return getDb().prepare("SELECT * FROM tracks ORDER BY name ASC").all() as Track[];
}

export function getTrack(id: number): Track | null {
  return (getDb().prepare("SELECT * FROM tracks WHERE id = ?").get(id) as Track) ?? null;
}

export function createTrack(data: { name: string; location?: string; surface_type?: string; track_length?: number; notes?: string }): number {
  const r = getDb().prepare(`INSERT INTO tracks (name, location, surface_type, track_length, notes) VALUES (?, ?, ?, ?, ?)`)
    .run(data.name, data.location ?? null, data.surface_type ?? "Clay", data.track_length ?? null, data.notes ?? null);
  return r.lastInsertRowid as number;
}
