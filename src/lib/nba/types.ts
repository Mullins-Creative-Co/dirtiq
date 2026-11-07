export type NbaReport = {
  version: number; generatedAt: string; developmentSeason: string; holdout: string; holdoutEvaluated: boolean;
  settings: { trainingDays: number; weightHalfLifeDays: number; minimumTrainingGames: number; edgeThreshold: number; minimumPriorTeamGames: number };
  reports: { id: string; features: string[]; games: number; quotedGames: number; mae: number; marketMae: number | null; selected: number; wins: number; losses: number; pushes: number; coverRate: number | null; hypotheticalRoi110: number | null; calibratedGames: number; brier: number | null; maeDelta: number; maeDeltaInterval: number[] | null;
    examples: { gameId: string; home: string; away: string; prediction: number; market: number | null; actual: number; homeCoverProbability: number | null }[];
  }[];
  limitations: string[];
};
