type PricingMetrics = { games: number; mae: number | null; bets: number; wins: number; losses: number; pushes: number; coverRate: number | null; roi: number | null; roiInterval: number[] | null; probabilityGames: number; brier: number | null; calibration: { low: number; high: number; games: number; predicted: number | null; observed: number | null }[] };
export type PricingReport = {
  version: number; generatedAt: string; holdoutEvaluated: boolean;
  starterCoverage: { records: number; acceptedSides: number; completeGames: number; lateRecords: number; status: string };
  settings: { qbPrior: number; marginRidge: number; lookbackDays: number; weightHalfLifeDays: number; edgeThresholdPoints: number; minimumPriorErrors: number };
  reports: (PricingMetrics & { id: string; maeDelta: number | null; maeDeltaInterval: number[] | null; periods: (PricingMetrics & { season: number })[]; supportingTeamGroup: PricingMetrics; confirmed: PricingMetrics })[];
  limitations: string[];
};
