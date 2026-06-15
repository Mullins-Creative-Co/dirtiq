import "server-only";
import { getDb } from "./db";
import { eloWinProbabilities, getDriverEloRatings } from "./elo";
import { getDriverSpecialtyBonus } from "./driver-specialties";

export interface DriverOdds {
  driverId: number;
  driverName: string;
  carNumber: string | null;
  americanOdds: string;
  impliedProbability: number;
  rawScore: number;
  eloRating: number;
  reasoning: ReasoningFactors;
}

export interface ReasoningFactors {
  // Track history
  trackWinRate: number | null;
  trackStarts: number;
  lastEventHere: number | null;        // finishing position last time at this track
  similarTrackWinRate: number | null;
  similarTrackStarts: number;
  // Season
  seasonWinRate: number | null;
  seasonStarts: number;
  avgFinish: number | null;
  last5AvgFinish: number | null;
  // Streak
  streak: number;                      // consecutive top-3 finishes
  streakType: "win" | "podium" | "top5" | "none";
  // Tonight's prelim (post-heats)
  tonightHeatPos: number | null;
  tonightQtRank: number | null;        // 1 = fastest tonight
  tonightQtRunners: number;
  // Tonight's starting position (once lineup is posted)
  startingPosition: number | null;
  startingPosWinRate: number | null;   // historical win rate from same bracket at this/similar tracks
  startingPosStarts: number;
  // Qualitative
  quickTimeRate: number | null;
  heatWinRate: number | null;
  distanceWinRate: number | null;      // win rate in same lap-distance bucket
  distanceStarts: number;
  dnfRate: number | null;
  featurePlusMinus: number | null;
  featurePmRaces: number;
  conditionWinRate: number | null;
  conditionStarts: number;
  specialtyBonus: number;
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

// Group starting positions into brackets for historical comparison
function startPosBracket(pos: number): { min: number; max: number; label: string } {
  if (pos <= 3)  return { min: 1,  max: 3,   label: "pole/front-3" };
  if (pos <= 6)  return { min: 4,  max: 6,   label: "rows 2-3" };
  if (pos <= 10) return { min: 7,  max: 10,  label: "rows 4-5" };
  if (pos <= 15) return { min: 11, max: 15,  label: "mid-pack" };
  return          { min: 16, max: 9999, label: "tail-end" };
}

// Map laps to a distance bucket label
function distanceBucket(laps: number): { min: number; max: number; label: string } {
  if (laps <= 40)  return { min: 1,   max: 40,  label: "sprint (≤40 laps)" };
  if (laps <= 70)  return { min: 41,  max: 70,  label: "standard (41–70 laps)" };
  if (laps <= 100) return { min: 71,  max: 100, label: "long (71–100 laps)" };
  return            { min: 101, max: 9999, label: "marathon (100+ laps)" };
}

// Count consecutive top-N finishes from most recent race
function computeStreak(recentResults: Array<{ finishing_position: number; dnf: number }>): {
  streak: number; streakType: "win" | "podium" | "top5" | "none";
} {
  if (!recentResults.length) return { streak: 0, streakType: "none" };

  // Find the longest run of top-3 or better from the front
  let streak = 0;
  for (const r of recentResults) {
    if (r.dnf || r.finishing_position > 5) break;
    streak++;
  }
  if (streak === 0) return { streak: 0, streakType: "none" };

  // Classify what the streak IS
  const allWins = recentResults.slice(0, streak).every((r) => r.finishing_position === 1);
  const allPodium = recentResults.slice(0, streak).every((r) => r.finishing_position <= 3);
  return {
    streak,
    streakType: allWins ? "win" : allPodium ? "podium" : "top5",
  };
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

  // Bidirectional — find all tracks that have a similarity relationship with this track
  const similars = db.prepare(`
    SELECT
      CASE WHEN track_id = ? THEN similar_track_id ELSE track_id END AS similar_track_id,
      similarity_weight
    FROM track_similars
    WHERE track_id = ? OR similar_track_id = ?
  `).all(trackId, trackId, trackId) as Array<{ similar_track_id: number; similarity_weight: number }>;

  const trackMeta = db.prepare(`SELECT track_family FROM tracks WHERE id = ?`)
    .get(trackId) as { track_family: string | null } | undefined;
  const trackFamily = trackMeta?.track_family ?? null;

  const raceInfo = db.prepare(`SELECT track_condition, distance FROM races WHERE id = ?`)
    .get(raceId) as { track_condition: string; distance: number | null } | undefined;
  const trackCondition = raceInfo?.track_condition ?? null;
  const raceLaps = raceInfo?.distance ?? 60;
  const bucket = distanceBucket(raceLaps);

  // ── Tonight's QT data — rank all drivers who ran qualifying times ─────────────
  const qtRows = db.prepare(`
    SELECT driver_id, qualifying_time FROM race_entries
    WHERE race_id = ? AND qualifying_time IS NOT NULL
    ORDER BY qualifying_time ASC
  `).all(raceId) as Array<{ driver_id: number; qualifying_time: number }>;
  const qtRankMap = new Map<number, number>();
  qtRows.forEach((r, i) => qtRankMap.set(r.driver_id, i + 1));
  const qtRunners = qtRows.length;

  // ── Check how many drivers have heat data (for Elo blend ratio) ──────────────
  const heatDataCount = (db.prepare(
    `SELECT COUNT(*) as n FROM race_entries WHERE race_id = ? AND heat_position IS NOT NULL`
  ).get(raceId) as { n: number }).n;
  const hasPrelimData = heatDataCount >= Math.ceil(fieldSize * 0.25);

  // ── Check if tonight's starting lineup has been posted ────────────────────────
  const lineupDataCount = (db.prepare(
    `SELECT COUNT(*) as n FROM race_entries WHERE race_id = ? AND starting_position IS NOT NULL`
  ).get(raceId) as { n: number }).n;
  const hasLineup = lineupDataCount >= Math.ceil(fieldSize * 0.25);

  // ── Build a map of tonight's starting positions ───────────────────────────────
  const lineupRows = db.prepare(
    `SELECT driver_id, starting_position FROM race_entries WHERE race_id = ? AND starting_position IS NOT NULL`
  ).all(raceId) as Array<{ driver_id: number; starting_position: number }>;
  const lineupMap = new Map<number, number>(lineupRows.map((r) => [r.driver_id, r.starting_position]));

  const results: DriverOdds[] = [];

  for (const entry of entries) {
    const dId = entry.driver_id;

    // ── 1. Track win history ──────────────────────────────────────────────────
    const th = db.prepare(`
      SELECT COUNT(*) as starts,
             SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN dnf = 1 THEN 1 ELSE 0 END) as dnfs
      FROM race_entries re JOIN races r ON r.id = re.race_id
      WHERE re.driver_id = ? AND r.track_id = ? AND r.status = 'complete' AND re.race_id != ?
    `).get(dId, trackId, raceId) as { starts: number; wins: number; dnfs: number };

    // ── 2. Last event at this specific track ──────────────────────────────────
    const lastHere = db.prepare(`
      SELECT re.finishing_position, re.dnf
      FROM race_entries re JOIN races r ON r.id = re.race_id
      WHERE re.driver_id = ? AND r.track_id = ? AND r.status = 'complete' AND re.race_id != ?
      ORDER BY r.race_date DESC LIMIT 1
    `).get(dId, trackId, raceId) as { finishing_position: number; dnf: number } | undefined;

    // ── 3. Similar-track history ──────────────────────────────────────────────
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

    // ── 4. Season stats ───────────────────────────────────────────────────────
    const seasonStats = db.prepare(`
      SELECT * FROM driver_season_stats
      WHERE driver_id = ? AND series = 'WoO Late Models'
      ORDER BY season DESC LIMIT 1
    `).get(dId) as {
      starts: number; wins: number; quick_times: number; heat_wins: number;
      dnfs: number; top5: number; avg_finish: number | null;
      last5_avg_finish: number | null; season: number;
    } | undefined;

    // ── 5. Win/podium streak — consecutive top-5 from most recent ────────────
    const recentResults = db.prepare(`
      SELECT re.finishing_position, re.dnf
      FROM race_entries re JOIN races r ON r.id = re.race_id
      WHERE re.driver_id = ? AND r.status = 'complete' AND re.finishing_position IS NOT NULL
      ORDER BY r.race_date DESC LIMIT 15
    `).all(dId) as Array<{ finishing_position: number; dnf: number }>;
    const { streak, streakType } = computeStreak(recentResults);

    // ── 6. Distance bucket win rate ───────────────────────────────────────────
    const distRow = db.prepare(`
      SELECT COUNT(*) as starts,
             SUM(CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END) as wins
      FROM race_entries re JOIN races r ON r.id = re.race_id
      WHERE re.driver_id = ? AND r.status = 'complete'
        AND r.distance >= ? AND r.distance <= ?
    `).get(dId, bucket.min, bucket.max) as { starts: number; wins: number };

    // ── 7. Tonight's prelim — heat finish + QT rank at this event ────────────
    const prelim = db.prepare(`
      SELECT heat_position, qualifying_time FROM race_entries WHERE race_id = ? AND driver_id = ?
    `).get(raceId, dId) as { heat_position: number | null; qualifying_time: number | null } | undefined;
    const tonightHeatPos = prelim?.heat_position ?? null;
    const tonightQtRank = qtRankMap.get(dId) ?? null;

    // ── 8. Feature Plus/Minus ─────────────────────────────────────────────────
    const pmRow = db.prepare(`
      SELECT AVG(CAST(re.starting_position - re.finishing_position AS REAL)) AS avg_pm,
             COUNT(*) AS pm_starts
      FROM race_entries re JOIN races r ON r.id = re.race_id
      WHERE re.driver_id = ?
        AND re.starting_position IS NOT NULL
        AND re.finishing_position IS NOT NULL
        AND re.dnf = 0 AND r.status = 'complete'
    `).get(dId) as { avg_pm: number | null; pm_starts: number };

    // ── 9. Starting position conversion (this track + similar tracks) ────────────
    const tonightStartPos = lineupMap.get(dId) ?? null;
    let startPosWR: number | null = null;
    let startPosStarts = 0;
    if (tonightStartPos !== null) {
      const bracket = startPosBracket(tonightStartPos);

      // History at this exact track from the same bracket
      const spTrack = db.prepare(`
        SELECT COUNT(*) as starts,
               SUM(CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END) as wins
        FROM race_entries re JOIN races r ON r.id = re.race_id
        WHERE re.driver_id = ?
          AND r.track_id = ?
          AND r.status = 'complete'
          AND re.starting_position >= ? AND re.starting_position <= ?
          AND re.finishing_position IS NOT NULL
          AND re.race_id != ?
      `).get(dId, trackId, bracket.min, bracket.max, raceId) as { starts: number; wins: number };

      let spWStarts = spTrack.starts;
      let spWWins = spTrack.wins;

      // Also pull history at similar tracks (weighted)
      for (const sim of similars) {
        const sh = db.prepare(`
          SELECT COUNT(*) as starts,
                 SUM(CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END) as wins
          FROM race_entries re JOIN races r ON r.id = re.race_id
          WHERE re.driver_id = ?
            AND r.track_id = ?
            AND r.status = 'complete'
            AND re.starting_position >= ? AND re.starting_position <= ?
            AND re.finishing_position IS NOT NULL
        `).get(dId, sim.similar_track_id, bracket.min, bracket.max) as { starts: number; wins: number };
        spWStarts += sh.starts * sim.similarity_weight;
        spWWins   += sh.wins   * sim.similarity_weight;
      }

      startPosStarts = Math.round(spWStarts);
      startPosWR = spWStarts >= 3 ? spWWins / spWStarts : null;
    }

    // ── 10. Condition-specific win rate ──────────────────────────────────────
    let condWR: number | null = null, condStarts = 0;
    if (trackCondition) {
      const cr = db.prepare(`
        SELECT COUNT(*) as starts,
               SUM(CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END) as wins
        FROM race_entries re JOIN races r ON r.id = re.race_id
        WHERE re.driver_id = ? AND r.track_condition = ? AND r.status = 'complete' AND re.race_id != ?
      `).get(dId, trackCondition, raceId) as { starts: number; wins: number };
      condStarts = cr.starts;
      condWR = cr.starts > 0 ? cr.wins / cr.starts : null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  SCORING
    // ─────────────────────────────────────────────────────────────────────────
    const highlights: string[] = [];
    const warnings: string[] = [];
    let score = 0;

    // 1 ── Track win rate (0.25 with ≥3 starts, 0.13 with 1–2) ───────────────
    const trackWR = th.starts >= 1 ? th.wins / th.starts : null;
    const trackWeight = th.starts >= 3 ? 0.25 : th.starts >= 1 ? 0.13 : 0;
    if (trackWR !== null) {
      score += trackWR * trackWeight;
      if (trackWR >= 0.5)        highlights.push(`Won ${th.wins}/${th.starts} at this track`);
      else if (trackWR > 0)      highlights.push(`${Math.round(trackWR * 100)}% win rate here (${th.wins}/${th.starts})`);
    }

    // 2 ── Last event at this track (0.10) — most recent result matters ───────
    let lastHereScore: number | null = null;
    if (lastHere) {
      if (lastHere.dnf) {
        lastHereScore = 0.05;
        warnings.push("DNF last time at this track");
      } else {
        const pos = lastHere.finishing_position;
        lastHereScore = pos === 1 ? 1.0
          : pos <= 3 ? 0.75
          : pos <= 5 ? 0.55
          : pos <= 10 ? 0.35
          : Math.max(0, (fieldSize - pos) / fieldSize);
        if (pos === 1)   highlights.push("Won last time at this track");
        else if (pos <= 3) highlights.push(`P${pos} last time at this track`);
      }
      score += lastHereScore * 0.10;
    }

    // 3 ── Similar-track win rate (0.20) ──────────────────────────────────────
    const simWR = simStarts >= 0.5 ? simWins / simStarts : null;
    if (simWR !== null) {
      score += simWR * 0.20;
      if (simWR > 0.25) highlights.push(`${Math.round(simWR * 100)}% win rate on similar-surface tracks`);
    }

    // 4 ── Season win rate (0.15) ──────────────────────────────────────────────
    const seasonWR = seasonStats && seasonStats.starts > 0 ? seasonStats.wins / seasonStats.starts : null;
    if (seasonWR !== null) {
      score += seasonWR * 0.15;
      if (seasonWR >= 0.25)
        highlights.push(`${Math.round(seasonWR * 100)}% season win rate — ${seasonStats!.wins} wins`);
    }

    // 5 ── Win/podium streak (0.12) ────────────────────────────────────────────
    if (streak > 0) {
      // Sigmoid-style: 1 = 0.25, 2 = 0.5, 3 = 0.75, 4+ = 1.0
      const streakScore = Math.min(1, streak / 4);
      score += streakScore * 0.12;
      const labels = { win: "win streak", podium: "podium streak", top5: "top-5 streak", none: "" };
      if (streak >= 2) highlights.push(`${streak}-race ${labels[streakType]} — ${streakType === "win" ? "on fire" : "hot form"}`);
      else if (streak === 1 && streakType === "win") highlights.push("Coming off a win");
    }

    // 6 ── Average feature finish (0.10) ──────────────────────────────────────
    const avgFinish = seasonStats?.avg_finish ?? null;
    if (avgFinish !== null) {
      score += Math.max(0, (fieldSize - avgFinish) / fieldSize) * 0.10;
      if (avgFinish <= 5) highlights.push(`${avgFinish.toFixed(1)} avg feature finish this season`);
    }

    // 7 ── Last 5 races momentum (0.10) ───────────────────────────────────────
    const last5 = seasonStats?.last5_avg_finish ?? null;
    if (last5 !== null) {
      score += Math.max(0, (fieldSize - last5) / fieldSize) * 0.10;
      if (last5 <= 4.5)  highlights.push(`On fire — ${last5.toFixed(1)} avg in last 5 races`);
      else if (last5 >= 14) warnings.push(`Cold streak — ${last5.toFixed(1)} avg in last 5 races`);
    }

    // 8 ── Distance bucket win rate (0.08) ────────────────────────────────────
    const distWR = distRow.starts >= 2 ? distRow.wins / distRow.starts : null;
    if (distWR !== null) {
      score += distWR * 0.08;
      if (distWR >= 0.3 && distRow.starts >= 3)
        highlights.push(`${Math.round(distWR * 100)}% win rate in ${bucket.label}`);
    }

    // 9 ── Season quick time rate (0.07) ──────────────────────────────────────
    const qtRate = seasonStats && seasonStats.starts > 0 ? seasonStats.quick_times / seasonStats.starts : null;
    if (qtRate !== null) {
      score += qtRate * 0.07;
      if (qtRate >= 0.25) highlights.push(`Fast qualifier — QT ${Math.round(qtRate * 100)}% of events`);
    }

    // 10 ── Season heat win rate (0.06) ────────────────────────────────────────
    const heatWR = seasonStats && seasonStats.starts > 0 ? seasonStats.heat_wins / seasonStats.starts : null;
    if (heatWR !== null) {
      score += heatWR * 0.06;
      if (heatWR >= 0.45) highlights.push(`Dominant in heats — ${Math.round(heatWR * 100)}% heat win rate`);
    }

    // 15 ── Starting Position (0.12 when lineup is posted) ────────────────────
    // Blends raw grid advantage with historical conversion from that bracket.
    // Conversion rate at this track + similar tracks anchors the adjustment —
    // a driver who historically charges from P2 is worth more than one who fades.
    if (hasLineup && tonightStartPos !== null) {
      const posAdvantage = Math.max(0, (fieldSize - (tonightStartPos - 1)) / fieldSize);
      const conversionRate = startPosWR !== null ? startPosWR : posAdvantage * 0.5; // prior when sparse
      // Blend: 60% position advantage, 40% historical conversion
      const startScore = 0.60 * posAdvantage + 0.40 * conversionRate;
      score += startScore * 0.12;

      const bracket = startPosBracket(tonightStartPos);
      if (tonightStartPos === 1) {
        highlights.push(startPosWR !== null
          ? `Starts on the pole — ${Math.round(startPosWR * 100)}% win rate from front-3`
          : "Starts on the pole");
      } else if (tonightStartPos <= 3) {
        highlights.push(startPosWR !== null
          ? `Starts P${tonightStartPos} — ${Math.round(startPosWR * 100)}% win rate from ${bracket.label}`
          : `Starts P${tonightStartPos} (${bracket.label})`);
      } else if (tonightStartPos <= 6) {
        if (startPosWR !== null && startPosWR >= 0.20)
          highlights.push(`Strong converter from P${tonightStartPos} — ${Math.round(startPosWR * 100)}% win rate`);
        else if (startPosWR !== null && startPosWR < 0.05 && startPosStarts >= 3)
          warnings.push(`Rarely converts from ${bracket.label} (${Math.round(startPosWR * 100)}% in ${startPosStarts} tries)`);
      } else if (tonightStartPos > Math.ceil(fieldSize * 0.5)) {
        warnings.push(`Starts P${tonightStartPos} — deep in the field`);
      }
    }

    // 11 ── DNF risk penalty (-0.12 if elevated) ──────────────────────────────
    const allDnfs   = (th.dnfs || 0) + (seasonStats?.dnfs || 0);
    const allStarts = (th.starts || 0) + (seasonStats?.starts || 0);
    const dnfRate   = allStarts > 0 ? allDnfs / allStarts : null;
    if (dnfRate !== null && dnfRate > 0.12) {
      score -= dnfRate * 0.12;
      warnings.push(`Elevated DNF rate — ${Math.round(dnfRate * 100)}%`);
    }

    // 12 ── Feature Plus/Minus (0.05, accumulates from MRP syncs) ─────────────
    const featurePM = (pmRow.pm_starts >= 3 && pmRow.avg_pm !== null) ? pmRow.avg_pm : null;
    if (featurePM !== null) {
      score += Math.max(0, Math.min(1, (featurePM + 10) / 20)) * 0.05;
      if (featurePM >= 3)  highlights.push(`Charges forward — avg +${featurePM.toFixed(1)} positions`);
      else if (featurePM <= -3) warnings.push(`Loses ground in features — avg ${featurePM.toFixed(1)}`);
    }

    // 13 ── Condition win rate (display only, no weight until multi-condition data)
    if (condWR !== null && condStarts >= 3 && condWR >= 0.40)
      highlights.push(`${Math.round(condWR * 100)}% win rate on ${trackCondition} tracks (${condStarts} starts)`);

    // 14 ── TONIGHT'S PRELIM BOOST (post-heats, high signal) ──────────────────
    // Applied after all season factors — these override historical when available
    if (tonightHeatPos !== null) {
      // Heat finish: P1 = 1.0, P2 = 0.8, linear down to 0 at fieldSize
      const heatScore = Math.max(0, (fieldSize - (tonightHeatPos - 1)) / fieldSize);
      score += heatScore * 0.20;
      if (tonightHeatPos === 1)      highlights.push("Won their heat race tonight");
      else if (tonightHeatPos <= 3)  highlights.push(`P${tonightHeatPos} in tonight's heat`);
      else if (tonightHeatPos > Math.ceil(fieldSize * 0.6))
        warnings.push(`P${tonightHeatPos} heat finish — starts deep in the feature`);
    }

    if (tonightQtRank !== null && qtRunners >= 3) {
      // QT rank: 1st = 1.0, last = 0.0
      const qtScore = Math.max(0, (qtRunners - (tonightQtRank - 1)) / qtRunners);
      score += qtScore * 0.10;
      if (tonightQtRank === 1)       highlights.push("Quick Time at tonight's event");
      else if (tonightQtRank <= 3)   highlights.push(`Top-${tonightQtRank} qualifier tonight`);
    }

    // 16 ── Driver specialty bonus (manually set via Intelligence page) ─────────
    const specialtyBonus = getDriverSpecialtyBonus(dId, trackId, trackFamily);
    if (specialtyBonus > 0) {
      score += specialtyBonus;
      highlights.push(`Track specialist — ${Math.round(specialtyBonus * 100)}pt affinity bonus`);
    }

    if (score <= 0) score = 0.005;

    results.push({
      driverId: dId,
      driverName: entry.name,
      carNumber: entry.car_number,
      americanOdds: "",
      impliedProbability: score,
      rawScore: score,
      eloRating: 0,
      reasoning: {
        trackWinRate: trackWR,
        trackStarts: th.starts,
        lastEventHere: lastHere?.finishing_position ?? null,
        similarTrackWinRate: simWR,
        similarTrackStarts: Math.round(simStarts),
        seasonWinRate: seasonWR,
        seasonStarts: seasonStats?.starts ?? 0,
        avgFinish,
        last5AvgFinish: last5,
        streak,
        streakType,
        tonightHeatPos,
        tonightQtRank,
        tonightQtRunners: qtRunners,
        startingPosition: tonightStartPos,
        startingPosWinRate: startPosWR,
        startingPosStarts: startPosStarts,
        quickTimeRate: qtRate,
        heatWinRate: heatWR,
        distanceWinRate: distWR,
        distanceStarts: distRow.starts,
        dnfRate,
        featurePlusMinus: featurePM,
        featurePmRaces: pmRow.pm_starts,
        conditionWinRate: condWR,
        conditionStarts: condStarts,
        specialtyBonus,
        compositeScore: score,
        highlights,
        warnings,
      },
    });
  }

  // ── Blend composite scores with Elo win probabilities ────────────────────────
  // When prelim data (heats) is entered for ≥25% of field, reduce Elo weight —
  // current-night performance is a stronger signal than historical Elo
  const eloWeight = hasPrelimData ? 0.30 : 0.45;
  const compositeWeight = 1 - eloWeight;

  const driverIds = results.map((r) => r.driverId);
  const eloProbs  = eloWinProbabilities(driverIds, raceId);
  const eloRatings = getDriverEloRatings(driverIds, raceId);

  const rawTotal = results.reduce((s, r) => s + r.rawScore, 0);
  const blended = results.map((r) => {
    const compositeProb = rawTotal > 0 ? r.rawScore / rawTotal : 1 / results.length;
    const eloPr = eloProbs.get(r.driverId) ?? (1 / results.length);
    return eloWeight * eloPr + compositeWeight * compositeProb;
  });

  const viggedProbs = applyVig(blended);

  return results
    .map((r, i) => ({
      ...r,
      eloRating: eloRatings.get(r.driverId) ?? 1500,
      impliedProbability: viggedProbs[i],
      americanOdds: americanOddsStr(viggedProbs[i]),
    }))
    .sort((a, b) => b.impliedProbability - a.impliedProbability);
}
