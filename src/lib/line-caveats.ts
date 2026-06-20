import "server-only";

import { getDb } from "@/lib/db";

export type LineCaveatSeverity = "watch" | "caution" | "hold" | "scratch";

export type LineCaveat = {
  id: number;
  race_id: number;
  driver_id: number | null;
  driver_name: string | null;
  caveat_type: string;
  severity: LineCaveatSeverity;
  probability_multiplier: number;
  note: string;
  source_url: string | null;
  active: number;
  created_at: string;
  resolved_at: string | null;
};

export function listActiveLineCaveats(raceId: number): LineCaveat[] {
  return getDb()
    .prepare(
      `SELECT lc.*, d.name AS driver_name
       FROM line_caveats lc
       LEFT JOIN drivers d ON d.id = lc.driver_id
       WHERE lc.race_id = ? AND lc.active = 1
       ORDER BY
         CASE lc.severity
           WHEN 'scratch' THEN 0
           WHEN 'hold' THEN 1
           WHEN 'caution' THEN 2
           ELSE 3
         END,
         lc.created_at DESC`
    )
    .all(raceId) as LineCaveat[];
}

export function getLineCaveatMap(raceId: number) {
  const caveats = listActiveLineCaveats(raceId);
  const byDriver = new Map<number, LineCaveat[]>();
  const raceWide: LineCaveat[] = [];

  for (const caveat of caveats) {
    if (caveat.driver_id === null) {
      raceWide.push(caveat);
      continue;
    }

    const existing = byDriver.get(caveat.driver_id) ?? [];
    existing.push(caveat);
    byDriver.set(caveat.driver_id, existing);
  }

  return { caveats, byDriver, raceWide };
}

export function createLineCaveat(data: {
  raceId: number;
  driverId: number | null;
  caveatType: string;
  severity: LineCaveatSeverity;
  probabilityMultiplier: number;
  note: string;
  sourceUrl?: string | null;
}) {
  const note = data.note.trim() || `${data.caveatType.replaceAll("_", " ")} caveat added from race underwriting.`;
  if (!Number.isFinite(data.probabilityMultiplier) || data.probabilityMultiplier < 0 || data.probabilityMultiplier > 1.5) {
    throw new Error("Probability multiplier must be between 0 and 1.5.");
  }

  const duplicate = getDb()
    .prepare(
      `SELECT lc.id, lc.note, d.name AS driver_name
       FROM line_caveats lc
       LEFT JOIN drivers d ON d.id = lc.driver_id
       WHERE lc.race_id = ?
         AND lc.driver_id IS ?
         AND lc.caveat_type = ?
         AND lc.active = 1
       LIMIT 1`
    )
    .get(data.raceId, data.driverId, data.caveatType) as
      | { id: number; note: string; driver_name: string | null }
      | undefined;

  if (duplicate) {
    throw new Error(
      `Duplicate active caveat already exists for ${duplicate.driver_name ?? "race-wide"}: ${duplicate.note}`
    );
  }

  getDb()
    .prepare(
      `INSERT INTO line_caveats
        (race_id, driver_id, caveat_type, severity, probability_multiplier, note, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.raceId,
      data.driverId,
      data.caveatType,
      data.severity,
      data.probabilityMultiplier,
      note,
      data.sourceUrl?.trim() || null
    );
}

export function resolveLineCaveat(caveatId: number) {
  getDb()
    .prepare(
      `UPDATE line_caveats
       SET active = 0, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .run(caveatId);
}
