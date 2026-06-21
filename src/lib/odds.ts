import "server-only";
import { getDb } from "./db";
import { eloWinProbabilities, getDriverEloRatings } from "./elo";
import { getDriverSpecialtyBonus } from "./driver-specialties";
import { getRaceContextAdjustmentMap } from "./race-context-adjustments";
import { getTrackDriverTrendMap } from "./track-driver-trends";
import { resolveDriverMetricSeries } from "./series";

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
  // Streak & recent form
  streak: number;                      // consecutive top-5 finishes
  streakType: "win" | "podium" | "top5" | "none";
  recentWins3: number;                 // wins in last 3 races (non-consecutive)
  recentWins5: number;                 // wins in last 5 races (non-consecutive)
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
  raceContextScoreDelta: number;
  compositeScore: number;
  metricSeries: string;
  highlights: string[];
  warnings: string[];
}

function americanOddsStr(p: number): string {
  if (p >= 1) return "-∞";
  if (p <= 0) return "+∞";
  const odds = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  return odds < 0 ? Math.round(odds).toString() : `+${Math.round(odds)}`;
}

function publicOutrightOdds(p: number, rank: number): string {
  if (rank !== 0) return americanOddsStr(p);
  if (p >= 0.4) return "-115";
  if (p >= 0.36) return "-105";
  if (p >= 0.32) return "+115";
  if (p >= 0.28) return "+145";
  return americanOddsStr(p);
}

function applyVig(probs: number[], vig = 0.12): number[] {
  const total = probs.reduce((a, b) => a + b, 0);
  if (total === 0) return probs.map(() => 1 / probs.length);
  const vigged = probs.map((p) => (p / total) * (1 + vig));
  const vigTotal = vigged.reduce((a, b) => a + b, 0);
  return vigged.map((p) => p / vigTotal);
}

// Group starting positions into brackets for historical comparison.
// Keep pole separate because some tracks, especially places with clean-air
// feature history, convert P1 very differently than the rest of the front rows.
function startPosBracket(pos: number): { min: number; max: number; label: string } {
  if (pos === 1) return { min: 1,  max: 1,   label: "pole" };
  if (pos <= 2)  return { min: 1,  max: 2,   label: "front row" };
  if (pos <= 4)  return { min: 3,  max: 4,   label: "rows 2" };
  if (pos <= 6)  return { min: 5,  max: 6,   label: "rows 3" };
  if (pos <= 10) return { min: 7,  max: 10,  label: "rows 4-5" };
  if (pos <= 15) return { min: 11, max: 15,  label: "mid-pack" };
  return          { min: 16, max: 9999, label: "tail-end" };
}

// Map laps to a distance bucket label
function distanceBucket(laps: number): { min: number; max: number; label: string } {
  if (laps <= 40)  return { min: 1,   max: 40,  label: "short feature (≤40 laps)" };
  if (laps <= 70)  return { min: 41,  max: 70,  label: "standard (41–70 laps)" };
  if (laps <= 100) return { min: 71,  max: 100, label: "long (71–100 laps)" };
  return            { min: 101, max: 9999, label: "marathon (100+ laps)" };
}

function trackSizeLabel(length: number | null): string | null {
  if (!length || length <= 0) return null;
  const known: Array<[number, string]> = [
    [0.25, "1/4"],
    [0.30, "3/10"],
    [1 / 3, "1/3"],
    [0.375, "3/8"],
    [0.40, "4/10"],
    [0.4375, "7/16"],
    [0.50, "1/2"],
    [0.625, "5/8"],
  ];
  return known.reduce((best, current) =>
    Math.abs(current[0] - length) < Math.abs(best[0] - length) ? current : best
  )[1];
}

function normalizeMetric(value: number | null | undefined, max: number): number {
  if (!value || value <= 0 || max <= 0) return 0;
  return Math.log1p(value) / Math.log1p(max);
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
    SELECT re.driver_id, re.car_number, re.entry_series, d.name
    FROM race_entries re JOIN drivers d ON d.id = re.driver_id
    WHERE re.race_id = ?
  `).all(raceId) as Array<{
    driver_id: number;
    car_number: string | null;
    entry_series: string | null;
    name: string;
  }>;

  if (entries.length === 0) return [];

  const fieldSize = entries.length;
  const entryDriverIds = entries.map((e) => e.driver_id);
  const placeholders = entryDriverIds.map(() => "?").join(",");

  // Bidirectional — find all tracks that have a similarity relationship with this track
  const similars = db.prepare(`
    SELECT
      CASE WHEN track_id = ? THEN similar_track_id ELSE track_id END AS similar_track_id,
      similarity_weight
    FROM track_similars
    WHERE track_id = ? OR similar_track_id = ?
  `).all(trackId, trackId, trackId) as Array<{ similar_track_id: number; similarity_weight: number }>;

  const trackMeta = db.prepare(`SELECT track_family, track_length FROM tracks WHERE id = ?`)
    .get(trackId) as { track_family: string | null; track_length: number | null } | undefined;
  const trackFamily = trackMeta?.track_family ?? null;
  const trackSize = trackSizeLabel(trackMeta?.track_length ?? null);

  const raceInfo = db.prepare(`SELECT track_condition, distance, division, series_mode FROM races WHERE id = ?`)
    .get(raceId) as { track_condition: string; distance: number | null; division: string; series_mode: string | null } | undefined;
  const raceSeriesContext = raceInfo?.series_mode ?? raceInfo?.division ?? null;
  const metricSeriesMap = new Map(
    entries.map((entry) => [
      entry.driver_id,
      resolveDriverMetricSeries(entry.driver_id, raceSeriesContext, entry.entry_series),
    ]),
  );
  const contextAdjustments = getRaceContextAdjustmentMap(raceId);
  const trackTrends = getTrackDriverTrendMap(trackId);

  const aggregateRows = placeholders
    ? db.prepare(`
        SELECT *
        FROM driver_model_metrics
        WHERE driver_id IN (${placeholders})
      `).all(...entryDriverIds) as Array<{
        driver_id: number;
        series: string;
        last5_avg_finish: number | null;
        avg_finish: number | null;
        avg_start: number | null;
        avg_qual_position: number | null;
        quick_times: number;
        qual_attempts: number;
        feature_wins: number;
        laps_led_per_win: number | null;
        top5s: number;
        top10s: number;
        laps_led: number;
        hard_charger_count: number;
        heat_wins: number;
      }>
    : [];
  const selectedAggregateRows = aggregateRows.filter((r) => metricSeriesMap.get(r.driver_id) === r.series);
  const aggregateMap = new Map(selectedAggregateRows.map((r) => [r.driver_id, r]));
  const aggregateMax = {
    featureWins: Math.max(0, ...selectedAggregateRows.map((r) => r.feature_wins ?? 0)),
    top5s: Math.max(0, ...selectedAggregateRows.map((r) => r.top5s ?? 0)),
    top10s: Math.max(0, ...selectedAggregateRows.map((r) => r.top10s ?? 0)),
    lapsLed: Math.max(0, ...selectedAggregateRows.map((r) => r.laps_led ?? 0)),
    hardChargers: Math.max(0, ...selectedAggregateRows.map((r) => r.hard_charger_count ?? 0)),
    heatWins: Math.max(0, ...selectedAggregateRows.map((r) => r.heat_wins ?? 0)),
  };

  const trackSizeRows = placeholders && trackSize
    ? db.prepare(`
        SELECT driver_id, series, wins
        FROM driver_track_size_wins
        WHERE track_size = ?
          AND driver_id IN (${placeholders})
      `).all(trackSize, ...entryDriverIds) as Array<{ driver_id: number; series: string; wins: number }>
    : [];
  const selectedTrackSizeRows = trackSizeRows.filter((r) => metricSeriesMap.get(r.driver_id) === r.series);
  const trackSizeWinMap = new Map(selectedTrackSizeRows.map((r) => [r.driver_id, r.wins]));
  const maxTrackSizeWins = Math.max(0, ...selectedTrackSizeRows.map((r) => r.wins ?? 0));

  const equipmentRows = placeholders
    ? db.prepare(`
        SELECT driver_id, chassis_family, engine_family, shock_family, chassis, engine, shocks
        FROM driver_equipment_profiles
        WHERE driver_id IN (${placeholders})
      `).all(...entryDriverIds) as Array<{
        driver_id: number;
        chassis_family: string | null;
        engine_family: string | null;
        shock_family: string | null;
        chassis: string | null;
        engine: string | null;
        shocks: string | null;
      }>
    : [];
  const equipmentMap = new Map(equipmentRows.map((r) => [r.driver_id, r]));

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
  const hasMeaningfulLineup = lineupDataCount >= Math.ceil(fieldSize * 0.5);

  // ── Build a map of tonight's starting positions ───────────────────────────────
  const lineupRows = db.prepare(
    `SELECT driver_id, starting_position FROM race_entries WHERE race_id = ? AND starting_position IS NOT NULL`
  ).all(raceId) as Array<{ driver_id: number; starting_position: number }>;
  const lineupMap = new Map<number, number>(lineupRows.map((r) => [r.driver_id, r.starting_position]));

  const results: DriverOdds[] = [];

  for (const entry of entries) {
    const dId = entry.driver_id;
    const metricSeries = metricSeriesMap.get(dId) ?? "WoO Late Models";

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
        WHERE re.driver_id = ? AND r.track_id = ? AND r.status = 'complete' AND re.race_id != ?
      `).get(dId, sim.similar_track_id, raceId) as { starts: number; wins: number };
      simStarts += sh.starts * sim.similarity_weight;
      simWins += sh.wins * sim.similarity_weight;
    }

    // ── 4. Season stats ───────────────────────────────────────────────────────
    const seasonStats = db.prepare(`
      SELECT * FROM driver_season_stats
      WHERE driver_id = ? AND series = ?
      ORDER BY season DESC LIMIT 1
    `).get(dId, metricSeries) as {
      starts: number; wins: number; quick_times: number; heat_wins: number;
      dnfs: number; top5: number; avg_finish: number | null;
      last5_avg_finish: number | null; season: number;
    } | undefined;
    const aggregateStats = aggregateMap.get(dId);
    const trackSizeWins = trackSizeWinMap.get(dId) ?? 0;
    const equipment = equipmentMap.get(dId);

    // ── 5. Win/podium streak — consecutive top-5 from most recent ────────────
    const recentResults = db.prepare(`
      SELECT re.finishing_position, re.dnf
      FROM race_entries re JOIN races r ON r.id = re.race_id
      WHERE re.driver_id = ? AND r.status = 'complete' AND re.finishing_position IS NOT NULL AND re.race_id != ?
      ORDER BY r.race_date DESC LIMIT 15
    `).all(dId, raceId) as Array<{ finishing_position: number; dnf: number }>;
    const { streak, streakType } = computeStreak(recentResults);

    // ── 5b. Recent wins (non-consecutive) — "hot hand" signal ────────────────
    const recentWins3 = recentResults.slice(0, 3).filter(r => !r.dnf && r.finishing_position === 1).length;
    const recentWins5 = recentResults.slice(0, 5).filter(r => !r.dnf && r.finishing_position === 1).length;

    // ── 6. Distance bucket win rate ───────────────────────────────────────────
    const distRow = db.prepare(`
      SELECT COUNT(*) as starts,
             SUM(CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END) as wins
      FROM race_entries re JOIN races r ON r.id = re.race_id
      WHERE re.driver_id = ? AND r.status = 'complete' AND re.race_id != ?
        AND r.distance >= ? AND r.distance <= ?
    `).get(dId, raceId, bucket.min, bucket.max) as { starts: number; wins: number };

    // ── 7. Tonight's prelim — heat finish + QT rank at this event ────────────
    const prelim = db.prepare(`
      SELECT heat_position, bmain_position, qualifying_time FROM race_entries WHERE race_id = ? AND driver_id = ?
    `).get(raceId, dId) as {
      heat_position: number | null;
      bmain_position: number | null;
      qualifying_time: number | null;
    } | undefined;
    const tonightHeatPos = prelim?.heat_position ?? null;
    const tonightBmainPos = prelim?.bmain_position ?? null;
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
        AND re.race_id != ?
    `).get(dId, raceId) as { avg_pm: number | null; pm_starts: number };

    // ── 9. Starting position conversion (this track + similar tracks) ────────────
    const tonightStartPos = lineupMap.get(dId) ?? null;
    let startPosWR: number | null = null;
    let startPosStarts = 0;
    let trackStartPosWR: number | null = null;
    let trackStartPosStarts = 0;
    if (tonightStartPos !== null) {
      const bracket = startPosBracket(tonightStartPos);

      // Driver history at this exact track from the same bracket
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
            AND re.race_id != ?
        `).get(dId, sim.similar_track_id, bracket.min, bracket.max, raceId) as { starts: number; wins: number };
        spWStarts += sh.starts * sim.similarity_weight;
        spWWins   += sh.wins   * sim.similarity_weight;
      }

      startPosStarts = Math.round(spWStarts);
      startPosWR = spWStarts >= 3 ? spWWins / spWStarts : null;

      // Track-wide conversion from this same start bracket. This lets the model
      // learn that a Smoky Mountain pole is structurally stronger even when the
      // specific driver has a sparse start-position sample.
      const trackStart = db.prepare(`
        SELECT COUNT(*) as starts,
               SUM(CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END) as wins
        FROM race_entries re JOIN races r ON r.id = re.race_id
        WHERE r.track_id = ?
          AND r.status = 'complete'
          AND re.starting_position >= ? AND re.starting_position <= ?
          AND re.finishing_position IS NOT NULL
          AND re.race_id != ?
      `).get(trackId, bracket.min, bracket.max, raceId) as { starts: number; wins: number };

      trackStartPosStarts = trackStart.starts;
      trackStartPosWR = trackStart.starts >= 5 ? trackStart.wins / trackStart.starts : null;
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
    highlights.push(`Using ${metricSeries} profile`);

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
      if (simWR > 0.25) highlights.push(`${Math.round(simWR * 100)}% win rate on similar racing-style tracks`);
    }

    // 4 ── Season win rate (0.15) ──────────────────────────────────────────────
    const seasonWR = seasonStats && seasonStats.starts > 0 ? seasonStats.wins / seasonStats.starts : null;
    if (seasonWR !== null) {
      score += seasonWR * 0.15;
      if (seasonWR >= 0.25)
        highlights.push(`${Math.round(seasonWR * 100)}% season win rate — ${seasonStats!.wins} wins`);
    }

    // 5 ── Win/podium streak (0.10) ────────────────────────────────────────────
    if (streak > 0) {
      // Sigmoid-style: 1 = 0.25, 2 = 0.5, 3 = 0.75, 4+ = 1.0
      const streakScore = Math.min(1, streak / 4);
      score += streakScore * 0.10;
      const labels = { win: "win streak", podium: "podium streak", top5: "top-5 streak", none: "" };
      if (streak >= 2) highlights.push(`${streak}-race ${labels[streakType]} — ${streakType === "win" ? "on fire" : "hot form"}`);
      else if (streak === 1 && streakType === "win") highlights.push("Coming off a win");
    }

    // 5b ── Recent hot-hand wins in last 3/5 (0.10) ──────────────────────────
    // Captures drivers who've won recently but broke their streak with one bad run.
    // Dream/crown-jewel winners almost always have a win in the last 3–5 races.
    if (recentWins3 > 0 || recentWins5 > 0) {
      // 3-race window weighted 2×, 5-race window 1× — recency matters most
      const hotHandScore = Math.min(1, (recentWins3 * 0.55 + recentWins5 * 0.25));
      score += hotHandScore * 0.10;
      if (recentWins3 >= 2)       highlights.push(`${recentWins3} wins in last 3 races — on a tear`);
      else if (recentWins3 === 1) highlights.push("Won in the last 3 races");
      else if (recentWins5 >= 2)  highlights.push(`${recentWins5} wins in last 5 races`);
      else if (recentWins5 === 1) highlights.push("Won in the last 5 races");
    } else if (recentResults.length >= 5) {
      warnings.push("No wins in last 5 races");
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

    // 10b ── Imported aggregate model metrics (0.18 total prior) ──────────────
    if (aggregateStats) {
      const recencyScore = aggregateStats.last5_avg_finish !== null
        ? Math.max(0, (fieldSize - aggregateStats.last5_avg_finish) / fieldSize)
        : 0;
      const featureWinScore = normalizeMetric(aggregateStats.feature_wins, aggregateMax.featureWins);
      const top5Score = normalizeMetric(aggregateStats.top5s, aggregateMax.top5s);
      const top10Score = normalizeMetric(aggregateStats.top10s, aggregateMax.top10s);
      const lapsLedScore = normalizeMetric(aggregateStats.laps_led, aggregateMax.lapsLed);
      const hardChargerScore = normalizeMetric(aggregateStats.hard_charger_count, aggregateMax.hardChargers);
      const aggregateHeatScore = normalizeMetric(aggregateStats.heat_wins, aggregateMax.heatWins);
      const trackSizeScore = normalizeMetric(trackSizeWins, maxTrackSizeWins);

      score += recencyScore * 0.04;
      score += featureWinScore * 0.04;
      score += top5Score * 0.025;
      score += top10Score * 0.015;
      score += lapsLedScore * 0.02;
      score += hardChargerScore * 0.015;
      score += aggregateHeatScore * 0.015;
      score += trackSizeScore * 0.015;

      if (aggregateStats.feature_wins >= 20) highlights.push(`${aggregateStats.feature_wins} feature wins in model history`);
      if (aggregateStats.top5s >= 75) highlights.push(`${aggregateStats.top5s} top-5s in model history`);
      if (trackSizeWins > 0 && trackSize) highlights.push(`${trackSizeWins} wins on ${trackSize}-mile tracks`);
      if (aggregateStats.hard_charger_count >= 10) highlights.push(`${aggregateStats.hard_charger_count} hard charger awards`);
      if (aggregateStats.avg_finish !== null && aggregateStats.avg_finish <= 8) {
        highlights.push(`${aggregateStats.avg_finish.toFixed(1)} aggregate avg finish in ${metricSeries}`);
      }
    }

    // 10c ── Equipment package prior (0.04 max) ───────────────────────────────
    if (equipment) {
      const chassisBonus = equipment.chassis_family === "Longhorn" || equipment.chassis_family === "Rocket" ? 0.012 : 0;
      const engineBonus = ["Clements", "Cornett", "Durham", "Vic Hill"].includes(equipment.engine_family ?? "") ? 0.014 : 0;
      const shockBonus = ["Ohlins", "Bilstein", "Penske"].includes(equipment.shock_family ?? "") ? 0.008 : 0;
      const comboBonus =
        equipment.chassis_family === "Longhorn" && ["Clements", "Cornett", "Vic Hill"].includes(equipment.engine_family ?? "")
          ? 0.006
          : equipment.chassis_family === "Rocket" && equipment.engine_family === "Durham"
            ? 0.006
            : 0;
      const equipmentBonus = chassisBonus + engineBonus + shockBonus + comboBonus;
      score += equipmentBonus;

      if (equipmentBonus >= 0.03) {
        highlights.push(`${equipment.chassis_family}/${equipment.engine_family} equipment package`);
      }
    }

    // 15 ── Starting Position (0.12 when lineup is posted) ────────────────────
    // Blends raw grid advantage with historical conversion from that bracket.
    // Conversion rate at this track + similar tracks anchors the adjustment —
    // a driver who historically charges from P2 is worth more than one who fades.
    if (hasLineup && tonightStartPos !== null) {
      const posAdvantage = Math.max(0, (fieldSize - (tonightStartPos - 1)) / fieldSize);
      const conversionRate =
        startPosWR !== null && trackStartPosWR !== null
          ? (startPosWR * 0.35) + (trackStartPosWR * 0.65)
          : trackStartPosWR ?? startPosWR ?? posAdvantage * 0.5; // prior when sparse
      // Blend: raw grid advantage, local bracket conversion, and a small pole
      // premium when the same track has repeatedly rewarded clean air.
      const startScore = 0.55 * posAdvantage + 0.45 * conversionRate;
      const poleTrackPremium =
        tonightStartPos === 1 && trackStartPosWR !== null && trackStartPosStarts >= 5 && trackStartPosWR >= 0.4
          ? Math.min(0.035, trackStartPosWR * 0.05)
          : 0;
      score += startScore * 0.12 + poleTrackPremium;

      const bracket = startPosBracket(tonightStartPos);
      if (tonightStartPos === 1) {
        highlights.push(trackStartPosWR !== null
          ? `Starts on the pole — ${Math.round(trackStartPosWR * 100)}% Smoky bracket win rate`
          : "Starts on the pole");
      } else if (tonightStartPos <= 3) {
        highlights.push((trackStartPosWR ?? startPosWR) !== null
          ? `Starts P${tonightStartPos} — ${Math.round((trackStartPosWR ?? startPosWR ?? 0) * 100)}% win rate from ${bracket.label}`
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

    // 14b ── Transfer path penalty ────────────────────────────────────────────
    // If the feature grid is known and a driver is still represented through a
    // B-main path, discount them. This is generic race-night behavior, not a
    // driver-specific caveat.
    if (tonightBmainPos !== null && hasMeaningfulLineup && tonightStartPos === null) {
      const bmainPenalty = tonightBmainPos === 1 ? 0.045 : tonightBmainPos <= 3 ? 0.065 : 0.09;
      score -= bmainPenalty;
      warnings.push(`B-main route P${tonightBmainPos} — not locked into feature lineup`);
    } else if (tonightBmainPos !== null && tonightStartPos !== null && tonightStartPos > Math.ceil(fieldSize * 0.65)) {
      score -= 0.035;
      warnings.push(`Transferred through B-main and starts P${tonightStartPos}`);
    }

    // 16 ── Driver specialty bonus (manually set via Intelligence page) ─────────
    const specialtyBonus = getDriverSpecialtyBonus(dId, trackId, trackFamily);
    if (specialtyBonus > 0) {
      score += specialtyBonus;
      highlights.push(`Track specialist — ${Math.round(specialtyBonus * 100)}pt affinity bonus`);
    }

    const driverTrackTrends = trackTrends.byDriver.get(dId) ?? [];
    const trackTrendScoreDelta = driverTrackTrends.reduce((sum, item) => sum + item.score_delta, 0);
    if (driverTrackTrends.length > 0) {
      score += trackTrendScoreDelta;
      for (const trend of driverTrackTrends.slice(0, 2)) {
        const direction = trend.score_delta > 0 ? "+" : "";
        highlights.push(`${trend.label} (${direction}${trend.score_delta.toFixed(3)} track trend)`);
      }
    }

    const driverContext = contextAdjustments.byDriver.get(dId) ?? [];
    const raceContextScoreDelta = driverContext.reduce((sum, item) => sum + item.score_delta, 0);
    if (driverContext.length > 0) {
      score += raceContextScoreDelta;
      for (const adjustment of driverContext.slice(0, 2)) {
        const direction = adjustment.score_delta > 0 ? "+" : "";
        highlights.push(`${adjustment.label} (${direction}${adjustment.score_delta.toFixed(3)} context)`);
      }
    }

    for (const adjustment of contextAdjustments.raceWide.slice(0, 2)) {
      if (adjustment.context_type === "field_strength") {
        warnings.push(`Field strength: ${adjustment.label}`);
      } else {
        highlights.push(adjustment.label);
      }
    }

    for (const trend of trackTrends.trackWide.slice(0, 1)) {
      highlights.push(`Track trend: ${trend.label}`);
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
        recentWins3,
        recentWins5,
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
        raceContextScoreDelta,
        compositeScore: score,
        metricSeries,
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
      americanOdds: "",
    }))
    .sort((a, b) => b.impliedProbability - a.impliedProbability)
    .map((result, index) => ({
      ...result,
      americanOdds: publicOutrightOdds(result.impliedProbability, index),
    }));
}
