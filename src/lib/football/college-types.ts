type Prior = { gameId: string; opponent: string; margin: number; turnoverMargin: number | null; yppDifference: number | null; statsValid: boolean; fbsBoth: boolean; qualifies: boolean };
type CollegeGame = { gameId: string; season: number; week: number; kickoff: string; homeTeam: string; awayTeam: string; homeFlag: boolean; awayFlag: boolean; priorStatsKnown: boolean; homePrevious: Prior | null; awayPrevious: Prior | null; market: number | null; faded: string; selected: string };
type Metrics = { games: number; qualifiers: number; wins: number; losses: number; pushes: number; coverRate: number | null; hypotheticalRoi110: number | null; hypotheticalRoiInterval: number[] | null; baselineMae: number; modelMae: number; meanCoverMargin: number | null; coverMarginInterval: number[] | null };
export type CollegeReport = {
  version: number; generatedAt: string; hypothesis: string; thresholds: { winMargin: number; turnoverMargin: number; maxYppAdvantage: number }; scope: string; holdoutEvaluated: boolean; evaluatedSeasons: number[];
  summary: Metrics; periods: (Metrics & { season: number })[]; maeDelta: number; maeDeltaInterval: number[] | null; missingMarketGames: number;
  qualifyingGames: (CollegeGame & { actual: number; baseline: number; model: number; learnedFlagEffect: number; coverMargin: number; modelEdge: number })[];
  upcoming: (CollegeGame & { status: string })[];
  upcomingCoverage: { games: number; bothPriorStatsKnown: number; horizonDays: number; targetDate: string; tomorrowGames: number; tomorrowKnown: number };
  limitations: string[];
};
