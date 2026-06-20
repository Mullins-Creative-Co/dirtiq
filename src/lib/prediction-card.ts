import "server-only";

import { calculateRaceOdds } from "@/lib/odds";
import { evaluateCrownJewelTrends } from "@/lib/crown-jewel-trends";
import { getDb } from "@/lib/db";
import { getLineCaveatMap } from "@/lib/line-caveats";
import { getCachedMlPredictions } from "@/lib/ml-predictions";
import { getRaceContextAdjustmentMap } from "@/lib/race-context-adjustments";
import { getRace, getRaceEntries } from "@/lib/races";
import { isCombinedSeries, isCrownJewelRaceName } from "@/lib/series";

export type PredictionCardRow = {
  rank: number;
  driverId: number;
  driverName: string;
  carNumber: string | null;
  modelProbability: number;
  blendedProbability: number;
  mlProbability: number | null;
  mlModel: string | null;
  mlModelSeries: string | null;
  mlModelReason: string | null;
  mlTrainedOn: string | null;
  mlTestAuc: number | null;
  mlTop1Accuracy: number | null;
  mlEngine: string | null;
  mlAlgorithm: string | null;
  mlFeatureCount: number | null;
  fairOdds: string;
  metricSeries: string;
  baselineEdge: number;
  confidence: "High" | "Medium" | "Low";
  recommendation: "Play" | "Lean" | "Pass";
  reasons: string[];
  warnings: string[];
  caveatMultiplier: number;
  entryStatus: "confirmed" | "expected" | "unconfirmed" | "scratched";
  marketLine?: {
    odds: string;
    source: string;
    rationale: string | null;
    updatedAt: string;
  };
};

export type PredictionCard = {
  raceId: number;
  raceName: string;
  trackName: string;
  raceDate: string;
  trackCondition: string;
  fieldSize: number;
  dataCutoff: string;
  readiness: {
    entries: number;
    starts: number;
    qualifying: number;
    heats: number;
  };
  rows: PredictionCardRow[];
};

type DriverSeriesProfile = {
  starts: number;
  wins: number;
  top5s: number;
  avgFinish: number | null;
};

type GovernorResult = {
  probability: number;
  reasons: string[];
  warnings: string[];
};

function americanOdds(probability: number) {
  if (probability >= 1) return "-∞";
  if (probability <= 0) return "+∞";

  const odds =
    probability >= 0.5
      ? -(probability / (1 - probability)) * 100
      : ((1 - probability) / probability) * 100;

  return odds < 0 ? Math.round(odds).toString() : `+${Math.round(odds)}`;
}

function confidenceFor(
  row: ReturnType<typeof calculateRaceOdds>[number],
  baselineEdge: number
): PredictionCardRow["confidence"] {
  const r = row.reasoning;
  const supportCount = [
    r.trackStarts >= 2,
    r.similarTrackStarts >= 2,
    r.seasonStarts >= 5,
    r.tonightHeatPos !== null,
    r.tonightQtRank !== null,
    r.startingPosition !== null,
    r.dnfRate === null || r.dnfRate < 0.12,
  ].filter(Boolean).length;

  if (baselineEdge >= 0.08 && supportCount >= 5 && r.warnings.length <= 1) return "High";
  if (baselineEdge >= 0.04 && supportCount >= 3) return "Medium";
  return "Low";
}

function recommendationFor(
  probability: number,
  baselineEdge: number,
  confidence: PredictionCardRow["confidence"]
): PredictionCardRow["recommendation"] {
  if (probability >= 0.14 && baselineEdge >= 0.07 && confidence !== "Low") return "Play";
  if (probability >= 0.09 && baselineEdge >= 0.035) return "Lean";
  return "Pass";
}

function clampProbability(value: number) {
  return Math.max(0.001, Math.min(0.85, value));
}

function activeSeriesLabel(division: string, seriesMode: string | null) {
  return seriesMode || division;
}

function loadDriverSeriesProfiles(raceId: number, series: string) {
  const rows = getDb()
    .prepare(
      `SELECT current.driver_id AS driverId,
              COUNT(hr.id) AS starts,
              SUM(CASE WHEN hr.id IS NOT NULL AND history.finishing_position = 1 THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN hr.id IS NOT NULL AND history.finishing_position <= 5 THEN 1 ELSE 0 END) AS top5s,
              AVG(CASE WHEN hr.id IS NOT NULL THEN history.finishing_position END) AS avgFinish
       FROM race_entries current
       LEFT JOIN race_entries history
         ON history.driver_id = current.driver_id
       LEFT JOIN races hr
         ON hr.id = history.race_id
        AND hr.race_date < (SELECT race_date FROM races WHERE id = ?)
        AND hr.division = ?
        AND history.finishing_position IS NOT NULL
       WHERE current.race_id = ?
       GROUP BY current.driver_id`
    )
    .all(raceId, series, raceId) as Array<{
      driverId: number;
      starts: number;
      wins: number;
      top5s: number;
      avgFinish: number | null;
    }>;

  return new Map<number, DriverSeriesProfile>(
    rows.map((row) => [
      row.driverId,
      {
        starts: Number(row.starts ?? 0),
        wins: Number(row.wins ?? 0),
        top5s: Number(row.top5s ?? 0),
        avgFinish: row.avgFinish === null ? null : Number(row.avgFinish),
      },
    ])
  );
}

function applyPreliminaryGovernor(params: {
  probability: number;
  mlProbability: number | null;
  prelimCompleteness: number;
  profile: DriverSeriesProfile | undefined;
  contextDelta: number;
  contextLabels: string[];
  hasLineupSignal: boolean;
}): GovernorResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let probability = params.probability;
  const profile = params.profile ?? { starts: 0, wins: 0, top5s: 0, avgFinish: null };
  const prePrelim = params.prelimCompleteness < 0.25 && !params.hasLineupSignal;
  const sparseNoWinProfile = profile.starts < 8 && profile.wins === 0;
  const provenWinner = profile.wins >= 1 || profile.top5s >= 12;
  const strongContext = params.contextDelta >= 0.035;

  if (prePrelim && sparseNoWinProfile && params.mlProbability !== null && params.mlProbability >= 0.12) {
    const cap = Math.min(0.115, 0.075 + Math.max(0, params.contextDelta));
    if (probability > cap) {
      probability = cap;
      warnings.push(
        `Prelim governor: sparse series profile (${profile.starts} starts, 0 wins) capped until qualifying/heat confirmation.`
      );
    }
  }

  if (prePrelim && provenWinner && strongContext && probability < 0.055) {
    probability = 0.055;
    reasons.push("Prelim governor: proven winner with positive race-night context stays in contender tier.");
  }

  if (prePrelim && strongContext) {
    reasons.push(params.contextLabels[0] ?? "Positive race-night context before prelims.");
  }

  return { probability: clampProbability(probability), reasons, warnings };
}

export function buildPredictionCard(raceId: number): PredictionCard | null {
  const race = getRace(raceId);
  if (!race) return null;

  const entries = getRaceEntries(raceId);
  const odds = calculateRaceOdds(raceId, race.track_id);
  const preferCrown =
    isCombinedSeries(race.series_mode ?? race.division) ||
    isCrownJewelRaceName(race.name);
  const mlPredictions = getCachedMlPredictions(raceId, preferCrown);
  const caveatMap = getLineCaveatMap(raceId);
  const contextMap = getRaceContextAdjustmentMap(raceId);
  const fieldSize = odds.length;
  const baseline = fieldSize > 0 ? 1 / fieldSize : 0;
  const seriesProfiles = loadDriverSeriesProfiles(raceId, activeSeriesLabel(race.division, race.series_mode));
  const prelimCompleteness =
    entries.length > 0
      ? Math.max(
          entries.filter((entry) => entry.starting_position !== null).length,
          entries.filter((entry) => entry.qualifying_time !== null).length,
          entries.filter((entry) => entry.heat_position !== null).length
        ) / entries.length
      : 0;

  const rows = odds.map((row) => {
    const entry = entries.find((item) => item.driver_id === row.driverId);
    const entryStatus = entry?.entry_status ?? "expected";
    const ml = mlPredictions.get(row.driverId) ?? null;
    const baseModelProbability = ml
      ? ml.probability * 0.6 + row.impliedProbability * 0.4
      : row.impliedProbability;
    const trend = evaluateCrownJewelTrends(
      {
        raceName: race.name,
        trackName: race.track_name,
        raceDate: race.race_date,
        division: race.division,
        seriesMode: race.series_mode,
      },
      { id: row.driverId, name: row.driverName }
    );
    const driverCaveats = caveatMap.byDriver.get(row.driverId) ?? [];
    const entryStatusMultiplier =
      entryStatus === "scratched" ? 0.02 : entryStatus === "unconfirmed" ? 0.6 : 1;
    const caveatMultiplier = driverCaveats.reduce(
      (product, caveat) => product * caveat.probability_multiplier,
      entryStatusMultiplier
    );
    const driverContext = contextMap.byDriver.get(row.driverId) ?? [];
    const contextDelta = driverContext.reduce((sum, item) => sum + item.score_delta, 0);
    const contextLabels = driverContext.map((item) => item.label);
    const governed = applyPreliminaryGovernor({
      probability: baseModelProbability * trend.multiplier * caveatMultiplier,
      mlProbability: ml?.probability ?? null,
      prelimCompleteness,
      profile: seriesProfiles.get(row.driverId),
      contextDelta,
      contextLabels,
      hasLineupSignal:
        row.reasoning.startingPosition !== null ||
        row.reasoning.tonightHeatPos !== null ||
        row.reasoning.tonightQtRank !== null,
    });
    const modelProbability = governed.probability;
    const baselineEdge = modelProbability - baseline;
    const confidence = confidenceFor(row, baselineEdge);
    const recommendation = recommendationFor(modelProbability, baselineEdge, confidence);
    const blendedReasons = row.reasoning.highlights.filter(
      (highlight) => !(ml && highlight.startsWith("Using "))
    );
    const reasons = [
      ...(ml ? [`ML layer ${Math.round(ml.probability * 1000) / 10}% from ${ml.metricSeries}${ml.modelAlgorithm ? ` (${ml.modelAlgorithm})` : ""}`] : []),
      ...governed.reasons,
      ...trend.reasons,
      ...blendedReasons,
    ].slice(0, 3);
    const caveatWarnings = [
      ...(entryStatus === "scratched" ? ["SCRATCHED: driver marked scratched from field"] : []),
      ...(entryStatus === "unconfirmed" ? ["UNCONFIRMED: entry not confirmed yet"] : []),
      ...driverCaveats.map((caveat) => `${caveat.severity.toUpperCase()}: ${caveat.note}`),
      ...caveatMap.raceWide.map((caveat) => `${caveat.severity.toUpperCase()}: ${caveat.note}`),
    ];
    const warnings = [...caveatWarnings, ...governed.warnings, ...trend.warnings, ...row.reasoning.warnings].slice(0, 3);

    return {
      rank: 0,
      driverId: row.driverId,
      driverName: row.driverName,
      carNumber: row.carNumber,
      modelProbability,
      blendedProbability: row.impliedProbability,
      mlProbability: ml?.probability ?? null,
      mlModel: ml?.modelSlug ?? null,
      mlModelSeries: ml?.modelSeries ?? null,
      mlModelReason: ml?.modelReason ?? null,
      mlTrainedOn: ml?.trainedOn ?? null,
      mlTestAuc: ml?.testAuc ?? null,
      mlTop1Accuracy: ml?.top1Accuracy ?? null,
      mlEngine: ml?.modelEngine ?? null,
      mlAlgorithm: ml?.modelAlgorithm ?? null,
      mlFeatureCount: ml?.featureCount ?? null,
      fairOdds: americanOdds(modelProbability),
      metricSeries: ml?.metricSeries ?? row.reasoning.metricSeries,
      baselineEdge,
      confidence,
      recommendation,
      reasons,
      warnings,
      caveatMultiplier,
      entryStatus,
    };
  }).sort((a, b) => b.modelProbability - a.modelProbability)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    raceId,
    raceName: race.name,
    trackName: race.track_name,
    raceDate: race.race_date,
    trackCondition: race.track_condition,
    fieldSize,
    dataCutoff: new Date().toISOString(),
    readiness: {
      entries: entries.length,
      starts: entries.filter((entry) => entry.starting_position !== null).length,
      qualifying: entries.filter((entry) => entry.qualifying_time !== null).length,
      heats: entries.filter((entry) => entry.heat_position !== null).length,
    },
    rows,
  };
}
