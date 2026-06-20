import "server-only";

import { getDb } from "@/lib/db";

export type SeriesYearCoverage = {
  series: string;
  year: string;
  races: number;
  entries: number;
  finishes: number;
  qualifying: number;
  starts: number;
  heats: number;
  finishRate: number;
  qualifyingRate: number;
  startRate: number;
  heatRate: number;
};

export type DataQualityAction = {
  title: string;
  detail: string;
  command?: string;
  priority: "High" | "Medium" | "Low";
};

export type ModelDataQuality = {
  coverage: SeriesYearCoverage[];
  actions: DataQualityAction[];
};

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function getModelDataQuality(): ModelDataQuality {
  const coverage = getDb()
    .prepare(
      `WITH series_norm AS (
         SELECT r.id,
                substr(r.race_date, 1, 4) AS year,
                CASE
                  WHEN COALESCE(r.series_mode, r.division) LIKE '%Lucas%' THEN 'Lucas Oil LMDS'
                  WHEN COALESCE(r.series_mode, r.division) LIKE '%WoO%'
                    OR COALESCE(r.series_mode, r.division) LIKE '%World of Outlaws%' THEN 'WoO Late Models'
                  WHEN COALESCE(r.series_mode, r.division) LIKE '%Summer Nationals%' THEN 'DIRTcar Summer Nationals'
                  WHEN COALESCE(r.series_mode, r.division) LIKE '%Crown%' THEN 'Crown Jewel / Combined'
                  ELSE COALESCE(r.series_mode, r.division)
                END AS series
         FROM races r
         WHERE r.status = 'complete'
       ),
       grouped AS (
         SELECT s.series,
                s.year,
                COUNT(DISTINCT s.id) AS races,
                COUNT(re.id) AS entries,
                SUM(CASE WHEN re.finishing_position IS NOT NULL THEN 1 ELSE 0 END) AS finishes,
                SUM(CASE WHEN re.qualifying_time IS NOT NULL THEN 1 ELSE 0 END) AS qualifying,
                SUM(CASE WHEN re.starting_position IS NOT NULL THEN 1 ELSE 0 END) AS starts,
                SUM(CASE WHEN re.heat_position IS NOT NULL THEN 1 ELSE 0 END) AS heats
         FROM series_norm s
         LEFT JOIN race_entries re ON re.race_id = s.id
         WHERE s.series IN ('Lucas Oil LMDS', 'WoO Late Models', 'DIRTcar Summer Nationals', 'Crown Jewel / Combined')
         GROUP BY s.series, s.year
       )
       SELECT *
       FROM grouped
       ORDER BY
         CASE series
           WHEN 'DIRTcar Summer Nationals' THEN 0
           WHEN 'Lucas Oil LMDS' THEN 1
           WHEN 'WoO Late Models' THEN 2
           ELSE 3
         END,
         year DESC`
    )
    .all() as Array<{
      series: string;
      year: string;
      races: number;
      entries: number;
      finishes: number;
      qualifying: number;
      starts: number;
      heats: number;
    }>;

  const rows = coverage.map((row) => ({
    ...row,
    finishRate: rate(row.finishes, row.entries),
    qualifyingRate: rate(row.qualifying, row.entries),
    startRate: rate(row.starts, row.entries),
    heatRate: rate(row.heats, row.entries),
  }));

  const summerYears = new Set(
    rows
      .filter((row) => row.series === "DIRTcar Summer Nationals")
      .map((row) => row.year)
  );
  const missingSummerBackfill = ["2023", "2022", "2021"].filter((year) => !summerYears.has(year));
  const lowCoverageRows = rows.filter(
    (row) => row.entries > 0 && (row.qualifyingRate < 0.75 || row.heatRate < 0.75 || row.startRate < 0.75)
  );
  const crownGapRows = getDb()
    .prepare(
      `SELECT r.name,
              substr(r.race_date, 1, 10) AS raceDate,
              COUNT(re.id) AS entries,
              SUM(CASE WHEN re.qualifying_time IS NOT NULL THEN 1 ELSE 0 END) AS qualifying,
              SUM(CASE WHEN re.starting_position IS NOT NULL THEN 1 ELSE 0 END) AS starts,
              SUM(CASE WHEN re.heat_position IS NOT NULL THEN 1 ELSE 0 END) AS heats
       FROM races r
       JOIN race_entries re ON re.race_id = r.id
       WHERE r.status = 'complete'
         AND (
           r.division = 'Crown Jewel / Combined'
           OR r.series_mode = 'Crown Jewel / Combined'
           OR lower(r.name) LIKE '%dream%'
           OR lower(r.name) LIKE '%world 100%'
           OR lower(r.name) LIKE '%firecracker%'
           OR lower(r.name) LIKE '%usa nationals%'
           OR lower(r.name) LIKE '%north/south%'
           OR lower(r.name) LIKE '%topless%'
           OR lower(r.name) LIKE '%pdc%'
         )
       GROUP BY r.id
       HAVING entries > 0
          AND (qualifying = 0 OR starts = 0 OR heats = 0)
       ORDER BY r.race_date DESC
       LIMIT 4`
    )
    .all() as Array<{
      name: string;
      raceDate: string;
      entries: number;
      qualifying: number;
      starts: number;
      heats: number;
    }>;

  const actions: DataQualityAction[] = [
    ...(missingSummerBackfill.length > 0
      ? [
          {
            title: "Backfill older Summer Nationals seasons",
            detail: `Summer Nationals is the thin model bucket. Missing seasons: ${missingSummerBackfill.join(", ")}.`,
            command: `python3 scripts/import_summer_nationals.py ${missingSummerBackfill
              .map((year) => `--season ${year}`)
              .join(" ")}`,
            priority: "High" as const,
          },
        ]
      : []),
    ...(lowCoverageRows.length > 0
      ? [
          {
            title: "Repair race-night coverage gaps",
            detail: `${lowCoverageRows.length} series/year groups have weak QT, start, or heat coverage. Prioritize fields that affect race-night ranking.`,
            priority: "Medium" as const,
          },
        ]
      : []),
    ...(crownGapRows.length > 0
      ? [
          {
            title: "Repair Crown replay gaps",
            detail: `Priority races: ${crownGapRows
              .map((row) => `${row.name} (${row.raceDate}: QT ${row.qualifying}/${row.entries}, start ${row.starts}/${row.entries}, heat ${row.heats}/${row.entries})`)
              .join("; ")}.`,
            command: "npm run crown:replay",
            priority: "High" as const,
          },
        ]
      : []),
    {
      title: "Label historic misses before retraining",
      detail: "Use Historical Testing to mark whether QT, start, track/local, or feature-test signals explain misses.",
      priority: "Medium",
    },
    {
      title: "Retrain only after structured data changes",
      detail: "Caveats and one-off notes should stay underwriting until they repeat in historical review.",
      command: "npm run models:train && npm run models:score",
      priority: "Low",
    },
  ];

  return { coverage: rows, actions };
}
