import "server-only";

import { getDb } from "@/lib/db";

export type UnderwritingNote = {
  id: number;
  race_id: number | null;
  track_id: number | null;
  driver_id: number | null;
  driver_name: string | null;
  note_type: string;
  title: string;
  note: string;
  source_url: string | null;
  active: number;
  created_at: string;
  resolved_at: string | null;
};

export function listUnderwritingNotesForRace(raceId: number, trackId: number): UnderwritingNote[] {
  return getDb()
    .prepare(
      `SELECT un.*, d.name AS driver_name
       FROM underwriting_notes un
       LEFT JOIN drivers d ON d.id = un.driver_id
       WHERE un.active = 1
         AND (
           un.race_id = ?
           OR (un.race_id IS NULL AND un.track_id = ?)
         )
       ORDER BY
         CASE WHEN un.race_id = ? THEN 0 ELSE 1 END,
         un.created_at DESC`
    )
    .all(raceId, trackId, raceId) as UnderwritingNote[];
}

export function createUnderwritingNote(data: {
  raceId?: number | null;
  trackId?: number | null;
  driverId?: number | null;
  noteType?: string | null;
  title: string;
  note: string;
  sourceUrl?: string | null;
}) {
  const title = data.title.trim();
  const note = data.note.trim();
  if (!title) throw new Error("Note title is required.");
  if (!note) throw new Error("Note body is required.");
  if (!data.raceId && !data.trackId && !data.driverId) {
    throw new Error("Save the note to a race, track, or driver.");
  }

  getDb()
    .prepare(
      `INSERT INTO underwriting_notes
        (race_id, track_id, driver_id, note_type, title, note, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.raceId ?? null,
      data.trackId ?? null,
      data.driverId ?? null,
      data.noteType?.trim() || "underwriting",
      title,
      note,
      data.sourceUrl?.trim() || null
    );
}

export function resolveUnderwritingNote(noteId: number) {
  getDb()
    .prepare(
      `UPDATE underwriting_notes
       SET active = 0, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .run(noteId);
}
