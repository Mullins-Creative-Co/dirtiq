export type CastRating = {
  qb: number; passSupport: number; rush: number; defense: number; specialTeams: number;
  support: number; qbId: string; qbName: string; priorGame: string; qbDropbacks: number;
  alternateQbDropbacks: number; multiQbTeam: boolean; multiTeamQb: boolean;
  qbPercentile: number; supportPercentile: number;
};
type GroupMetrics = {
  games: number; wins: number; losses: number; pushes: number; coverRate: number | null;
  meanMarketError: number | null; marketErrorInterval: number[] | null;
  roi: number | null; roiInterval: number[] | null; positiveModelEdge: number;
};
export type CastReport = {
  version: number; title: string; holdoutEvaluated: boolean; holdout: string;
  settings: { trainingDays: number; weightHalfLifeDays: number; primaryQbPrior: number; sensitivityQbPriors: number[]; marginRidge: number; familyComparisons: number; bootstrapSamples: number };
  reports: {
    qbPrior: number; games: number; baselineMae: number; splitMae: number; marketMae: number;
    maeDelta: number; maeDeltaInterval: number[] | null;
    proxyCheck: { checkedSides: number; matchingDominantPasser: number; matchRate: number | null; sidesWith50AlternateDropbacks: number; explanation: string };
    groups: (GroupMetrics & { label: string; periods: (GroupMetrics & { label: string })[];
      examples: { gameId: string; picked: string; modelEdge: number; marketError: number; home: CastRating; away: CastRating }[] })[];
  }[];
  limitations: string[];
};
