import "server-only";

import { getDb } from "@/lib/db";
import type { ModelMissReason, ModelRaceReview } from "@/lib/model-race-review-options";

type ModelRaceReviewRow = {
  race_id: unknown;
  miss_reason: unknown;
  quick_time_mattered: unknown;
  starting_position_mattered: unknown;
  local_track_history_mattered: unknown;
  should_be_feature: unknown;
  confidence: unknown;
  notes: unknown;
  updated_at: unknown;
};

function toModelRaceReview(row: ModelRaceReviewRow): ModelRaceReview {
  return {
    race_id: Number(row.race_id),
    miss_reason: String(row.miss_reason) as ModelMissReason,
    quick_time_mattered: Number(row.quick_time_mattered),
    starting_position_mattered: Number(row.starting_position_mattered),
    local_track_history_mattered: Number(row.local_track_history_mattered),
    should_be_feature: Number(row.should_be_feature),
    confidence: Number(row.confidence),
    notes: row.notes === null || row.notes === undefined ? null : String(row.notes),
    updated_at: String(row.updated_at),
  };
}

export function ensureModelRaceReviewsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS model_race_reviews (
      race_id INTEGER PRIMARY KEY REFERENCES races(id) ON DELETE CASCADE,
      miss_reason TEXT NOT NULL DEFAULT 'needs_feature_review',
      quick_time_mattered INTEGER NOT NULL DEFAULT 0,
      starting_position_mattered INTEGER NOT NULL DEFAULT 0,
      local_track_history_mattered INTEGER NOT NULL DEFAULT 0,
      should_be_feature INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.5,
      notes TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

export function getModelRaceReviewMap(raceIds: number[]) {
  ensureModelRaceReviewsTable();
  if (raceIds.length === 0) return new Map<number, ModelRaceReview>();
  const placeholders = raceIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM model_race_reviews WHERE race_id IN (${placeholders})`)
    .all(...raceIds) as ModelRaceReviewRow[];

  return new Map(rows.map((row) => {
    const review = toModelRaceReview(row);
    return [review.race_id, review];
  }));
}

export function upsertModelRaceReview(data: {
  race_id: number;
  miss_reason: ModelMissReason;
  quick_time_mattered: boolean;
  starting_position_mattered: boolean;
  local_track_history_mattered: boolean;
  should_be_feature: boolean;
  confidence: number;
  notes?: string | null;
}) {
  ensureModelRaceReviewsTable();
  getDb()
    .prepare(
      `INSERT INTO model_race_reviews (
         race_id,
         miss_reason,
         quick_time_mattered,
         starting_position_mattered,
         local_track_history_mattered,
         should_be_feature,
         confidence,
         notes,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(race_id) DO UPDATE SET
         miss_reason = excluded.miss_reason,
         quick_time_mattered = excluded.quick_time_mattered,
         starting_position_mattered = excluded.starting_position_mattered,
         local_track_history_mattered = excluded.local_track_history_mattered,
         should_be_feature = excluded.should_be_feature,
         confidence = excluded.confidence,
         notes = excluded.notes,
         updated_at = excluded.updated_at`
    )
    .run(
      data.race_id,
      data.miss_reason,
      data.quick_time_mattered ? 1 : 0,
      data.starting_position_mattered ? 1 : 0,
      data.local_track_history_mattered ? 1 : 0,
      data.should_be_feature ? 1 : 0,
      data.confidence,
      data.notes?.trim() || null
    );
}
