import "server-only";

import { artifactAge } from "@/lib/freshness-core";

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getDb } from "@/lib/db";
import { getCachedMlRaceFile, type MlPrediction } from "@/lib/ml-predictions";
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
  selectionThreshold?: number | null;
  headline?: "independent" | "stacked" | null;
  brierMoneylineOnPricedGames?: number | null;
  stackedBrierMoneyline?: number | null; stackedMarketBrierMoneyline?: number | null; stackedMae?: number | null;
  [key: string]: unknown;
};
export type TeamForm = {
  season: number; games: number; wins: number; losses: number; ties: number; avgMargin: number; lastRecord: string;
  last: Array<{ date: string; opponent: string; home: boolean; margin: number }>;
};
export type TeamRatingBrief = { rating: number; sd: number; rank: number };
export type SportRating = { team: string; rating: number; sd: number | null; rank: number; games: number; updatedAt?: string; form?: TeamForm | null; [key: string]: unknown };
export type SportUpcoming = {
  gameId: string; home: string; away: string; startsAt: string;
  projectedHomeMargin: number | null; marginSd: number | null; homeWinProb: number | null;
  marketHomeSpread: number | null; marketHomePrice: number | null; marketAwayPrice: number | null;
  marketHomeMl: number | null; marketAwayMl: number | null; book: string | null; lineObservedAt: string | null;
  homeCoverProb: number | null; awayCoverProb: number | null; pushProb: number | null;
  edgePts: number | null; lean: "home" | "away" | "none" | null; note?: string | null;
  homeRating?: TeamRatingBrief | null; awayRating?: TeamRatingBrief | null;
  homeForm?: TeamForm | null; awayForm?: TeamForm | null; homeAdvantage?: number | null;
  marketHomeWinProb?: number | null; neutral?: number;
  headline?: "independent" | "stacked" | null;
  independentHomeMargin?: number | null; independentHomeWinProb?: number | null;
  stackedHomeMargin?: number | null; stackedHomeWinProb?: number | null;
  stackedMarketHomeWinProb?: number | null; stackedMarketHomeMargin?: number | null;
  [key: string]: unknown;
};
export type SportReport = {
  sport: string; label: string; generatedAt: string; forecastGeneratedAt?: string; modelId: string; modelVersion: string;
  dataThrough: string | null; sources: Array<{ url: string; sha256?: string; retrievedAt?: string }>;
  backtest: SportBacktest | null; ratings: SportRating[]; upcoming: SportUpcoming[]; limitations: string[];
  [key: string]: unknown;
};

// Focus sports first (NFL, college football, NBA, college basketball); NHL and MLB are maintained but secondary.
export const SPORT_ORDER = ["nfl", "ncaaf", "nba", "ncaab", "nhl", "mlb"] as const;
export const SPORT_LABELS: Record<string, string> = {
  racing: "Dirt racing", nfl: "NFL", nba: "NBA", ncaaf: "College football", ncaab: "College basketball", mlb: "MLB", nhl: "NHL",
};

function readJson<T>(relative: string): T | null {
  const file = join(/* turbopackIgnore: true */ process.cwd(), relative);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export type CardPick = {
  id: string; sport: string; sportLabel: string; gameId: string; home: string; away: string; startsAt: string;
  market: "spread"; pick: string; opponent: string; side: "home" | "away";
  line: number; price: number; homeSpread: number; book: string | null; lineObservedAt: string | null; lockedAt: string;
  modelHomeMargin: number; edgePts: number; threshold: number; edgeRatio: number;
  marketAwareAgrees: boolean; marketAwareEdgePts: number | null;
  modelCoverProb: number | null; breakEvenProb: number; stakeUnits: number; rank: number;
  record: { rule: string | null; picks: number; wins: number; losses: number; winRate: number | null; roi: number | null; seasons: [number, number] | null } | null;
  status: "playable" | "edge-gone" | "no-current-line" | "started" | "graded";
  current?: { checkedAt: string; line?: number; price?: number | null; edgePts?: number; lineObservedAt?: string | null };
  result?: { outcome: "win" | "loss" | "push"; homeScore: number; awayScore: number; units: number };
  note?: string | null; [key: string]: unknown;
};
export type DailyCard = {
  date: string; generatedAt: string; forecastsRefreshedAt: string | null; unit: string; rules: string[]; evidence: string;
  priced: number; qualified: number; totalUnits: number;
  record: { days: number; wins: number; losses: number; pushes: number; units: number; staked: number; roi: number | null } | null;
  picks: CardPick[];
};

/** Today's card, written hourly by `python3 -m dirtiq_model card build`. */
export function getDailyCard(): DailyCard | null {
  const card = readJson<DailyCard>("public/data/daily-card.json");
  return card && Array.isArray(card.picks) ? card : null;
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
export type DriverFactor = { feature: string; meaning: string; value: number; raw: number | null };
export type RecentFinish = { date: string; race: string; track: string; finish: number; start: number | null };
export type RaceBoardRow = {
  driverId: number; driverName: string; carNumber: string | null;
  probability: number; top3Probability: number | null; top5Probability: number | null; expectedFinish: number | null;
  startingPosition: number | null; qualifyingTime: number | null; heatPosition: number | null; entryStatus: string;
  factors: DriverFactor[]; recentFinishes: RecentFinish[]; elo: number | null;
  trackStarts: number | null; trackAvgFinish: number | null; last10AvgFinish: number | null;
};
export type RaceBoard = {
  race: Pick<Race, "id" | "name" | "track_name" | "race_date" | "division" | "status" | "is_live" | "betting_status">;
  fieldSize: number; scored: number; stage: string | null; engine: string | null; modelSeries: string | null;
  readiness: { starts: number; qualifying: number; heats: number };
  rows: RaceBoardRow[];
  /** P(row driver finishes ahead of column driver) for the top drivers, when the engine emitted it. */
  pairwise: { driverIds: number[]; probabilities: number[][] } | null;
  calibrationTemperature: number | null;
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

  const staleBefore = new Date(`${today}T12:00:00Z`);
  staleBefore.setUTCDate(staleBefore.getUTCDate() - 3);
  const staleCutoff = staleBefore.toISOString().slice(0, 10);
  const boards: RaceBoard[] = [];
  for (const race of races) {
    if (!isActiveModelTarget(race)) continue;
    // Matches the engine's stale rule: an "upcoming" race more than three days past is not forecast.
    if (race.race_date < staleCutoff) continue;
    const entries = getDb()
      .prepare(
        `SELECT re.driver_id, d.name AS driver_name, re.car_number, re.starting_position, re.qualifying_time, re.heat_position,
                COALESCE(re.entry_status, 'expected') AS entry_status
         FROM race_entries re JOIN drivers d ON d.id = re.driver_id
         WHERE re.race_id = ? AND COALESCE(re.entry_status, 'expected') != 'scratched'`,
      )
      .all(race.id) as Array<{ driver_id: number; driver_name: string; car_number: string | null; starting_position: number | null; qualifying_time: number | null; heat_position: number | null; entry_status: string }>;
    if (entries.length === 0) continue;
    const file = getCachedMlRaceFile(race.id);
    if (!file || file.predictions.size === 0) continue;
    const predictions = file.predictions;
    const first = predictions.values().next().value;
    const rows: RaceBoardRow[] = entries
      .map((entry) => {
        const prediction = predictions.get(entry.driver_id) as (MlPrediction & { factors?: DriverFactor[]; recentFinishes?: RecentFinish[]; elo?: number | null; trackStarts?: number | null; trackAvgFinish?: number | null; last10AvgFinish?: number | null; modelStage?: string }) | undefined;
        if (!prediction) return null;
        return {
          driverId: entry.driver_id, driverName: entry.driver_name, carNumber: entry.car_number,
          probability: prediction.probability, top3Probability: prediction.top3Probability ?? null,
          top5Probability: prediction.top5Probability ?? null, expectedFinish: prediction.expectedFinish ?? null,
          startingPosition: entry.starting_position, qualifyingTime: entry.qualifying_time, heatPosition: entry.heat_position,
          entryStatus: entry.entry_status,
          factors: Array.isArray(prediction.factors) ? prediction.factors : [],
          recentFinishes: Array.isArray(prediction.recentFinishes) ? prediction.recentFinishes : [],
          elo: prediction.elo ?? null, trackStarts: prediction.trackStarts ?? null,
          trackAvgFinish: prediction.trackAvgFinish ?? null, last10AvgFinish: prediction.last10AvgFinish ?? null,
        };
      })
      .filter((row): row is RaceBoardRow => row !== null)
      .sort((a, b) => b.probability - a.probability);
    const raw = file.file as { pairwise?: { driverIds: number[]; probabilities: number[][] } | null; calibrationTemperature?: number | null };
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
      pairwise: raw.pairwise && Array.isArray(raw.pairwise.driverIds) ? raw.pairwise : null,
      calibrationTemperature: raw.calibrationTemperature ?? null,
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

/* ── Live odds snapshots (The Odds API via dirtiq_model.odds) ───────────── */
export type OddsStatus = {
  configured: boolean; checkedAt: string; source: string; error: string | null; setup: string;
  quota: Record<string, string> | null;
  sports: Record<string, { snapshotAt: string; events: number; unresolved: number; openRows: number; matchedEvents: number; linesFilled: number; closesUpdated: number }>;
};
export type OddsEvent = {
  eventId: string; home: string; away: string; startsAt: string; observedAt: string; books: number;
  homeSpread: number | null; homeSpreadPrice: number | null; awaySpreadPrice: number | null; homeMl: number | null; awayMl: number | null;
};
export type OddsSnapshot = { sport: string; generatedAt: string; source: string; book: string; events: OddsEvent[]; unresolvedTeams: Record<string, number> };

export function getOddsStatus(): OddsStatus | null {
  return readJson<OddsStatus>("public/data/odds/status.json");
}

export function getOddsSnapshot(sport: string): OddsSnapshot | null {
  if (!/^[a-z]+$/.test(sport)) return null;
  return readJson<OddsSnapshot>(`public/data/odds/${sport}-latest.json`);
}

/** Index a snapshot by home/away so pages can show the live consensus beside a projection. */
export function oddsByMatchup(snapshot: OddsSnapshot | null): Map<string, OddsEvent> {
  const map = new Map<string, OddsEvent>();
  for (const event of snapshot?.events ?? []) map.set(`${event.home}|${event.away}`, event);
  return map;
}

/* ── Forecast ledger (JSON) ───────────────────────────────────────────── */
export type LedgerRow = {
  id: number; sport: string; event_id: string; event_label: string; event_start: string | null; market: string;
  selection: string; selection_label: string; model_id: string; model_version: string; forecast_at: string;
  prob: number; value: number | null; line: number | null; price: number | null; book: string | null;
  close_line: number | null; close_price: number | null; outcome: string | null; result_value: number | null; settled_at: string | null;
};
export type LedgerEventSummary = { rows: LedgerRow[]; open: number; graded: number; wins: number; losses: number; pushes: number; firstForecastAt: string | null };

export type SportResultGame = { eventId: string; gameId: string; home: string; away: string; startsAt: string | null; homeScore: number; awayScore: number; neutral: number };
export type SportResults = { sport: string; generatedAt: string; days: number; unit: string; games: SportResultGame[] };

/** Final scores of recent games, written by `teams settle` to public/data/results/<sport>.json. */
export function getSportResults(sport: string): SportResults | null {
  if (!/^[a-z]+$/.test(sport)) return null;
  return readJson<SportResults>(`public/data/results/${sport}.json`);
}

export function getAllResultsIndex(): Map<string, SportResultGame> {
  const map = new Map<string, SportResultGame>();
  for (const sport of SPORT_ORDER) {
    for (const g of getSportResults(sport)?.games ?? []) map.set(g.eventId, g);
  }
  return map;
}

export function getLedgerIndex(): Map<string, LedgerEventSummary> {
  const payload = readJson<{ rows: LedgerRow[] }>("public/data/forecast-ledger.json");
  const map = new Map<string, LedgerEventSummary>();
  for (const row of payload?.rows ?? []) {
    const summary = map.get(row.event_id) ?? { rows: [], open: 0, graded: 0, wins: 0, losses: 0, pushes: 0, firstForecastAt: null };
    summary.rows.push(row);
    if (row.outcome === null) summary.open += 1;
    else if (row.outcome === "win") { summary.graded += 1; summary.wins += 1; }
    else if (row.outcome === "loss") { summary.graded += 1; summary.losses += 1; }
    else if (row.outcome === "push") { summary.graded += 1; summary.pushes += 1; }
    if (!summary.firstForecastAt || row.forecast_at < summary.firstForecastAt) summary.firstForecastAt = row.forecast_at;
    map.set(row.event_id, summary);
  }
  return map;
}


/** Deployment-local artifact ages; missing sports must not be hidden by a newer league. */
export function getArtifactFreshness(now = Date.now()) {
  const sports = Object.fromEntries(SPORT_ORDER.map((sport) => {
    const report = getSportReport(sport);
    return [sport, artifactAge(report?.forecastGeneratedAt ?? report?.generatedAt, now)];
  }));
  const card = getDailyCard();
  const racing = readJson<{ refreshedAt?: string }>("public/data/race-refresh.json");
  return { sports, dailyCard: artifactAge(card?.generatedAt, now), raceData: artifactAge(racing?.refreshedAt, now) };
}
