import "server-only";

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

import { normalizePairwise, type MlPairwise } from "@/lib/book/pairwise";

export type { MlPairwise } from "@/lib/book/pairwise";

export type MlPrediction = {
  driverId: number;
  driverName: string;
  metricSeries: string;
  modelSlug: string;
  modelSeries?: string | null;
  modelReason?: string | null;
  rawProbability: number;
  /** Calibrated win probability; the field's values sum to one. */
  probability: number;
  trainedOn: string | null;
  testAuc: number | null;
  top1Accuracy: number | null;
  modelEngine?: string | null;
  modelAlgorithm?: string | null;
  featureCount?: number | null;
  /** Calibrated P(finish in top 3); absent on older files. */
  top3Probability?: number | null;
  /** Calibrated P(finish in top 5); absent on older files. */
  top5Probability?: number | null;
  /** Expected finishing position; absent on older files. */
  expectedFinish?: number | null;
};

export type MlRaceFile = {
  raceId: number;
  modelOverride?: string;
  modelSeries?: string;
  modelSlug?: string;
  modelReason?: string;
  modelStage?: string;
  modelId?: string;
  modelVersion?: string;
  trainedAt?: string;
  dataThrough?: string;
  predictions: MlPrediction[];
  /** P(driver i ahead of driver j) for the top drivers; being added upstream, so optional. */
  pairwise?: unknown;
};

export type MlRaceFileResult = {
  file: MlRaceFile;
  filePath: string;
  predictions: Map<number, MlPrediction>;
  /** Validated pairwise matrix, or null when the file has none or it is malformed. */
  pairwise: MlPairwise | null;
};

function readPredictionFile(filePath: string, raceId: number) {
  if (!existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as MlRaceFile;
    if (parsed.raceId !== raceId) return null;
    if (!Array.isArray(parsed.predictions)) return null;
    return { file: parsed, filePath };
  } catch {
    return null;
  }
}

/**
 * Locate and parse the ML race file, exposing the whole file (including the
 * optional pairwise matrix) alongside the per-driver map. Returns null when
 * no usable file exists for the race.
 */
export function getCachedMlRaceFile(raceId: number, preferCrown = false): MlRaceFileResult | null {
  const dir = path.join(process.env.DIRTIQ_DATABASE_DIR ?? path.join(process.cwd(), "data"), "ml-predictions");
  const publicDir = path.join(process.cwd(), "public", "data", "ml-predictions");
  const exactRaceFile = new RegExp(`^race_${raceId}(?:_.+)?\\.json$`);
  const activeDir = existsSync(dir) ? dir : publicDir;
  const files = existsSync(activeDir)
    ? readdirSync(activeDir)
        .filter((file) => exactRaceFile.test(file))
        .map((file) => path.join(activeDir, file))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];

  const basePath = path.join(activeDir, `race_${raceId}.json`);
  const crownPath = path.join(activeDir, `race_${raceId}_crown_jewel_combined.json`);

  const parsed = preferCrown
    ? readPredictionFile(crownPath, raceId) ?? readPredictionFile(basePath, raceId)
    : files.map((file) => readPredictionFile(file, raceId)).find(Boolean) ??
      readPredictionFile(basePath, raceId);

  if (!parsed) return null;

  return {
    file: parsed.file,
    filePath: parsed.filePath,
    predictions: new Map(parsed.file.predictions.map((prediction) => [prediction.driverId, prediction])),
    pairwise: normalizePairwise(parsed.file.pairwise),
  };
}

export function getCachedMlPredictions(raceId: number, preferCrown = false) {
  return getCachedMlRaceFile(raceId, preferCrown)?.predictions ?? new Map<number, MlPrediction>();
}
