import "server-only";

import { getDb } from "@/lib/db";

export type RaceContextAdjustment = {
  id: number;
  race_id: number;
  driver_id: number | null;
  driver_name: string | null;
  context_type: string;
  label: string;
  score_delta: number;
  note: string | null;
  source_url: string | null;
  active: number;
  created_at: string;
  resolved_at: string | null;
};

export function listRaceContextAdjustments(raceId: number): RaceContextAdjustment[] {
  return getDb()
    .prepare(
      `SELECT rca.*, d.name AS driver_name
       FROM race_context_adjustments rca
       LEFT JOIN drivers d ON d.id = rca.driver_id
       WHERE rca.race_id = ? AND rca.active = 1
       ORDER BY
         CASE WHEN rca.driver_id IS NULL THEN 1 ELSE 0 END,
         ABS(rca.score_delta) DESC,
         rca.created_at DESC`
    )
    .all(raceId) as RaceContextAdjustment[];
}

export function getRaceContextAdjustmentMap(raceId: number) {
  const adjustments = listRaceContextAdjustments(raceId);
  const byDriver = new Map<number, RaceContextAdjustment[]>();
  const raceWide: RaceContextAdjustment[] = [];

  for (const adjustment of adjustments) {
    if (adjustment.driver_id === null) {
      raceWide.push(adjustment);
      continue;
    }

    const existing = byDriver.get(adjustment.driver_id) ?? [];
    existing.push(adjustment);
    byDriver.set(adjustment.driver_id, existing);
  }

  return { adjustments, byDriver, raceWide };
}

export function createRaceContextAdjustment(data: {
  raceId: number;
  driverId?: number | null;
  contextType: string;
  label: string;
  scoreDelta: number;
  note?: string | null;
  sourceUrl?: string | null;
}) {
  const label = data.label.trim();
  if (!label) throw new Error("Context label is required.");
  if (!Number.isFinite(data.scoreDelta) || data.scoreDelta < -0.15 || data.scoreDelta > 0.15) {
    throw new Error("Score delta must be between -0.15 and +0.15.");
  }

  getDb()
    .prepare(
      `INSERT INTO race_context_adjustments
        (race_id, driver_id, context_type, label, score_delta, note, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.raceId,
      data.driverId ?? null,
      data.contextType.trim() || "driving_style",
      label,
      data.scoreDelta,
      data.note?.trim() || null,
      data.sourceUrl?.trim() || null
    );
}

export function resolveRaceContextAdjustment(adjustmentId: number) {
  getDb()
    .prepare(
      `UPDATE race_context_adjustments
       SET active = 0, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .run(adjustmentId);
}
