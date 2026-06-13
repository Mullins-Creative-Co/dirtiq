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
  trackWinRate: number | null;      // win % at this exact track
  trackStarts: number;
  similarTrackWinRate: number | null; // win % at similar tracks
  similarTrackStarts: number;
  seasonWinRate: number | null;     // 2026 WoO win %
  seasonStarts: number;
  quickTimeRate: number | null;     // quick times / starts
  heatWinRate: number | null;       // heat wins / starts
  dnfRate: number | null;           // dnfs / starts — negative factor
  momentum: number;                 // last 5 race avg finish (lower = better, 0 if no data)
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
    FROM race_entries re
    JOIN drivers d ON d.id = re.driver_id
    WHERE re.race_id = ?
  `).all(raceId) as Array<{ driver_id: number; car_number: string | null; name: string }>;

  if (entries.length === 0) return [];

  // Similar tracks for this track
  const similars = db.prepare(`
    SELECT similar_track_id, similarity_weight FROM track_similars WHERE track_id = ?
  `).all(trackId) as Array<{ similar_track_id: number; similarity_weight: number }>;

  const results: DriverOdds[] = [];

  for (const entry of entries) {
    const dId = entry.driver_id;

    // --- Track history (exact) ---
    const trackHistory = db.prepare(`
      SELECT COUNT(*) as starts,
             SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN dnf = 1 THEN 1 ELSE 0 END) as dnfs
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      WHERE re.driver_id = ? AND r.track_id = ? AND r.status = 'complete' AND re.race_id != ?
    `).get(dId, trackId, raceId) as { starts: number; wins: number; dnfs: number };

    // --- Similar track history ---
    let simStarts = 0, simWins = 0;
    for (const sim of similars) {
      const sh = db.prepare(`
        SELECT COUNT(*) as starts,
               SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) as wins
        FROM race_entries re
        JOIN races r ON r.id = re.race_id
        WHERE re.driver_id = ? AND r.track_id = ? AND r.status = 'complete'
      `).get(dId, sim.similar_track_id) as { starts: number; wins: number };
      simStarts += sh.starts * sim.similarity_weight;
      simWins += sh.wins * sim.similarity_weight;
    }

    // --- Season stats (current year priority, fallback last year) ---
    const seasonStats = db.prepare(`
      SELECT * FROM driver_season_stats
      WHERE driver_id = ? AND series = 'WoO Late Models'
      ORDER BY season DESC LIMIT 1
    `).get(dId) as {
      starts: number; wins: number; quick_times: number; heat_wins: number;
      dnfs: number; top5: number; season: number;
    } | undefined;

    // --- Recent form (last 5 results) ---
    const recent = db.prepare(`
      SELECT finishing_position, dnf FROM race_entries
      WHERE driver_id = ? AND finishing_position IS NOT NULL
      ORDER BY race_id DESC LIMIT 5
    `).all(dId) as Array<{ finishing_position: number; dnf: number }>;

    const highlights: string[] = [];
    const warnings: string[] = [];

    // --- Compute component scores ---
    let score = 0;

    // 1. Track-specific history (weight 0.35 if available, 0.20 if thin)
    const trackWR = trackHistory.starts >= 1 ? trackHistory.wins / trackHistory.starts : null;
    const trackWeight = trackHistory.starts >= 3 ? 0.35 : trackHistory.starts >= 1 ? 0.15 : 0;
    if (trackWR !== null) {
      score += trackWR * trackWeight;
      if (trackWR > 0.25) highlights.push(`${Math.round(trackWR * 100)}% win rate at this track (${trackHistory.wins}/${trackHistory.starts})`);
    }

    // 2. Similar-track history (weight 0.25 if available)
    const simWR = simStarts >= 1 ? simWins / simStarts : null;
    const simWeight = simStarts >= 1 ? 0.25 : 0;
    if (simWR !== null) {
      score += simWR * simWeight;
      if (simWR > 0.2) highlights.push(`${Math.round(simWR * 100)}% win rate at similar tracks`);
    }

    // 3. Season win % (weight 0.20)
    const seasonWR = seasonStats && seasonStats.starts > 0 ? seasonStats.wins / seasonStats.starts : null;
    if (seasonWR !== null) {
      score += seasonWR * 0.20;
      if (seasonWR > 0.25) highlights.push(`${Math.round(seasonWR * 100)}% season win rate in ${seasonStats!.season} (${seasonStats!.wins}W)`);
    }

    // 4. Quick time rate (weight 0.10) — strong predictor of overall speed
    const qtRate = seasonStats && seasonStats.starts > 0 ? seasonStats.quick_times / seasonStats.starts : null;
    if (qtRate !== null) {
      score += qtRate * 0.10;
      if (qtRate > 0.20) highlights.push(`Fast qualifier — quick time ${Math.round(qtRate * 100)}% of events`);
    }

    // 5. Heat win rate (weight 0.10)
    const heatWR = seasonStats && seasonStats.starts > 0 ? seasonStats.heat_wins / seasonStats.starts : null;
    if (heatWR !== null) {
      score += heatWR * 0.10;
    }

    // 6. DNF risk (negative factor, weight -0.15)
    const allDnfs = (trackHistory.dnfs || 0) + (seasonStats?.dnfs || 0);
    const allStarts = (trackHistory.starts || 0) + (seasonStats?.starts || 0);
    const dnfRate = allStarts > 0 ? allDnfs / allStarts : null;
    if (dnfRate !== null && dnfRate > 0.15) {
      score -= dnfRate * 0.15;
      warnings.push(`High DNF rate — ${Math.round(dnfRate * 100)}% across recent history`);
    }

    // 7. Momentum — recent avg finish (normalize: 1st = 1.0, last = 0.0)
    let momentum = 0;
    if (recent.length > 0) {
      const fieldSize = entries.length;
      const avgPos = recent.reduce((s, r) => s + (r.dnf ? fieldSize : r.finishing_position), 0) / recent.length;
      momentum = Math.max(0, (fieldSize - avgPos) / fieldSize);
      score += momentum * 0.10;
      if (avgPos <= 3 && recent.length >= 3) highlights.push(`Hot streak — avg finish ${avgPos.toFixed(1)} over last ${recent.length} races`);
      if (recent[0]?.dnf) warnings.push("DNF in most recent race");
    }

    // Fallback: if zero signal, give a tiny base probability
    if (score === 0) score = 0.01;

    const reasoning: ReasoningFactors = {
      trackWinRate: trackWR,
      trackStarts: trackHistory.starts,
      similarTrackWinRate: simWR,
      similarTrackStarts: Math.round(simStarts),
      seasonWinRate: seasonWR,
      seasonStarts: seasonStats?.starts ?? 0,
      quickTimeRate: qtRate,
      heatWinRate: heatWR,
      dnfRate,
      momentum,
      compositeScore: score,
      highlights,
      warnings,
    };

    results.push({
      driverId: dId,
      driverName: entry.name,
      carNumber: entry.car_number,
      americanOdds: "",
      impliedProbability: score,
      rawScore: score,
      reasoning,
    });
  }

  // Normalize + vig
  const probs = results.map((r) => r.rawScore);
  const viggedProbs = applyVig(probs);

  return results
    .map((r, i) => ({
      ...r,
      impliedProbability: viggedProbs[i],
      americanOdds: americanOddsStr(viggedProbs[i]),
    }))
    .sort((a, b) => b.impliedProbability - a.impliedProbability);
}
