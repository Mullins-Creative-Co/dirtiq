import "server-only";

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

export type MlPrediction = {
  driverId: number;
  driverName: string;
  metricSeries: string;
  modelSlug: string;
  modelSeries?: string | null;
  modelReason?: string | null;
  rawProbability: number;
  probability: number;
  trainedOn: string | null;
  testAuc: number | null;
  top1Accuracy: number | null;
  modelEngine?: string | null;
  modelAlgorithm?: string | null;
  featureCount?: number | null;
};

type MlPredictionFile = {
  raceId: number;
  modelOverride?: string;
  modelSeries?: string;
  modelSlug?: string;
  modelReason?: string;
  predictions: MlPrediction[];
};

function readPredictionFile(filePath: string, raceId: number) {
  if (!existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as MlPredictionFile;
    if (parsed.raceId !== raceId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getCachedMlPredictions(raceId: number, preferCrown = false) {
  const dir = path.join(process.env.DIRTIQ_DATABASE_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? path.join(process.cwd(), "data"), "ml-predictions");
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

  if (!parsed) return new Map<number, MlPrediction>();

  return new Map(parsed.predictions.map((prediction) => [prediction.driverId, prediction]));
}
