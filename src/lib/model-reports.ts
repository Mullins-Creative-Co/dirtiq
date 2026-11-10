import "server-only";

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getDb } from "@/lib/db";
import { getCachedMlPredictions } from "@/lib/ml-predictions";
import { isActiveModelTarget, todayDateString, type Race } from "@/lib/races";

/** The only reader of the JSON artifacts the Python engines write.
 *  Every function returns null or an empty list when an artifact is missing so the
 *  UI renders an honest "not generated yet" state instead of crashing. */

export type CalibrationBin = { lo: number; hi: number; n: number; predicted: number | null; observed: number | null };

export type ModelHealthEntry = {
  sport: string; modelId: string; market: string; modelVersion: string;
  forecasts: number; open: number; settled: number; wins: number; losses: number; pushes: number;
  brier: number | null; logLoss: number | null; ece: number | null; calibration: CalibrationBin[];
  mae: number | null; pricedForecasts: number; units: number | null; roi: number | null;
  clvCount: number; clvAvg: number | null; firstForecastAt: string; lastForecastAt: string;
};
export type ModelHealth = { generatedAt: string; models: ModelHealthEntry[] };

export type RacingSeriesReport = {
  series: string; slug: string; stage: string; races: number; entries: number; seasons: number[];
  logLoss: number | null; legacyLogLoss: number | null; uniformLogLoss: number | null;
  top1: number | null; legacyTop1: number | null; top3Overlap: number | null; brier: number | null; ece: number | null;
  calibration: CalibrationBin[];
  bySeason: Array<{ season: number; races: number; logLoss: number | null; top1: number | null }>;
  features: Array<{ name: string; weight: number }>;
  [key: string]: unknown;
};
export type RacingReport = {
  generatedAt: string; modelId: string; modelVersion: string;
  series: RacingSeriesReport[]; limitations: string[]; [key: string]: unknown;
};

export type SportSelections = { rule?: string; n: number; wins: number; losses: number; pushes: number; units: number | null; roi: number | null; [key: string]: unknown };
export type SportSeason = { season: number; games: number; mae: number | null; marketMae: number | null; brierSpread?: number | null; selections?: SportSelections | null; [key: string]: unknown };
export type SportBacktest = {
  seasons: number[]; games: number; mae: number | null; marketMae: number | null;
  brierSpread: number | null; marketBrierSpread: number | null;
  brierMoneyline: number | null; marketBrierMoneyline: number | null; logLossMoneyline: number | null;
  ece: number | null; calibration: CalibrationBin[]; selections: SportSelections | null;
  bySeason: SportSeason[]; variants: Array<{ id: string; mae?: number | null; [key: string]: unknown }>;
  [key: string]: unknown;
};
export type SportRating = { team: string; rating: number; sd: number | null; rank: number; games: number; updatedAt?: string; [key: string]: unknown };
export type SportUpcoming = {
  gameId: string; home: string; away: string; startsAt: string;
  projectedHomeMargin: number | null; marginSd: number | null; homeWinProb: number | null;
  marketHomeSpread: number | null; marketHomePrice: number | null; marketAwayPrice: number | null;
  marketHomeMl: number | null; marketAwayMl: number | null; book: string | null; lineObservedAt: string | null;
  homeCoverProb: number | null; awayCoverProb: number | null; pushProb: number | null;
  edgePts: number | null; lean: "home" | "away" | "none" | null; note?: string | null; [key: string]: unknown;
};
export type SportReport = {
  sport: string; label: string; generatedAt: string; modelId: string; modelVersion: string;
  dataThrough: string | null; sources: Array<{ url: string; sha256?: string; retrievedAt?: string }>;
  backtest: SportBacktest | null; ratings: SportRating[]; upcoming: SportUpcoming[]; limitations: string[];
  [key: string]: unknown;
};

export const SPORT_ORDER = ["nfl", "nba", "ncaaf", "ncaab", "mlb", "nhl"] as const;
export const SPORT_LABELS: Record<string, string> = {
  racing: "Dirt racing", nfl: "NFL", nba: "NBA", ncaaf: "College football", ncaab: "College basketball", mlb: "MLB", nhl: "NHL",
};

function readJson<T>(relative: string): T | null {
  const file = join(process.cwd(), relative);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function getModelHealth(): ModelHealth | null {
  return readJson<ModelHealth>("public/data/model-health.json");
}

export function getRacingReport(): RacingReport | null {
  return readJson<RacingReport>("public/data/racing-model-report.json");
}

export function getSportReport(sport: string): SportReport | null {
  if (!/^[a-z]+$/.test(sport)) return null;
  const report = readJson<SportReport>(`public/sports/${sport}.json`);
  if (!report) return null;
  return {
    ...report,
    label: report.label ?? SPORT_LABELS[sport] ?? sport.toUpperCase(),
    ratings: Array.isArray(report.ratings) ? report.ratings : [],
    upcoming: Array.isArray(report.upcoming) ? report.upcoming : [],
    limitations: Array.isArray(report.limitations) ? report.limitations : [],
    sources: Array.isArray(report.sources) ? report.sources : [],
  };
}

export function listSportReports(): SportReport[] {
  const dir = join(process.cwd(), "public/sports");
  if (!existsSync(dir)) return [];
  const sports = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));
  const ordered = [...sports].sort((a, b) => {
    const ia = SPORT_ORDER.indexOf(a as (typeof SPORT_ORDER)[number]);
    const ib = SPORT_ORDER.indexOf(b as (typeof SPORT_ORDER)[number]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return ordered.map((sport) => getSportReport(sport)).filter((report): report is SportReport => report !== null);
}

/** Upcoming races the racing model can forecast, with the model's top entrants. */
export type RaceBoardRow = {
  driverId: number; driverName: string; carNumber: string | null;
  probability: number; top3Probability: number | null; expectedFinish: number | null;
  startingPosition: number | null; entryStatus: string;
};
export type RaceBoard = {
  race: Pick<Race, "id" | "name" | "track_name" | "race_date" | "division" | "status" | "is_live" | "betting_status">;
  fieldSize: number; scored: number; stage: string | null; engine: string | null; modelSeries: string | null;
  readiness: { starts: number; qualifying: number; heats: number };
  rows: RaceBoardRow[];
};

export function getUpcomingRaceBoards(limit = 6, topN = 5): RaceBoard[] {
  const today = todayDateString();
  const races = getDb()
    .prepare(
      `SELECT r.id, r.name, r.race_date, r.division, r.series_mode, r.status, r.is_live, r.betting_status, t.name AS track_name
       FROM races r JOIN tracks t ON t.id = r.track_id
       WHERE r.status = 'upcoming'
       ORDER BY CASE WHEN r.race_date >= ? THEN 0 ELSE 1 END, ABS(julianday(r.race_date) - julianday(?)) ASC, r.id ASC`,
    )
    .all(today, today) as Array<Race & { series_mode: string | null }>;

  const boards: RaceBoard[] = [];
  for (const race of races) {
    if (!isActiveModelTarget(race)) continue;
    const entries = getDb()
      .prepare(
        `SELECT re.driver_id, d.name AS driver_name, re.car_number, re.starting_position, re.qualifying_time, re.heat_position,
                COALESCE(re.entry_status, 'expected') AS entry_status
         FROM race_entries re JOIN drivers d ON d.id = re.driver_id
         WHERE re.race_id = ? AND COALESCE(re.entry_status, 'expected') != 'scratched'`,
      )
      .all(race.id) as Array<{ driver_id: number; driver_name: string; car_number: string | null; starting_position: number | null; qualifying_time: number | null; heat_position: number | null; entry_status: string }>;
    if (entries.length === 0) continue;
    const predictions = getCachedMlPredictions(race.id);
    if (predictions.size === 0) continue;
    const first = predictions.values().next().value;
    const rows: RaceBoardRow[] = entries
      .map((entry) => {
        const prediction = predictions.get(entry.driver_id) as (ReturnType<typeof predictions.get> & { top3Probability?: number; expectedFinish?: number; modelStage?: string }) | undefined;
        if (!prediction) return null;
        return {
          driverId: entry.driver_id, driverName: entry.driver_name, carNumber: entry.car_number,
          probability: prediction.probability, top3Probability: prediction.top3Probability ?? null,
          expectedFinish: prediction.expectedFinish ?? null,
          startingPosition: entry.starting_position, entryStatus: entry.entry_status,
        };
      })
      .filter((row): row is RaceBoardRow => row !== null)
      .sort((a, b) => b.probability - a.probability);
    boards.push({
      race: { id: race.id, name: race.name, track_name: race.track_name, race_date: race.race_date, division: race.division, status: race.status, is_live: race.is_live, betting_status: race.betting_status },
      fieldSize: entries.length, scored: rows.length,
      stage: (first as { modelStage?: string } | undefined)?.modelStage ?? null,
      engine: first?.modelEngine ?? null, modelSeries: first?.modelSeries ?? null,
      readiness: {
        starts: entries.filter((e) => e.starting_position !== null).length,
        qualifying: entries.filter((e) => e.qualifying_time !== null).length,
        heats: entries.filter((e) => e.heat_position !== null).length,
      },
      rows: rows.slice(0, topN),
    });
    if (boards.length >= limit) break;
  }
  return boards;
}

export type RecentRaceResult = {
  raceId: number; name: string; trackName: string; raceDate: string; division: string;
  winner: string; winnerStart: number | null; fieldSize: number;
};

export function getRecentRaceResults(limit = 6): RecentRaceResult[] {
  return getDb()
    .prepare(
      `SELECT r.id AS raceId, r.name, t.name AS trackName, r.race_date AS raceDate, r.division,
              d.name AS winner, re.starting_position AS winnerStart,
              (SELECT COUNT(*) FROM race_entries x WHERE x.race_id = r.id) AS fieldSize
       FROM races r JOIN tracks t ON t.id = r.track_id
       JOIN race_entries re ON re.race_id = r.id AND re.finishing_position = 1
       JOIN drivers d ON d.id = re.driver_id
       WHERE r.status = 'complete'
       ORDER BY r.race_date DESC, r.id DESC LIMIT ?`,
    )
    .all(limit) as RecentRaceResult[];
}

export function getRacingDataSummary() {
  const row = getDb()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM races WHERE status = 'complete') AS races,
              (SELECT COUNT(*) FROM race_entries re JOIN races r ON r.id = re.race_id WHERE r.status = 'complete') AS entries,
              (SELECT COUNT(*) FROM drivers) AS drivers,
              (SELECT COUNT(*) FROM tracks) AS tracks,
              (SELECT MAX(race_date) FROM races WHERE status = 'complete') AS latest`,
    )
    .get() as { races: number; entries: number; drivers: number; tracks: number; latest: string | null };
  return row;
}
