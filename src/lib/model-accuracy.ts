import "server-only";

import { getDb } from "@/lib/db";
import { isActiveModelTarget } from "@/lib/races";

export type AccuracyRaceRow = {
  raceId: number;
  raceName: string;
  raceDate: string;
  division: string;
  trackName: string;
  fieldSize: number;
  winner: string;
  winnerStart: number | null;
  winnerQtRank: number | null;
  earlyFavorite: string;
  earlyFavoriteFinish: number | null;
  earlyWinnerRank: number;
  raceNightFavorite: string;
  raceNightFavoriteFinish: number | null;
  raceNightWinnerRank: number;
  quickTimeDriver: string | null;
  quickTimeFinish: number | null;
  quickTimeWon: boolean | null;
  quickTimeTop3: boolean | null;
  hasQualifying: boolean;
  hasStartingLineup: boolean;
  hasHeatData: boolean;
  missReason: string;
};

export type AccuracySignal = {
  label: string;
  detail: string;
  races: number;
  wins: number;
  top3: number;
  winRate: number | null;
  top3Rate: number | null;
  note: string;
};

export type ModelAccuracyDashboard = {
  summary: {
    races: number;
    entries: number;
    earlyTop1: number;
    earlyTop3: number;
    raceNightTop1: number;
    raceNightTop3: number;
    avgEarlyWinnerRank: number | null;
    avgRaceNightWinnerRank: number | null;
    racesWithQualifying: number;
    racesWithLineup: number;
  };
  signals: AccuracySignal[];
  rows: AccuracyRaceRow[];
};

type HistoryRow = {
  raceId: number;
  raceName: string;
  raceDate: string;
  division: string;
  series_mode: string | null;
  trackId: number;
  trackName: string;
  driverId: number;
  driverName: string;
  finish: number;
  startingPosition: number | null;
  qualifyingTime: number | null;
  heatPosition: number | null;
};

type DriverScore = HistoryRow & {
  priorStarts: number;
  earlyScore: number;
  raceNightScore: number;
  qtRank: number | null;
};

function pct(n: number, d: number) {
  return d > 0 ? n / d : null;
}

function signal(
  label: string,
  detail: string,
  races: number,
  wins: number,
  top3: number,
  note: string
): AccuracySignal {
  return {
    label,
    detail,
    races,
    wins,
    top3,
    winRate: pct(wins, races),
    top3Rate: pct(top3, races),
    note,
  };
}

function rankOf(scored: DriverScore[], driverId: number, key: "earlyScore" | "raceNightScore") {
  const ranked = [...scored].sort((a, b) => b[key] - a[key]);
  const index = ranked.findIndex((row) => row.driverId === driverId);
  return index >= 0 ? index + 1 : ranked.length + 1;
}

function scoreDriver(entry: HistoryRow, qtRank: number | null, history: HistoryRow[]): Omit<
  DriverScore,
  keyof HistoryRow | "qtRank"
> {
  const priorStarts = history.length;
  const priorWins = history.filter((row) => row.finish === 1).length;
  const priorTop3 = history.filter((row) => row.finish <= 3).length;
  const trackHistory = history.filter((row) => row.trackId === entry.trackId);
  const trackStarts = trackHistory.length;
  const trackWins = trackHistory.filter((row) => row.finish === 1).length;
  const trackTop3 = trackHistory.filter((row) => row.finish <= 3).length;
  const recent = history.slice(-5);
  const recentWins3 = recent.slice(-3).filter((row) => row.finish === 1).length;
  const recentTop3 = recent.filter((row) => row.finish <= 3).length;
  const recentAvg = recent.length
    ? recent.reduce((sum, row) => sum + row.finish, 0) / recent.length
    : null;

  let earlyScore = 0.02;
  if (priorStarts > 0) {
    earlyScore += (priorWins / priorStarts) * 0.32;
    earlyScore += (priorTop3 / priorStarts) * 0.22;
    earlyScore += Math.min(0.08, Math.log1p(priorStarts) / Math.log1p(80) * 0.08);
  }
  if (trackStarts > 0) {
    earlyScore += (trackWins / trackStarts) * 0.22;
    earlyScore += (trackTop3 / trackStarts) * 0.14;
  }
  earlyScore += Math.min(0.18, recentWins3 * 0.06);
  earlyScore += Math.min(0.16, recentTop3 * 0.032);
  if (recentAvg !== null) earlyScore += Math.max(0, (25 - recentAvg) / 25) * 0.08;

  let raceNightScore = earlyScore;
  if (qtRank !== null) {
    if (qtRank === 1) raceNightScore += 0.12;
    else if (qtRank <= 3) raceNightScore += 0.08;
    else if (qtRank <= 5) raceNightScore += 0.04;
  }
  if (entry.startingPosition !== null) {
    if (entry.startingPosition === 1) raceNightScore += 0.13;
    else if (entry.startingPosition <= 3) raceNightScore += 0.1;
    else if (entry.startingPosition <= 6) raceNightScore += 0.06;
    else if (entry.startingPosition <= 10) raceNightScore += 0.025;
  }
  if (entry.heatPosition === 1) raceNightScore += 0.035;
  else if (entry.heatPosition !== null && entry.heatPosition <= 3) raceNightScore += 0.018;

  return { priorStarts, earlyScore, raceNightScore };
}

function missReason(row: AccuracyRaceRow, winnerPriorStarts: number) {
  if (row.raceNightWinnerRank <= 3) return "Playable group";
  if (winnerPriorStarts < 3) return "Sparse winner history";
  if (row.quickTimeDriver && row.quickTimeDriver !== row.winner && row.quickTimeTop3) {
    return "Quick time showed speed, winner converted racecraft";
  }
  if (row.winnerStart !== null && row.winnerStart > 8) return "Lineup/passing volatility";
  if (!row.hasQualifying || !row.hasStartingLineup) return "Missing race-night inputs";
  return "Needs feature review";
}

export function getModelAccuracyDashboard(limit = 60): ModelAccuracyDashboard {
  const db = getDb();
  const targetRaceRows = db
    .prepare(
      `SELECT r.id,
              r.division,
              r.series_mode
       FROM races r
       WHERE r.status = 'complete'
         AND EXISTS (
           SELECT 1 FROM race_entries re
           WHERE re.race_id = r.id
             AND re.finishing_position = 1
             AND re.dnf = 0
         )
       ORDER BY r.race_date DESC, r.id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ id: number; division: string | null; series_mode: string | null }>;
  const targetRaceIds = new Set(targetRaceRows.filter(isActiveModelTarget).map((row) => row.id));

  const allRows = db
    .prepare(
      `SELECT r.id AS raceId,
              r.name AS raceName,
              r.race_date AS raceDate,
              r.division,
              r.series_mode,
              r.track_id AS trackId,
              t.name AS trackName,
              re.driver_id AS driverId,
              d.name AS driverName,
              re.finishing_position AS finish,
              re.starting_position AS startingPosition,
              re.qualifying_time AS qualifyingTime,
              re.heat_position AS heatPosition
       FROM race_entries re
       JOIN races r ON r.id = re.race_id
       JOIN tracks t ON t.id = r.track_id
       JOIN drivers d ON d.id = re.driver_id
       WHERE r.status = 'complete'
         AND re.finishing_position IS NOT NULL
         AND re.dnf = 0
       ORDER BY r.race_date ASC, r.id ASC, re.finishing_position ASC`
    )
    .all() as HistoryRow[];
  const activeRows = allRows.filter(isActiveModelTarget);

  const races = new Map<number, HistoryRow[]>();
  for (const row of activeRows) {
    races.set(row.raceId, [...(races.get(row.raceId) ?? []), row]);
  }

  const rows: AccuracyRaceRow[] = [];
  const historyByDriver = new Map<number, HistoryRow[]>();
  let entriesTotal = 0;
  let earlyTop1 = 0;
  let earlyTop3 = 0;
  let raceNightTop1 = 0;
  let raceNightTop3 = 0;
  let earlyRankSum = 0;
  let raceNightRankSum = 0;
  let racesWithQualifying = 0;
  let racesWithLineup = 0;
  let quickTimeRaces = 0;
  let quickTimeWins = 0;
  let quickTimeTop3 = 0;
  let poleRaces = 0;
  let poleWins = 0;
  let poleTop3 = 0;
  let heatWinnerRaces = 0;
  let heatWinnerWins = 0;
  let heatWinnerTop3 = 0;

  for (const [raceId, entries] of races) {
    if (entries.length < 2) {
      for (const entry of entries) {
        historyByDriver.set(entry.driverId, [...(historyByDriver.get(entry.driverId) ?? []), entry]);
      }
      continue;
    }

    if (targetRaceIds.has(raceId)) {
      const qtEntries = entries
        .filter((entry) => entry.qualifyingTime !== null)
        .sort((a, b) => Number(a.qualifyingTime) - Number(b.qualifyingTime));
      const qtRankMap = new Map(qtEntries.map((entry, index) => [entry.driverId, index + 1]));
      const hasQualifying = qtEntries.length >= Math.ceil(entries.length * 0.5);
      const hasStartingLineup =
        entries.filter((entry) => entry.startingPosition !== null).length >= Math.ceil(entries.length * 0.5);
      const hasHeatData = entries.filter((entry) => entry.heatPosition !== null).length >= Math.ceil(entries.length * 0.5);

      if (hasQualifying) racesWithQualifying++;
      if (hasStartingLineup) racesWithLineup++;

      const scored = entries.map((entry) => {
        const qtRank = qtRankMap.get(entry.driverId) ?? null;
        const history = historyByDriver.get(entry.driverId) ?? [];
        return { ...entry, qtRank, ...scoreDriver(entry, qtRank, history) };
      });
      const earlyRanked = [...scored].sort((a, b) => b.earlyScore - a.earlyScore);
      const raceNightRanked = [...scored].sort((a, b) => b.raceNightScore - a.raceNightScore);
      const winner = entries[0];
      const winnerScored = scored.find((entry) => entry.driverId === winner.driverId);
      const earlyWinnerRank = rankOf(scored, winner.driverId, "earlyScore");
      const raceNightWinnerRank = rankOf(scored, winner.driverId, "raceNightScore");
      const quickTime = qtEntries[0] ?? null;
      const pole = entries.find((entry) => entry.startingPosition === 1) ?? null;
      const heatWinners = entries.filter((entry) => entry.heatPosition === 1);

      if (quickTime) {
        quickTimeRaces++;
        if (quickTime.finish === 1) quickTimeWins++;
        if (quickTime.finish <= 3) quickTimeTop3++;
      }
      if (pole) {
        poleRaces++;
        if (pole.finish === 1) poleWins++;
        if (pole.finish <= 3) poleTop3++;
      }
      if (heatWinners.length > 0) {
        heatWinnerRaces++;
        if (winner.heatPosition === 1) heatWinnerWins++;
        if (entries.some((entry) => entry.finish <= 3 && entry.heatPosition === 1)) heatWinnerTop3++;
      }

      const row: AccuracyRaceRow = {
        raceId,
        raceName: winner.raceName,
        raceDate: winner.raceDate,
        division: winner.division,
        trackName: winner.trackName,
        fieldSize: entries.length,
        winner: winner.driverName,
        winnerStart: winner.startingPosition,
        winnerQtRank: qtRankMap.get(winner.driverId) ?? null,
        earlyFavorite: earlyRanked[0]?.driverName ?? "Unknown",
        earlyFavoriteFinish: earlyRanked[0]?.finish ?? null,
        earlyWinnerRank,
        raceNightFavorite: raceNightRanked[0]?.driverName ?? "Unknown",
        raceNightFavoriteFinish: raceNightRanked[0]?.finish ?? null,
        raceNightWinnerRank,
        quickTimeDriver: quickTime?.driverName ?? null,
        quickTimeFinish: quickTime?.finish ?? null,
        quickTimeWon: quickTime ? quickTime.finish === 1 : null,
        quickTimeTop3: quickTime ? quickTime.finish <= 3 : null,
        hasQualifying,
        hasStartingLineup,
        hasHeatData,
        missReason: "Needs feature review",
      };
      row.missReason = missReason(row, winnerScored?.priorStarts ?? 0);
      rows.push(row);

      entriesTotal += entries.length;
      earlyTop1 += earlyWinnerRank === 1 ? 1 : 0;
      earlyTop3 += earlyWinnerRank <= 3 ? 1 : 0;
      raceNightTop1 += raceNightWinnerRank === 1 ? 1 : 0;
      raceNightTop3 += raceNightWinnerRank <= 3 ? 1 : 0;
      earlyRankSum += earlyWinnerRank;
      raceNightRankSum += raceNightWinnerRank;
    }

    for (const entry of entries) {
      historyByDriver.set(entry.driverId, [...(historyByDriver.get(entry.driverId) ?? []), entry]);
    }
  }

  rows.sort((a, b) => b.raceDate.localeCompare(a.raceDate) || b.raceId - a.raceId);
  const racesCount = rows.length;

  return {
    summary: {
      races: racesCount,
      entries: entriesTotal,
      earlyTop1,
      earlyTop3,
      raceNightTop1,
      raceNightTop3,
      avgEarlyWinnerRank: racesCount ? earlyRankSum / racesCount : null,
      avgRaceNightWinnerRank: racesCount ? raceNightRankSum / racesCount : null,
      racesWithQualifying,
      racesWithLineup,
    },
    signals: [
      signal(
        "Quick Time",
        "Fastest qualifier in the current event",
        quickTimeRaces,
        quickTimeWins,
        quickTimeTop3,
        "Best treated as speed confirmation, not an auto-win."
      ),
      signal(
        "Pole",
        "Driver starting first",
        poleRaces,
        poleWins,
        poleTop3,
        "Strong when track position matters; weaker if surface widens."
      ),
      signal(
        "Heat Win Signal",
        "Whether feature winners and podiums came from heat winners",
        heatWinnerRaces,
        heatWinnerWins,
        heatWinnerTop3,
        "Useful for race-night pace, but needs heat/group context."
      ),
    ],
    rows,
  };
}
