import "server-only";
import { getDb } from "./db";

export interface DriverOdds {
  driverId: number;
  driverName: string;
  carNumber: string | null;
  americanOdds: string;
  impliedProbability: number;
  rawScore: number;
  reasoning: ReasoningFactors;
}

export interface ReasoningFactors {
  trackWinRate: number | null;
  trackStarts: number;
  similarTrackWinRate: number | null;
  similarTrackStarts: number;
  seasonWinRate: number | null;
  seasonStarts: number;
  quickTimeRate: number | null;
  heatWinRate: number | null;
  avgFinish: number | null;
  last5AvgFinish: number | null;
  dnfRate: number | null;
  compositeScore: number;
  highlights: string[];
  warnings: string[];
}

function americanOddsStr(p: number): string {
  if (p >= 1) return "-∞";
  if (p <= 0) return "+∞";
  const odds = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  return odds < 0 ? Math.round(odds).toString() : `+${Math.round(odds)}`;
}

function applyVig(probs: number[], vig = 0.12): number[] {
  const total = probs.reduce((a, b) => a + b, 0);
  if (total === 0) return probs.map(() => 1 / probs.length);
  const vigged = probs.map((p) => (p / total) * (1 + vig));
  const vigTotal = vigged.reduce((a, b) => a + b, 0);
  return vigged.map((p) => p / vigTotal);
}

export function calculateRaceOdds(raceId: number, trackId: number): DriverOdds[] {
  const db = getDb();

  const entries = db.prepare(`
    SELECT re.driver_id, re.car_number, d.name
    FROM race_entries re JOIN drivers d ON d.id = re.driver_id
    WHERE re.race_id = ?
  `).all(raceId) as Array<{ driver_id: number; car_number: string | null; name: string }>;

  if (entries.length === 0) return [];

  const fieldSize = entries.length;

  const similars = db.prepare(
    `SELECT similar_track_id, similarity_weight FROM track_similars WHERE track_id = ?`
  ).all(trackId) as Array<{ similar_track_id: number; similarity_weight: number }>;

  const results: DriverOdds[] = [];

  for (const entry of entries) {
    const dId = entry.driver_id;

    // ── Exact track history ────────────────────────────────────────────────────
    const th = db.prepare(`
      SELECT COUNT(*) as starts,
             SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN dnf = 1 THEN 1 ELSE 0 END) as dnfs
      FROM race_entries re JOIN races r ON r.id = re.race_id
      WHERE re.driver_id = ? AND r.track_id = ? AND r.status = 'complete' AND re.race_id != ?
    `).get(dId, trackId, raceId) as { starts: number; wins: number; dnfs: number };

    // ── Similar-track history ──────────────────────────────────────────────────
    let simStarts = 0, simWins = 0;
    for (const sim of similars) {
      const sh = db.prepare(`
        SELECT COUNT(*) as starts,
               SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) as wins
        FROM race_entries re JOIN races r ON r.id = re.race_id
        WHERE re.driver_id = ? AND r.track_id = ? AND r.status = 'complete'
      `).get(dId, sim.similar_track_id) as { starts: number; wins: number };
      simStarts += sh.starts * sim.similarity_weight;
      simWins += sh.wins * sim.similarity_weight;
    }

    // ── Season stats — current year first, fall back to prior year ─────────────
    const seasonStats = db.prepare(`
      SELECT * FROM driver_season_stats
      WHERE driver_id = ? AND series = 'WoO Late Models'
      ORDER BY season DESC LIMIT 1
    `).get(dId) as {
      starts: number; wins: number; quick_times: number; heat_wins: number;
      dnfs: number; top5: number; avg_finish: number | null;
      last5_avg_finish: number | null; season: number;
    } | undefined;

    const highlights: string[] = [];
    const warnings: string[] = [];
    let score = 0;

    // ── 1. Track history (weight 0.30 if ≥3 starts, 0.15 if 1–2) ─────────────
    const trackWR = th.starts >= 1 ? th.wins / th.starts : null;
    const trackWeight = th.starts >= 3 ? 0.30 : th.starts >= 1 ? 0.15 : 0;
    if (trackWR !== null) {
      score += trackWR * trackWeight;
      if (trackWR >= 0.5)
        highlights.push(`Won ${th.wins}/${th.starts} at this track`);
      else if (trackWR > 0)
        highlights.push(`${Math.round(trackWR * 100)}% win rate at this track (${th.wins}/${th.starts})`);
    }

    // ── 2. Similar-track history (weight 0.25) ─────────────────────────────────
    const simWR = simStarts >= 0.5 ? simWins / simStarts : null;
    const simWeight = simStarts >= 0.5 ? 0.25 : 0;
    if (simWR !== null) {
      score += simWR * simWeight;
      if (simWR > 0.2)
        highlights.push(`${Math.round(simWR * 100)}% win rate at similar-surface tracks`);
    }

    // ── 3. Season win rate (weight 0.18) ──────────────────────────────────────
    const seasonWR = seasonStats && seasonStats.starts > 0
      ? seasonStats.wins / seasonStats.starts
      : null;
    if (seasonWR !== null) {
      score += seasonWR * 0.18;
      if (seasonWR >= 0.25)
        highlights.push(`${Math.round(seasonWR * 100)}% season win rate — ${seasonStats!.wins} wins in ${seasonStats!.season}`);
    }

    // ── 4. Average finish score (weight 0.12) — lower avg = better ────────────
    // Normalise: finish 1 → 1.0, finish fieldSize → 0.0
    const avgFinish = seasonStats?.avg_finish ?? null;
    const avgFinishScore = avgFinish !== null
      ? Math.max(0, (fieldSize - avgFinish) / fieldSize)
      : null;
    if (avgFinishScore !== null) {
      score += avgFinishScore * 0.12;
      if (avgFinish !== null && avgFinish <= 5)
        highlights.push(`${avgFinish.toFixed(1)} average feature finish in ${seasonStats!.season}`);
    }

    // ── 5. Quick time rate (weight 0.09) ──────────────────────────────────────
    const qtRate = seasonStats && seasonStats.starts > 0
      ? seasonStats.quick_times / seasonStats.starts
      : null;
    if (qtRate !== null) {
      score += qtRate * 0.09;
      if (qtRate >= 0.20)
        highlights.push(`Fast qualifier — quick time ${Math.round(qtRate * 100)}% of events`);
    }

    // ── 6. Heat win rate (weight 0.08) ────────────────────────────────────────
    const heatWR = seasonStats && seasonStats.starts > 0
      ? seasonStats.heat_wins / seasonStats.starts
      : null;
    if (heatWR !== null) {
      score += heatWR * 0.08;
      if (heatWR >= 0.4)
        highlights.push(`Dominant in heats — ${Math.round(heatWR * 100)}% heat win rate`);
    }

    // ── 7. Who's hot — last 5 avg finish (weight 0.12, bonus/penalty) ─────────
    const last5 = seasonStats?.last5_avg_finish ?? null;
    const last5Score = last5 !== null
      ? Math.max(0, (fieldSize - last5) / fieldSize)
      : null;
    if (last5Score !== null) {
      score += last5Score * 0.12;
      if (last5 !== null && last5 <= 4.5)
        highlights.push(`On fire — ${last5.toFixed(1)} avg finish in last 5 races`);
      else if (last5 !== null && last5 >= 14)
        warnings.push(`Cold streak — ${last5.toFixed(1)} avg finish in last 5 races`);
    }

    // ── 8. DNF risk (weight -0.12, only if rate elevated) ────────────────────
    const allDnfs  = (th.dnfs || 0) + (seasonStats?.dnfs || 0);
    const allStarts = (th.starts || 0) + (seasonStats?.starts || 0);
    const dnfRate = allStarts > 0 ? allDnfs / allStarts : null;
    if (dnfRate !== null && dnfRate > 0.12) {
      score -= dnfRate * 0.12;
      warnings.push(`Elevated DNF rate — ${Math.round(dnfRate * 100)}%`);
    }

    if (score <= 0) score = 0.005;

    results.push({
      driverId: dId,
      driverName: entry.name,
      carNumber: entry.car_number,
      americanOdds: "",
      impliedProbability: score,
      rawScore: score,
      reasoning: {
        trackWinRate: trackWR,
        trackStarts: th.starts,
        similarTrackWinRate: simWR,
        similarTrackStarts: Math.round(simStarts),
        seasonWinRate: seasonWR,
        seasonStarts: seasonStats?.starts ?? 0,
        quickTimeRate: qtRate,
        heatWinRate: heatWR,
        avgFinish,
        last5AvgFinish: last5,
        dnfRate,
        compositeScore: score,
        highlights,
        warnings,
      },
    });
  }

  const viggedProbs = applyVig(results.map((r) => r.rawScore));

  return results
    .map((r, i) => ({
      ...r,
      impliedProbability: viggedProbs[i],
      americanOdds: americanOddsStr(viggedProbs[i]),
    }))
    .sort((a, b) => b.impliedProbability - a.impliedProbability);
}
