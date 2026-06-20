import "server-only";

import { getDb } from "@/lib/db";

type RaceContext = {
  id: number;
  name: string;
  track_id: number;
  track_name: string;
  race_date: string;
};

export type PatternWinnerRow = {
  raceId: number;
  raceName: string;
  raceDate: string;
  month: string;
  winner: string;
  driverId: number;
  seasonWinsAtRaceTime: number;
  wonPreviousEvent: boolean;
  wonInLast5: boolean;
  priorWinAtTrack: boolean;
  priorTop3AtTrack: boolean;
  priorSimilarTrackTop3: boolean;
  startingPosition: number | null;
};

export type PatternCriterion = {
  key: string;
  label: string;
  matched: number;
  total: number;
  rate: number;
};

export type PatternFieldFit = {
  driverId: number;
  driverName: string;
  carNumber: string | null;
  fit: "Full" | "Partial" | "Eliminated";
  matched: number;
  total: number;
  missing: string[];
  seasonWinsAtRaceTime: number;
  wonPreviousEvent: boolean;
  wonInLast5: boolean;
  priorWinAtTrack: boolean;
  priorTop3AtTrack: boolean;
  priorSimilarTrackTop3: boolean;
  lucasStanding: number | null;
  lucasWins: number | null;
};

export type PatternAnalysis = {
  lookback: number;
  basis: string;
  bridgeNote: string;
  winners: PatternWinnerRow[];
  criteria: PatternCriterion[];
  field: PatternFieldFit[];
};

type CompletedEntry = {
  race_id: number;
  race_name: string;
  race_date: string;
  track_id: number;
  track_name: string;
  driver_id: number;
  driver_name: string;
  finishing_position: number;
  starting_position: number | null;
};

type DriverSignal = {
  seasonWinsAtRaceTime: number;
  wonPreviousEvent: boolean;
  wonInLast5: boolean;
  priorWinAtTrack: boolean;
  priorTop3AtTrack: boolean;
  priorSimilarTrackTop3: boolean;
};

const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long" });

function monthName(date: string) {
  return monthFmt.format(new Date(`${date}T12:00:00`));
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function eventTokens(name: string) {
  return normalize(name)
    .split(" ")
    .filter((token) => token.length >= 5 && !["annual", "night", "classic", "feature", "finale"].includes(token))
    .slice(0, 4);
}

function completedWinnerRows(race: RaceContext, lookback: number) {
  const db = getDb();
  const tokens = eventTokens(race.name);
  const tokenClause = tokens.map(() => "lower(r.name) LIKE ?").join(" OR ");
  const params: (string | number)[] = [race.track_id, race.race_date, race.id];
  if (tokens.length > 0) params.push(...tokens.map((token) => `%${token}%`));
  params.push(lookback);

  const rows = db.prepare(`
    SELECT r.id AS race_id,
           r.name AS race_name,
           r.race_date,
           t.id AS track_id,
           t.name AS track_name,
           e.driver_id,
           d.name AS driver_name,
           e.finishing_position,
           e.starting_position
    FROM race_entries e
    JOIN races r ON r.id = e.race_id
    JOIN tracks t ON t.id = r.track_id
    JOIN drivers d ON d.id = e.driver_id
    WHERE r.status = 'complete'
      AND r.track_id = ?
      AND r.race_date < ?
      AND r.id != ?
      AND e.finishing_position = 1
      ${tokens.length > 0 ? `AND (${tokenClause})` : ""}
    ORDER BY r.race_date DESC, r.id DESC
    LIMIT ?
  `).all(...params) as CompletedEntry[];

  if (rows.length >= Math.min(3, lookback)) {
    return { rows, basis: `same event family at ${race.track_name}` };
  }

  const fallback = db.prepare(`
    SELECT r.id AS race_id,
           r.name AS race_name,
           r.race_date,
           t.id AS track_id,
           t.name AS track_name,
           e.driver_id,
           d.name AS driver_name,
           e.finishing_position,
           e.starting_position
    FROM race_entries e
    JOIN races r ON r.id = e.race_id
    JOIN tracks t ON t.id = r.track_id
    JOIN drivers d ON d.id = e.driver_id
    WHERE r.status = 'complete'
      AND r.track_id = ?
      AND r.race_date < ?
      AND r.id != ?
      AND e.finishing_position = 1
    ORDER BY r.race_date DESC, r.id DESC
    LIMIT ?
  `).all(race.track_id, race.race_date, race.id, lookback) as CompletedEntry[];

  return { rows: fallback, basis: `all completed late-model races at ${race.track_name}` };
}

function driverSignalAt(driverId: number, trackId: number, raceDate: string): DriverSignal {
  const db = getDb();
  const year = Number(raceDate.slice(0, 4));
  const seasonWins = db.prepare(`
    SELECT COUNT(*) AS n
    FROM race_entries e
    JOIN races r ON r.id = e.race_id
    WHERE e.driver_id = ?
      AND r.status = 'complete'
      AND substr(r.race_date, 1, 4) = ?
      AND r.race_date < ?
      AND e.finishing_position = 1
  `).get(driverId, String(year), raceDate) as { n: number } | undefined;

  const prior = db.prepare(`
    SELECT r.race_date, r.track_id, e.finishing_position
    FROM race_entries e
    JOIN races r ON r.id = e.race_id
    WHERE e.driver_id = ?
      AND r.status = 'complete'
      AND r.race_date < ?
      AND e.finishing_position IS NOT NULL
    ORDER BY r.race_date DESC, r.id DESC
    LIMIT 8
  `).all(driverId, raceDate) as Array<{ race_date: string; track_id: number; finishing_position: number }>;

  const sameTrack = db.prepare(`
    SELECT e.finishing_position
    FROM race_entries e
    JOIN races r ON r.id = e.race_id
    WHERE e.driver_id = ?
      AND r.status = 'complete'
      AND r.track_id = ?
      AND r.race_date < ?
      AND e.finishing_position IS NOT NULL
  `).all(driverId, trackId, raceDate) as Array<{ finishing_position: number }>;

  const similar = db.prepare(`
    SELECT e.finishing_position
    FROM race_entries e
    JOIN races r ON r.id = e.race_id
    JOIN track_similars ts ON (
      (ts.track_id = ? AND ts.similar_track_id = r.track_id)
      OR (ts.similar_track_id = ? AND ts.track_id = r.track_id)
    )
    WHERE e.driver_id = ?
      AND r.status = 'complete'
      AND r.race_date < ?
      AND e.finishing_position IS NOT NULL
      AND ts.similarity_weight >= 0.65
  `).all(trackId, trackId, driverId, raceDate) as Array<{ finishing_position: number }>;

  return {
    seasonWinsAtRaceTime: seasonWins?.n ?? 0,
    wonPreviousEvent: prior[0]?.finishing_position === 1,
    wonInLast5: prior.slice(0, 5).some((row) => row.finishing_position === 1),
    priorWinAtTrack: sameTrack.some((row) => row.finishing_position === 1),
    priorTop3AtTrack: sameTrack.some((row) => row.finishing_position <= 3),
    priorSimilarTrackTop3: similar.some((row) => row.finishing_position <= 3),
  };
}

function buildCriteria(winners: PatternWinnerRow[]): PatternCriterion[] {
  const raw: PatternCriterion[] = [
    {
      key: "seasonWinsAtRaceTime",
      label: "Had a season win before this race",
      matched: winners.filter((row) => row.seasonWinsAtRaceTime > 0).length,
      total: winners.length,
      rate: 0,
    },
    {
      key: "wonPreviousEvent",
      label: "Won previous completed start",
      matched: winners.filter((row) => row.wonPreviousEvent).length,
      total: winners.length,
      rate: 0,
    },
    {
      key: "wonInLast5",
      label: "Won within last 5 completed starts",
      matched: winners.filter((row) => row.wonInLast5).length,
      total: winners.length,
      rate: 0,
    },
    {
      key: "priorWinAtTrack",
      label: "Had prior win at this track",
      matched: winners.filter((row) => row.priorWinAtTrack).length,
      total: winners.length,
      rate: 0,
    },
    {
      key: "priorTrackOrSimilarTop3",
      label: "Had top-3 at this track or similar track",
      matched: winners.filter((row) => row.priorTop3AtTrack || row.priorSimilarTrackTop3).length,
      total: winners.length,
      rate: 0,
    },
  ];

  const knownStarts = winners.filter((row) => row.startingPosition !== null);
  if (knownStarts.length > 0) {
    raw.push({
      key: "startedTop10",
      label: "Started top 10 when start was known",
      matched: knownStarts.filter((row) => (row.startingPosition ?? 999) <= 10).length,
      total: knownStarts.length,
      rate: 0,
    });
  }

  return raw
    .map((criterion) => ({
      ...criterion,
      rate: criterion.total > 0 ? criterion.matched / criterion.total : 0,
    }))
    .filter((criterion) => criterion.total > 0 && criterion.rate >= 0.75);
}

function fieldSignalMatches(signal: DriverSignal, criterionKey: string, startingPosition: number | null) {
  switch (criterionKey) {
    case "seasonWinsAtRaceTime":
      return signal.seasonWinsAtRaceTime > 0;
    case "wonPreviousEvent":
      return signal.wonPreviousEvent;
    case "wonInLast5":
      return signal.wonInLast5;
    case "priorWinAtTrack":
      return signal.priorWinAtTrack;
    case "priorTrackOrSimilarTop3":
      return signal.priorTop3AtTrack || signal.priorSimilarTrackTop3;
    case "startedTop10":
      return startingPosition !== null && startingPosition <= 10;
    default:
      return false;
  }
}

export function getPatternAnalysis(
  race: RaceContext,
  entries: Array<{ driver_id: number; driver_name: string; car_number: string | null; starting_position: number | null }>,
  lookback = 10
): PatternAnalysis {
  const db = getDb();
  const { rows, basis } = completedWinnerRows(race, lookback);
  const winners = rows.map((row) => {
    const signal = driverSignalAt(row.driver_id, row.track_id, row.race_date);
    return {
      raceId: row.race_id,
      raceName: row.race_name,
      raceDate: row.race_date,
      month: monthName(row.race_date),
      winner: row.driver_name,
      driverId: row.driver_id,
      startingPosition: row.starting_position,
      ...signal,
    };
  });
  const criteria = buildCriteria(winners);

  const standings = db.prepare(`
    SELECT driver_id, points_pos, wins
    FROM driver_season_stats
    WHERE season = 2026
      AND lower(series) LIKE '%lucas%'
  `).all() as Array<{ driver_id: number; points_pos: number | null; wins: number | null }>;
  const standingMap = new Map(standings.map((row) => [row.driver_id, row]));

  const field = entries.map((entry) => {
    const signal = driverSignalAt(entry.driver_id, race.track_id, race.race_date);
    const missing = criteria
      .filter((criterion) => !fieldSignalMatches(signal, criterion.key, entry.starting_position))
      .map((criterion) => criterion.label);
    const matched = criteria.length - missing.length;
    const fit: PatternFieldFit["fit"] =
      criteria.length === 0 ? "Partial" :
      missing.length === 0 ? "Full" :
      matched >= Math.ceil(criteria.length * 0.5) ? "Partial" :
      "Eliminated";
    const standing = standingMap.get(entry.driver_id);

    return {
      driverId: entry.driver_id,
      driverName: entry.driver_name,
      carNumber: entry.car_number,
      fit,
      matched,
      total: criteria.length,
      missing,
      ...signal,
      lucasStanding: standing?.points_pos ?? null,
      lucasWins: standing?.wins ?? null,
    };
  }).sort((a, b) => {
    const fitRank = { Full: 0, Partial: 1, Eliminated: 2 };
    return fitRank[a.fit] - fitRank[b.fit] || b.matched - a.matched || a.driverName.localeCompare(b.driverName);
  });

  return {
    lookback,
    basis,
    bridgeNote: "Cross-series results at the same track count as track evidence. Similar-track results count only as a bridge signal, not as a direct Lucas/WoO replacement.",
    winners,
    criteria,
    field,
  };
}
