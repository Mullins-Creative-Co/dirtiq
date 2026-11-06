export type AuditMetrics = {
  games: number; baselineMae: number; fullMae: number; newMae: number; marketMae: number;
  directional: { sides: number; wins: number; losses: number; pushes: number; coverRate: number | null; meanMarketError: number | null };
};
export type AuditTrace = { gameId: string; season: number; week: number; cutoff: string; actual: number; market: number; trainCount: number; trainOverlap: number | null; activeSignals: number; baseline: number; full: number; new: number; full_add: number; new_add: number; projected_add: number };
export type AuditExperiment = AuditMetrics & {
  id: string; name: string; baseline: string[]; signal: string[]; mechanism: string;
  comparisons: { full: { delta: number; interval: number[] | null }; baseline: { delta: number; interval: number[] | null } };
  marketErrorInterval: number[] | null; signalExplainedOutOfSample: number | null;
  repeated: boolean; status: string; examples: AuditTrace[]; periods: (AuditMetrics & { label: string })[];
};
export type OverlapAudit = {
  version: number; generatedAt: string; sourceSha256: string; games: number;
  settings: { trainingYears: number; halfLifeDays: number; alpha: number; minimumTraining: number; minimumDirectionalCorrectionPoints: number; bootstrapSamples: number; familyComparisons: number; individualIntervalConfidence: number };
  experiments: AuditExperiment[]; holdout: { season: number; fromWeek: number; evaluated: false };
  method: string[]; deferred: { name: string; needed: string }[]; limits: string[];
};
