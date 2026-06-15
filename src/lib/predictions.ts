import "server-only";
import { getDb } from "./db";
import type { DriverOdds } from "./odds";

export type StoredPrediction = {
  driver_id: number;
  driver_name: string;
  predicted_rank: number;
  implied_probability: number;
  american_odds: string;
  raw_score: number;
  elo_rating: number;
  track_win_rate: number | null;
  track_starts: number | null;
  similar_track_win_rate: number | null;
  season_win_rate: number | null;
  last5_avg_finish: number | null;
  streak: number | null;
  tonight_heat_pos: number | null;
  tonight_qt_rank: number | null;
  starting_position: number | null;
  starting_pos_win_rate: number | null;
  feature_plus_minus: number | null;
  condition_win_rate: number | null;
  specialty_bonus: number | null;
  locked_at: string;
};

export type ScorecardRow = {
  driver_id: number;
  driver_name: string;
  car_number: string | null;
  actual_pos: number | null;
  starting_position: number | null;
  plus_minus: number | null;
  laps_led: number;
  margin: string | null;
  money: number | null;
  dnf: number;
  // model side
  predicted_rank: number | null;
  rank_delta: number | null;       // predicted_rank - actual_pos (negative = model underrated, positive = overrated)
  implied_probability: number | null;
  american_odds: string | null;
  // key factors at lock time
  track_win_rate: number | null;
  track_starts: number | null;
  season_win_rate: number | null;
  last5_avg_finish: number | null;
  tonight_heat_pos: number | null;
  starting_pos_win_rate: number | null;
  feature_plus_minus: number | null;
  specialty_bonus: number | null;
};

export type ScorecardSummary = {
  spearman: number | null;   // rank correlation between predicted and actual
  top1_hit: boolean | null;  // did model's #1 pick win?
  top3_hit: number | null;   // how many of model's top-3 finished in actual top-3?
  avg_rank_error: number | null;
  locked_at: string | null;
  had_prelim_data: boolean;  // whether heats/QT were entered before lock
  field_size: number;
};

// Snapshot the current model output for a race — called when race goes live.
// Uses INSERT OR IGNORE so re-triggering go-live never overwrites the original lock.
export function lockPredictions(raceId: number, odds: DriverOdds[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO race_predictions
      (race_id, driver_id, predicted_rank, implied_probability, american_odds, raw_score, elo_rating,
       track_win_rate, track_starts, similar_track_win_rate, season_win_rate, last5_avg_finish,
       streak, tonight_heat_pos, tonight_qt_rank, starting_position, starting_pos_win_rate,
       feature_plus_minus, condition_win_rate, specialty_bonus)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  odds.forEach((d, i) => {
    const r = d.reasoning;
    stmt.run(
      raceId, d.driverId, i + 1, d.impliedProbability, d.americanOdds, d.rawScore, d.eloRating,
      r.trackWinRate, r.trackStarts, r.similarTrackWinRate, r.seasonWinRate, r.last5AvgFinish,
      r.streak, r.tonightHeatPos, r.tonightQtRank, r.startingPosition, r.startingPosWinRate,
      r.featurePlusMinus, r.conditionWinRate, r.specialtyBonus
    );
  });
}

export function getPredictions(raceId: number): StoredPrediction[] {
  return getDb().prepare(`
    SELECT p.*, d.name AS driver_name
    FROM race_predictions p
    JOIN drivers d ON d.id = p.driver_id
    WHERE p.race_id = ?
    ORDER BY p.predicted_rank ASC
  `).all(raceId) as StoredPrediction[];
}

export function hasPredictions(raceId: number): boolean {
  const row = getDb().prepare(
    `SELECT COUNT(*) AS n FROM race_predictions WHERE race_id = ?`
  ).get(raceId) as { n: number };
  return row.n > 0;
}

export function getScorecardData(raceId: number): { rows: ScorecardRow[]; summary: ScorecardSummary } {
  const db = getDb();

  // Actual results
  const actuals = db.prepare(`
    SELECT e.driver_id, d.name AS driver_name, e.car_number,
           e.finishing_position, e.starting_position, e.laps_led,
           e.margin, e.money, e.dnf
    FROM race_entries e JOIN drivers d ON d.id = e.driver_id
    WHERE e.race_id = ?
    ORDER BY COALESCE(e.finishing_position, 999)
  `).all(raceId) as Array<{
    driver_id: number; driver_name: string; car_number: string | null;
    finishing_position: number | null; starting_position: number | null;
    laps_led: number; margin: string | null; money: number | null; dnf: number;
  }>;

  // Model predictions
  const preds = getPredictions(raceId);
  const predMap = new Map(preds.map((p) => [p.driver_id, p]));

  const lockedAt = preds[0]?.locked_at ?? null;
  const hadPrelimData = preds.some((p) => p.tonight_heat_pos !== null || p.tonight_qt_rank !== null);

  const rows: ScorecardRow[] = actuals.map((a) => {
    const p = predMap.get(a.driver_id);
    const plusMinus =
      a.starting_position !== null && a.finishing_position !== null && !a.dnf
        ? a.starting_position - a.finishing_position
        : null;
    const rankDelta =
      p && a.finishing_position !== null && !a.dnf
        ? p.predicted_rank - a.finishing_position
        : null;
    return {
      driver_id: a.driver_id,
      driver_name: a.driver_name,
      car_number: a.car_number,
      actual_pos: a.finishing_position,
      starting_position: a.starting_position,
      plus_minus: plusMinus,
      laps_led: a.laps_led,
      margin: a.margin,
      money: a.money,
      dnf: a.dnf,
      predicted_rank: p?.predicted_rank ?? null,
      rank_delta: rankDelta,
      implied_probability: p?.implied_probability ?? null,
      american_odds: p?.american_odds ?? null,
      track_win_rate: p?.track_win_rate ?? null,
      track_starts: p?.track_starts ?? null,
      season_win_rate: p?.season_win_rate ?? null,
      last5_avg_finish: p?.last5_avg_finish ?? null,
      tonight_heat_pos: p?.tonight_heat_pos ?? null,
      starting_pos_win_rate: p?.starting_pos_win_rate ?? null,
      feature_plus_minus: p?.feature_plus_minus ?? null,
      specialty_bonus: p?.specialty_bonus ?? null,
    };
  });

  // Summary stats
  const ranked = rows.filter((r) => r.actual_pos !== null && !r.dnf && r.predicted_rank !== null);
  const n = ranked.length;

  let spearman: number | null = null;
  if (n >= 3) {
    const sumD2 = ranked.reduce((sum, r) => sum + Math.pow((r.predicted_rank ?? 0) - (r.actual_pos ?? 0), 2), 0);
    spearman = 1 - (6 * sumD2) / (n * (n * n - 1));
  }

  const top1 = rows.find((r) => r.actual_pos === 1);
  const top1Hit = top1 ? top1.predicted_rank === 1 : null;

  const actualTop3Ids = new Set(rows.filter((r) => r.actual_pos !== null && r.actual_pos <= 3 && !r.dnf).map((r) => r.driver_id));
  const predictedTop3 = rows.filter((r) => r.predicted_rank !== null && r.predicted_rank <= 3).map((r) => r.driver_id);
  const top3Hit = predictedTop3.filter((id) => actualTop3Ids.has(id)).length;

  const avgRankError = ranked.length > 0
    ? ranked.reduce((sum, r) => sum + Math.abs((r.predicted_rank ?? 0) - (r.actual_pos ?? 0)), 0) / ranked.length
    : null;

  return {
    rows,
    summary: {
      spearman,
      top1_hit: top1Hit,
      top3_hit: top3Hit,
      avg_rank_error: avgRankError,
      locked_at: lockedAt,
      had_prelim_data: hadPrelimData,
      field_size: actuals.length,
    },
  };
}
