import "server-only";

import { getDb } from "@/lib/db";

export type HistoricalBackfillCandidate = {
  raceId: number;
  raceName: string;
  raceDate: string;
  trackName: string;
  status: string;
  entries: number;
  finishes: number;
  starts: number;
  heats: number;
  qualifying: number;
  priority: "High" | "Medium" | "Low";
  reason: string;
  command: string | null;
};

export type FutureCrownTest = {
  raceId: number;
  raceName: string;
  raceDate: string;
  trackName: string;
  division: string;
  status: string;
  note: string;
};

export type HistoricalBackfillPlan = {
  candidates: HistoricalBackfillCandidate[];
  futureTests: FutureCrownTest[];
};

function isEldoraDream2026(row: { raceId: number; raceName: string }) {
  return row.raceId === 907 || row.raceName.toLowerCase().includes("32nd dirt late model dream");
}

function candidateCommand(row: { raceId: number; raceName: string; trackName: string }) {
  if (row.trackName.toLowerCase().includes("eldora") && isEldoraDream2026(row)) {
    return `npm run import:eldora-box -- --race-id ${row.raceId} --url "https://www.eldoraspeedway.com/event_coverage/32nd-dirt-late-model-dream/"`;
  }
  return null;
}

function gapReason(row: { entries: number; finishes: number; starts: number; heats: number; qualifying: number }) {
  const gaps = [];
  if (row.finishes < row.entries) gaps.push(`finish ${row.finishes}/${row.entries}`);
  if (row.starts < row.entries) gaps.push(`start ${row.starts}/${row.entries}`);
  if (row.heats < row.entries) gaps.push(`heat ${row.heats}/${row.entries}`);
  if (row.qualifying < row.entries) gaps.push(`QT ${row.qualifying}/${row.entries}`);
  return gaps.join(", ");
}

export function getHistoricalBackfillPlan(): HistoricalBackfillPlan {
  const rows = getDb()
    .prepare(
      `SELECT r.id AS raceId,
              r.name AS raceName,
              r.race_date AS raceDate,
              t.name AS trackName,
              r.status,
              COUNT(re.id) AS entries,
              SUM(CASE WHEN re.finishing_position IS NOT NULL THEN 1 ELSE 0 END) AS finishes,
              SUM(CASE WHEN re.starting_position IS NOT NULL THEN 1 ELSE 0 END) AS starts,
              SUM(CASE WHEN re.heat_position IS NOT NULL THEN 1 ELSE 0 END) AS heats,
              SUM(CASE WHEN re.qualifying_time IS NOT NULL THEN 1 ELSE 0 END) AS qualifying
       FROM races r
       JOIN tracks t ON t.id = r.track_id
       JOIN race_entries re ON re.race_id = r.id
       WHERE r.status = 'complete'
         AND (
           r.division = 'Crown Jewel / Combined'
           OR r.series_mode = 'Crown Jewel / Combined'
           OR lower(r.name) LIKE '%dream%'
           OR lower(r.name) LIKE '%world 100%'
           OR lower(r.name) LIKE '%dirt track world%'
           OR lower(r.name) LIKE '%dtwc%'
           OR lower(r.name) LIKE '%firecracker%'
           OR lower(r.name) LIKE '%usa nationals%'
           OR lower(r.name) LIKE '%north/south%'
           OR lower(r.name) LIKE '%topless%'
           OR lower(r.name) LIKE '%pdc%'
         )
       GROUP BY r.id
       HAVING entries > 0
          AND (
            finishes < entries
            OR starts < entries
            OR heats < entries
            OR qualifying < entries
          )
       ORDER BY
         CASE
           WHEN lower(t.name) LIKE '%eldora%' THEN 0
           WHEN lower(r.name) LIKE '%dirt track world%' OR lower(r.name) LIKE '%dtwc%' THEN 1
           ELSE 2
         END,
         r.race_date DESC
       LIMIT 12`
    )
    .all() as Array<{
      raceId: number;
      raceName: string;
      raceDate: string;
      trackName: string;
      status: string;
      entries: number;
      finishes: number;
      starts: number;
      heats: number;
      qualifying: number;
    }>;

  const candidates = rows.map((row) => {
    const command = candidateCommand(row);
    const missingRaceNight = row.starts < row.entries || row.heats < row.entries;
    return {
      ...row,
      priority: command || missingRaceNight ? "High" : "Medium",
      reason: gapReason(row),
      command,
    } satisfies HistoricalBackfillCandidate;
  });

  const futureTests = getDb()
    .prepare(
      `SELECT r.id AS raceId,
              r.name AS raceName,
              r.race_date AS raceDate,
              t.name AS trackName,
              r.division,
              r.status
       FROM races r
       JOIN tracks t ON t.id = r.track_id
       WHERE r.status = 'upcoming'
         AND lower(t.name) LIKE '%west virginia%'
         AND (
           lower(r.name) LIKE '%dirt track world%'
           OR lower(r.name) LIKE '%dtwc%'
           OR lower(r.name) LIKE '%hillbilly%'
         )
       ORDER BY r.race_date ASC`
    )
    .all() as Array<{
      raceId: number;
      raceName: string;
      raceDate: string;
      trackName: string;
      division: string;
      status: string;
    }>;

  return {
    candidates,
    futureTests: futureTests.map((row) => ({
      ...row,
      note: row.raceName.toLowerCase().includes("dirt track world") || row.raceName.toLowerCase().includes("dtwc")
        ? "Future DTWC crown transfer test at WVMS. Use Eldora/DTWC crown history as source history, then judge whether the model travels."
        : "Future WVMS crown-adjacent test. Useful for checking track-specific carryover.",
    })),
  };
}
