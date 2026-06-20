import "server-only";

import { getDb } from "@/lib/db";

export const SERIES = {
  woo: "WoO Late Models",
  lucas: "Lucas Oil LMDS",
  summer: "DIRTcar Summer Nationals",
  independent: "Independent",
  combined: "Crown Jewel / Combined",
} as const;

const SERIES_ALIASES: Record<string, string> = {
  "crown jewel": SERIES.combined,
  "crown jewel combined": SERIES.combined,
  "crown jewel / combined": SERIES.combined,
  "combined": SERIES.combined,
  "dirtcar": SERIES.summer,
  "dirtcar summer nationals": SERIES.summer,
  "hell tour": SERIES.summer,
  "helltour": SERIES.summer,
  "independent": SERIES.independent,
  "independent open late model": SERIES.independent,
  "lucas oil": SERIES.lucas,
  "lucas oil lmds": SERIES.lucas,
  "lucas": SERIES.lucas,
  "open": SERIES.independent,
  "open late model": SERIES.independent,
  "woo late models": SERIES.woo,
  "world of outlaws": SERIES.woo,
  "world of outlaws late models": SERIES.woo,
  "woo": SERIES.woo,
};

const CROWN_JEWEL_PATTERNS = [
  "show-me",
  "show me",
  "prairie dirt",
  "usa nationals",
  "world finals",
  "knoxville",
  "north/south",
  "north south",
  "topless",
  "dream",
  "world 100",
  "firecracker",
  "pdc",
  "gopher 50",
  "hawkeye 100",
  "ralph latham",
  "dirt million",
  "gateway",
  "jackson 100",
  "hillbilly",
  "national 100",
  "silver dollar",
  "florence",
  "eldora",
  "dirt track world championship",
  "dtwc",
];

function normalize(value: string | null | undefined) {
  return value?.toLowerCase().replace(/[^a-z0-9\s/]/g, "").replace(/\s+/g, " ").trim() ?? "";
}

export function normalizeSeries(value: string | null | undefined) {
  const key = normalize(value);
  return SERIES_ALIASES[key] ?? value ?? SERIES.woo;
}

export function isCombinedSeries(value: string | null | undefined) {
  const key = normalize(value);
  return (
    key.includes("crown") ||
    key.includes("combined") ||
    key.includes("open") ||
    key.includes("independent") ||
    key.includes("late model")
  ) && !key.includes("woo") && !key.includes("lucas") && !key.includes("summer") && !key.includes("dirtcar");
}

export function isCrownJewelRaceName(value: string | null | undefined) {
  const key = normalize(value);
  return CROWN_JEWEL_PATTERNS.some((pattern) => key.includes(normalize(pattern)));
}

export function racePrimarySeries(value: string | null | undefined) {
  if (isCombinedSeries(value)) return null;

  const normalized = normalizeSeries(value);
  if (normalized.includes("Lucas")) return SERIES.lucas;
  if (normalized.includes("WoO")) return SERIES.woo;
  if (normalized.includes("Summer")) return SERIES.summer;

  return null;
}

export function resolveDriverMetricSeries(
  driverId: number,
  raceDivision: string | null | undefined,
  entrySeries?: string | null,
) {
  const db = getDb();
  const entryPrimarySeries = racePrimarySeries(entrySeries);
  const raceSeries = racePrimarySeries(raceDivision);

  const available = db
    .prepare(
      `SELECT series,
              COALESCE(feature_wins, 0) AS feature_wins,
              COALESCE(top5s, 0) AS top5s,
              COALESCE(laps_led, 0) AS laps_led
       FROM driver_model_metrics
       WHERE driver_id = ?`
    )
    .all(driverId) as Array<{
      series: string;
      feature_wins: number;
      top5s: number;
      laps_led: number;
    }>;

  if (entryPrimarySeries && available.some((row) => row.series === entryPrimarySeries)) {
    return entryPrimarySeries;
  }

  if (raceSeries && available.some((row) => row.series === raceSeries)) {
    return raceSeries;
  }

  // If the race/entry explicitly says Lucas or WoO, keep that race context even
  // when the driver has no aggregate row for that series yet. Falling back to a
  // driver's old home-series profile makes a Lucas board show WoO labels and can
  // accidentally borrow the wrong season metrics.
  if (entryPrimarySeries) return entryPrimarySeries;
  if (raceSeries) return raceSeries;

  const driver = db
    .prepare("SELECT division FROM drivers WHERE id = ?")
    .get(driverId) as { division: string | null } | undefined;
  const driverSeries = racePrimarySeries(driver?.division);

  if (driverSeries && available.some((row) => row.series === driverSeries)) {
    return driverSeries;
  }

  const seasonSeries = db
    .prepare(
      `SELECT series, starts
       FROM driver_season_stats
       WHERE driver_id = ?
       ORDER BY season DESC, starts DESC
       LIMIT 1`
    )
    .get(driverId) as { series: string; starts: number } | undefined;

  if (seasonSeries?.series) {
    const normalizedSeason = normalizeSeries(seasonSeries.series);
    if (available.some((row) => row.series === normalizedSeason)) return normalizedSeason;
  }

  const bestAggregate = available.sort(
    (a, b) =>
      b.feature_wins + b.top5s * 0.25 + b.laps_led * 0.01 -
      (a.feature_wins + a.top5s * 0.25 + a.laps_led * 0.01)
  )[0];

  return bestAggregate?.series ?? raceSeries ?? SERIES.woo;
}
