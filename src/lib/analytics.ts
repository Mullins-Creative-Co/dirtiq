import "server-only";
import { getDb } from "./db";

export interface FactorAccuracy {
  factor: string;
  description: string;
  weight: string;
  racesWithData: number;
  timesTopPickWon: number;
  accuracy: number | null; // null if < 3 races
}

export interface ConditionBreakdown {
  condition: string;
  races: number;
  topDrivers: Array<{ name: string; wins: number; starts: number }>;
}

export interface DriverFactorRow {
  driverId: number;
  name: string;
  eloRating: number;
  seasonWins: number;
  seasonStarts: number;
  avgFinish: number | null;
  last5Avg: number | null;
  qtRate: number | null;
  heatWinRate: number | null;
  dnfRate: number | null;
  trackWins: number;
  trackStarts: number;
}

// Compute how often the driver ranked #1 by each factor actually won the race
export function computeFactorAccuracy(): FactorAccuracy[] {
  const db = getDb();

  const completedRaces = db.prepare(`
    SELECT r.id, r.track_id, r.track_condition,
           (SELECT re2.driver_id FROM race_entries re2 WHERE re2.race_id = r.id AND re2.finishing_position = 1 LIMIT 1) as winner_id
    FROM races r
    WHERE r.status = 'complete'
    ORDER BY r.race_date ASC
  `).all() as Array<{ id: number; track_id: number; track_condition: string; winner_id: number | null }>;

  if (completedRaces.length === 0) return [];

  // Accumulators per factor
  const factors: Record<string, { picked: number; correct: number }> = {
    seasonWinRate:    { picked: 0, correct: 0 },
    avgFinish:        { picked: 0, correct: 0 },
    last5AvgFinish:   { picked: 0, correct: 0 },
    qtRate:           { picked: 0, correct: 0 },
    heatWinRate:      { picked: 0, correct: 0 },
    dnfRisk:          { picked: 0, correct: 0 },
    trackHistory:     { picked: 0, correct: 0 },
    simTrackHistory:  { picked: 0, correct: 0 },
  };

  for (const race of completedRaces) {
    if (!race.winner_id) continue;

    const drivers = db.prepare(`
      SELECT re.driver_id FROM race_entries re WHERE re.race_id = ? AND re.finishing_position IS NOT NULL
    `).all(race.id) as Array<{ driver_id: number }>;

    if (drivers.length < 2) continue;

    const dIds = drivers.map((d) => d.driver_id);

    // Season win rate
    checkFactor(db, "seasonWinRate", dIds, race.winner_id, factors, (dId) => {
      const s = db.prepare(`SELECT starts, wins FROM driver_season_stats WHERE driver_id = ? AND series = 'WoO Late Models' ORDER BY season DESC LIMIT 1`)
        .get(dId) as { starts: number; wins: number } | undefined;
      return s && s.starts > 0 ? s.wins / s.starts : null;
    }, true);

    // Avg finish (lower = better, so invert for ranking)
    checkFactor(db, "avgFinish", dIds, race.winner_id, factors, (dId) => {
      const s = db.prepare(`SELECT avg_finish FROM driver_season_stats WHERE driver_id = ? AND series = 'WoO Late Models' ORDER BY season DESC LIMIT 1`)
        .get(dId) as { avg_finish: number | null } | undefined;
      return s?.avg_finish != null ? -s.avg_finish : null; // invert: higher = better finish position
    }, true);

    // Last 5 avg (lower = better, so invert)
    checkFactor(db, "last5AvgFinish", dIds, race.winner_id, factors, (dId) => {
      const s = db.prepare(`SELECT last5_avg_finish FROM driver_season_stats WHERE driver_id = ? AND series = 'WoO Late Models' ORDER BY season DESC LIMIT 1`)
        .get(dId) as { last5_avg_finish: number | null } | undefined;
      return s?.last5_avg_finish != null ? -s.last5_avg_finish : null;
    }, true);

    // QT rate
    checkFactor(db, "qtRate", dIds, race.winner_id, factors, (dId) => {
      const s = db.prepare(`SELECT starts, quick_times FROM driver_season_stats WHERE driver_id = ? AND series = 'WoO Late Models' ORDER BY season DESC LIMIT 1`)
        .get(dId) as { starts: number; quick_times: number } | undefined;
      return s && s.starts > 0 ? s.quick_times / s.starts : null;
    }, true);

    // Heat win rate
    checkFactor(db, "heatWinRate", dIds, race.winner_id, factors, (dId) => {
      const s = db.prepare(`SELECT starts, heat_wins FROM driver_season_stats WHERE driver_id = ? AND series = 'WoO Late Models' ORDER BY season DESC LIMIT 1`)
        .get(dId) as { starts: number; heat_wins: number } | undefined;
      return s && s.starts > 0 ? s.heat_wins / s.starts : null;
    }, true);

    // DNF risk (lower = better, so we pick the driver with lowest dnf rate)
    checkFactor(db, "dnfRisk", dIds, race.winner_id, factors, (dId) => {
      const s = db.prepare(`SELECT starts, dnfs FROM driver_season_stats WHERE driver_id = ? AND series = 'WoO Late Models' ORDER BY season DESC LIMIT 1`)
        .get(dId) as { starts: number; dnfs: number } | undefined;
      return s && s.starts > 0 ? -(s.dnfs / s.starts) : null; // invert: lower DNF rate is better
    }, true);

    // Track history
    checkFactor(db, "trackHistory", dIds, race.winner_id, factors, (dId) => {
      const th = db.prepare(`
        SELECT COUNT(*) as starts, SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) as wins
        FROM race_entries re JOIN races r2 ON r2.id = re.race_id
        WHERE re.driver_id = ? AND r2.track_id = ? AND r2.status = 'complete' AND re.race_id != ?
      `).get(dId, race.track_id, race.id) as { starts: number; wins: number };
      return th.starts >= 1 ? th.wins / th.starts : null;
    }, true);

    // Sim track history (simplified — just check any similar track)
    checkFactor(db, "simTrackHistory", dIds, race.winner_id, factors, (dId) => {
      const sims = db.prepare(`SELECT similar_track_id, similarity_weight FROM track_similars WHERE track_id = ?`)
        .all(race.track_id) as Array<{ similar_track_id: number; similarity_weight: number }>;
      if (sims.length === 0) return null;
      let wStarts = 0, wWins = 0;
      for (const sim of sims) {
        const sh = db.prepare(`
          SELECT COUNT(*) as starts, SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) as wins
          FROM race_entries re JOIN races r2 ON r2.id = re.race_id
          WHERE re.driver_id = ? AND r2.track_id = ? AND r2.status = 'complete'
        `).get(dId, sim.similar_track_id) as { starts: number; wins: number };
        wStarts += sh.starts * sim.similarity_weight;
        wWins += sh.wins * sim.similarity_weight;
      }
      return wStarts >= 0.5 ? wWins / wStarts : null;
    }, true);
  }

  const FACTOR_META: Record<string, { label: string; desc: string; weight: string }> = {
    trackHistory:    { label: "Track Win Rate",        desc: "Past wins at this exact track",                   weight: "30%" },
    simTrackHistory: { label: "Similar-Track Win Rate",desc: "Wins at tracks with matching surface/groove",     weight: "25%" },
    seasonWinRate:   { label: "Season Win Rate",        desc: "2026 WoO win % across all events",               weight: "18%" },
    avgFinish:       { label: "Avg Feature Finish",     desc: "Lower avg finish = more consistent podiums",     weight: "12%" },
    last5AvgFinish:  { label: "Last 5 Races",           desc: "Recent form — avg finish in last 5 events",      weight: "12%" },
    qtRate:          { label: "Quick Time Rate",        desc: "% of events where driver is fastest qualifier",  weight: "9%" },
    heatWinRate:     { label: "Heat Win Rate",          desc: "% of heat races won — pace + racecraft indicator",weight: "8%" },
    dnfRisk:         { label: "DNF Risk",               desc: "Mechanical/incident DNF rate — penalty factor",  weight: "−12%" },
  };

  return Object.entries(factors).map(([key, val]) => ({
    factor: FACTOR_META[key]?.label ?? key,
    description: FACTOR_META[key]?.desc ?? "",
    weight: FACTOR_META[key]?.weight ?? "—",
    racesWithData: val.picked,
    timesTopPickWon: val.correct,
    accuracy: val.picked >= 3 ? val.correct / val.picked : null,
  })).sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));
}

// Helper: find driver with best value for a factor, check if they won
function checkFactor(
  _db: ReturnType<typeof getDb>,
  key: string,
  driverIds: number[],
  winnerId: number,
  acc: Record<string, { picked: number; correct: number }>,
  getValue: (id: number) => number | null,
  higherIsBetter: boolean
): void {
  const vals = driverIds
    .map((id) => ({ id, v: getValue(id) }))
    .filter((x) => x.v !== null) as Array<{ id: number; v: number }>;

  if (vals.length < 2) return; // not enough data for this factor in this race

  vals.sort((a, b) => higherIsBetter ? b.v - a.v : a.v - b.v);
  const topPick = vals[0].id;

  acc[key].picked++;
  if (topPick === winnerId) acc[key].correct++;
}

export function computeConditionBreakdown(): ConditionBreakdown[] {
  const db = getDb();

  const conditions = db.prepare(`
    SELECT DISTINCT track_condition FROM races WHERE status = 'complete' ORDER BY track_condition
  `).all() as Array<{ track_condition: string }>;

  return conditions.map(({ track_condition }) => {
    const races = (db.prepare(`SELECT COUNT(*) as n FROM races WHERE status = 'complete' AND track_condition = ?`).get(track_condition) as { n: number }).n;

    const topDrivers = db.prepare(`
      SELECT d.name,
             COUNT(*) as starts,
             SUM(CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END) as wins
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      JOIN drivers d ON d.id = re.driver_id
      WHERE r.status = 'complete' AND r.track_condition = ? AND re.finishing_position IS NOT NULL
      GROUP BY re.driver_id
      HAVING wins > 0
      ORDER BY wins DESC, starts ASC
      LIMIT 8
    `).all(track_condition) as Array<{ name: string; starts: number; wins: number }>;

    return { condition: track_condition, races, topDrivers };
  });
}

export function getDriverFactorTable(): DriverFactorRow[] {
  const db = getDb();

  const drivers = db.prepare(`SELECT id, name FROM drivers WHERE active = 1 ORDER BY name`).all() as Array<{ id: number; name: string }>;

  return drivers.map((d) => {
    const ss = db.prepare(`SELECT starts, wins, quick_times, heat_wins, dnfs, avg_finish, last5_avg_finish FROM driver_season_stats WHERE driver_id = ? AND series = 'WoO Late Models' ORDER BY season DESC LIMIT 1`)
      .get(d.id) as { starts: number; wins: number; quick_times: number; heat_wins: number; dnfs: number; avg_finish: number | null; last5_avg_finish: number | null } | undefined;

    const th = db.prepare(`
      SELECT SUM(starts) as starts, SUM(wins) as wins FROM (
        SELECT COUNT(*) as starts, SUM(CASE WHEN finishing_position = 1 THEN 1 ELSE 0 END) as wins
        FROM race_entries re JOIN races r ON r.id = re.race_id
        WHERE re.driver_id = ? AND r.status = 'complete'
      )
    `).get(d.id) as { starts: number; wins: number };

    return {
      driverId: d.id,
      name: d.name,
      eloRating: 1500, // placeholder; real Elo would require importing computeEloRatings
      seasonWins: ss?.wins ?? 0,
      seasonStarts: ss?.starts ?? 0,
      avgFinish: ss?.avg_finish ?? null,
      last5Avg: ss?.last5_avg_finish ?? null,
      qtRate: ss && ss.starts > 0 ? ss.quick_times / ss.starts : null,
      heatWinRate: ss && ss.starts > 0 ? ss.heat_wins / ss.starts : null,
      dnfRate: ss && ss.starts > 0 ? ss.dnfs / ss.starts : null,
      trackWins: th?.wins ?? 0,
      trackStarts: th?.starts ?? 0,
    };
  }).filter((d) => d.seasonStarts > 0);
}
