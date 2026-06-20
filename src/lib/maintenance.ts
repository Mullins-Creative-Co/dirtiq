import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";
import { isActiveModelTarget } from "@/lib/races";
import { isCombinedSeries, isCrownJewelRaceName, racePrimarySeries, SERIES } from "@/lib/series";

const PREDICTION_CACHE_DIR = path.join(process.cwd(), "data", "ml-predictions");

export type MaintenanceRaceRoute = {
  id: number;
  name: string;
  raceDate: string;
  division: string;
  entries: number;
  modelSeries: string;
  modelReason: string;
  cachePath: string;
  cacheExists: boolean;
};

export type MaintenanceStatus = {
  routes: MaintenanceRaceRoute[];
  counts: {
    upcoming: number;
    upcomingWithEntries: number;
    cached: number;
    lucas: number;
    woo: number;
    crown: number;
    summer: number;
  };
};

export type ProductionChecklistItem = {
  label: string;
  status: "done" | "pending" | "blocked";
  detail: string;
  href?: string;
};

export type ProductionLinePreview = {
  driverName: string;
  marketOdds: string;
  entryStatus: string;
  rationale: string | null;
};

export type ProductionChecklist = {
  raceId: number;
  raceName: string;
  raceDate: string;
  trackName: string;
  division: string | null;
  entries: number;
  activeEntries: number;
  scratchedEntries: number;
  lineCount: number;
  predictionCacheExists: boolean;
  items: ProductionChecklistItem[];
  nextActions: ProductionChecklistItem[];
  topLines: ProductionLinePreview[];
};

function slug(series: string) {
  return series.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function firstExistingPredictionCache(raceId: number, modelSlug: string) {
  const candidates = [
    `race_${raceId}_${modelSlug}.json`,
    `race_${raceId}.json`,
  ];
  const cacheFile = candidates.find((candidate) => existsSync(path.join(PREDICTION_CACHE_DIR, candidate)));

  return {
    cachePath: path.join("data", "ml-predictions", cacheFile ?? candidates[0]),
    cacheExists: Boolean(cacheFile),
  };
}

export function resolveRaceModelForMaintenance(race: {
  name: string;
  division: string | null;
  series_mode: string | null;
}) {
  if (isCrownJewelRaceName(race.name)) {
    return { modelSeries: SERIES.combined, modelReason: "crown jewel event name" };
  }

  const primary = racePrimarySeries(race.series_mode ?? race.division);
  if (primary) return { modelSeries: primary, modelReason: "race series" };

  if (isCombinedSeries(race.series_mode ?? race.division)) {
    return { modelSeries: SERIES.combined, modelReason: "open/independent late model race" };
  }

  return { modelSeries: SERIES.woo, modelReason: "late model fallback" };
}

export function getMaintenanceStatus(limit = 30): MaintenanceStatus {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.name, r.race_date, r.division, r.series_mode,
              COUNT(re.id) AS entries
       FROM races r
       LEFT JOIN race_entries re ON re.race_id = r.id
       WHERE r.status = 'upcoming'
       GROUP BY r.id
       ORDER BY r.race_date ASC, r.id ASC
       LIMIT ?`
    )
    .all(limit) as Array<{
      id: number;
      name: string;
      race_date: string;
      division: string;
      series_mode: string | null;
      entries: number;
    }>;

  const routes = rows.filter(isActiveModelTarget).map((race) => {
    const resolved = resolveRaceModelForMaintenance(race);
    const modelSlug = slug(resolved.modelSeries);
    const { cachePath, cacheExists } = firstExistingPredictionCache(race.id, modelSlug);

    return {
      id: race.id,
      name: race.name,
      raceDate: race.race_date,
      division: race.division,
      entries: race.entries,
      modelSeries: resolved.modelSeries,
      modelReason: resolved.modelReason,
      cachePath,
      cacheExists,
    };
  });

  return {
    routes,
    counts: {
      upcoming: routes.length,
      upcomingWithEntries: routes.filter((route) => route.entries > 0).length,
      cached: routes.filter((route) => route.cacheExists).length,
      lucas: routes.filter((route) => route.modelSeries === SERIES.lucas).length,
      woo: routes.filter((route) => route.modelSeries === SERIES.woo).length,
      crown: routes.filter((route) => route.modelSeries === SERIES.combined).length,
      summer: routes.filter((route) => route.modelSeries === SERIES.summer).length,
    },
  };
}

export function getProductionChecklist(raceId = 874): ProductionChecklist | null {
  const db = getDb();
  const race = db
    .prepare(
      `SELECT r.id, r.name, r.race_date, r.division, r.series_mode, t.name AS track_name
       FROM races r
       JOIN tracks t ON t.id = r.track_id
       WHERE r.id = ?`
    )
    .get(raceId) as
    | {
        id: number;
        name: string;
        race_date: string;
        division: string | null;
        series_mode: string | null;
        track_name: string;
      }
    | undefined;

  if (!race) return null;

  const entryCounts = db
    .prepare(
      `SELECT
         COUNT(*) AS entries,
         SUM(CASE WHEN COALESCE(entry_status, 'expected') = 'scratched' THEN 1 ELSE 0 END) AS scratched
       FROM race_entries
       WHERE race_id = ?`
    )
    .get(raceId) as { entries: number; scratched: number | null };

  const lineCount = (
    db
      .prepare("SELECT COUNT(*) AS n FROM market_lines WHERE race_id = ?")
      .get(raceId) as { n: number }
  ).n;

  const resolved = resolveRaceModelForMaintenance({
    name: race.name,
    division: race.division,
    series_mode: race.series_mode,
  });
  const modelSlug = slug(resolved.modelSeries);
  const predictionCacheExists = firstExistingPredictionCache(raceId, modelSlug).cacheExists;

  const topLines = db
    .prepare(
      `SELECT d.name AS driver_name, ml.market_odds, re.entry_status, ml.rationale
       FROM market_lines ml
       JOIN drivers d ON d.id = ml.driver_id
       JOIN race_entries re ON re.race_id = ml.race_id AND re.driver_id = ml.driver_id
       WHERE ml.race_id = ?
         AND COALESCE(re.entry_status, 'expected') != 'scratched'
       ORDER BY
         CASE WHEN ml.market_odds LIKE '+%' THEN CAST(substr(ml.market_odds, 2) AS INTEGER) ELSE 0 END ASC,
         d.name ASC
       LIMIT 8`
    )
    .all(raceId) as Array<{
      driver_name: string;
      market_odds: string;
      entry_status: string;
      rationale: string | null;
    }>;

  const entries = entryCounts.entries ?? 0;
  const scratchedEntries = entryCounts.scratched ?? 0;
  const activeEntries = entries - scratchedEntries;
  const hasLines = lineCount > 0;
  const hasEntries = entries > 0;

  return {
    raceId,
    raceName: race.name,
    raceDate: race.race_date,
    trackName: race.track_name,
    division: race.division,
    entries,
    activeEntries,
    scratchedEntries,
    lineCount,
    predictionCacheExists,
    topLines: topLines.map((line) => ({
      driverName: line.driver_name,
      marketOdds: line.market_odds,
      entryStatus: line.entry_status,
      rationale: line.rationale,
    })),
    items: [
      {
        label: "Night 1 race hub is live",
        status: "done",
        detail: `${race.name} is open and linked from the race hub, prediction output, and odds/lines pages.`,
        href: `/admin/races/${raceId}`,
      },
      {
        label: "Entries and attendance caveats loaded",
        status: hasEntries ? "done" : "pending",
        detail: `${entries} entries, ${activeEntries} active, ${scratchedEntries} scratched/unbettable.`,
        href: `/admin/races/${raceId}`,
      },
      {
        label: "Prediction cache is current enough for publishing",
        status: predictionCacheExists ? "done" : "pending",
        detail: predictionCacheExists
          ? `${resolved.modelSeries} cache exists for this race.`
          : `Run model scoring for ${resolved.modelSeries}.`,
        href: `/admin/races/${raceId}/prediction`,
      },
      {
        label: "Outright market lines published",
        status: hasLines ? "done" : "pending",
        detail: `${lineCount} published market lines are available to the race output.`,
        href: `/admin/races/${raceId}/book`,
      },
      {
        label: "Race output reads the same market lines",
        status: hasLines ? "done" : "pending",
        detail: hasLines
          ? "Prediction output, caveats, and market_lines are connected for this race."
          : "Publish lines before calling any picks bettable.",
        href: `/admin/races/${raceId}/prediction`,
      },
      {
        label: "Reasoning is visible before publishing",
        status: hasLines ? "done" : "pending",
        detail: "Admin prediction, market rationale, caveats, and track trend reasons are available for review.",
        href: `/admin/races/${raceId}/prediction`,
      },
    ],
    nextActions: [
      {
        label: "Final Night 1 underwriting pass",
        status: "pending",
        detail: "Confirm Davenport, Madden, Marlar, and any local/regional entries before calling odds final.",
        href: `/admin/races/${raceId}`,
      },
      {
        label: "Review likely bets and props",
        status: "pending",
        detail: "Use the prediction card and odds/lines page for win, top-3, H2H, DNF, and laps-led props; keep questionable entries on watch.",
        href: `/admin/races/${raceId}/prediction`,
      },
      {
        label: "Night 2 production setup",
        status: "pending",
        detail: "Race 875 needs entries, prediction cache, and published lines after the field is ready.",
        href: "/admin/races/875",
      },
      {
        label: "True XGBoost run",
        status: "done",
        detail: "XGBoost is enabled locally via the patched OpenMP runtime path; current artifacts use XGBClassifier.",
        href: "/admin/maintenance",
      },
    ],
  };
}
