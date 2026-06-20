import "server-only";

import { getDb } from "@/lib/db";

export type TrackDriverTrend = {
  id: number;
  track_id: number;
  driver_id: number | null;
  driver_name: string | null;
  trend_type: string;
  label: string;
  score_delta: number;
  note: string | null;
  source_url: string | null;
  active: number;
  created_at: string;
  resolved_at: string | null;
};

export function listTrackDriverTrends(trackId: number): TrackDriverTrend[] {
  return getDb()
    .prepare(
      `SELECT tdt.*, d.name AS driver_name
       FROM track_driver_trends tdt
       LEFT JOIN drivers d ON d.id = tdt.driver_id
       WHERE tdt.track_id = ? AND tdt.active = 1
       ORDER BY
         CASE WHEN tdt.driver_id IS NULL THEN 1 ELSE 0 END,
         ABS(tdt.score_delta) DESC,
         tdt.created_at DESC`
    )
    .all(trackId) as TrackDriverTrend[];
}

export function getTrackDriverTrendMap(trackId: number) {
  const trends = listTrackDriverTrends(trackId);
  const byDriver = new Map<number, TrackDriverTrend[]>();
  const trackWide: TrackDriverTrend[] = [];

  for (const trend of trends) {
    if (trend.driver_id === null) {
      trackWide.push(trend);
      continue;
    }

    const existing = byDriver.get(trend.driver_id) ?? [];
    existing.push(trend);
    byDriver.set(trend.driver_id, existing);
  }

  return { trends, byDriver, trackWide };
}

export function createTrackDriverTrend(data: {
  track_id: number;
  driver_id?: number | null;
  trend_type?: string;
  label: string;
  score_delta: number;
  note?: string | null;
  source_url?: string | null;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO track_driver_trends
        (track_id, driver_id, trend_type, label, score_delta, note, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.track_id,
      data.driver_id ?? null,
      data.trend_type ?? "track_history",
      data.label,
      data.score_delta,
      data.note ?? null,
      data.source_url ?? null
    );

  return result.lastInsertRowid as number;
}

export function resolveTrackDriverTrend(id: number): void {
  getDb()
    .prepare(
      `UPDATE track_driver_trends
       SET active = 0, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .run(id);
}
