import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CrownReplayRow = {
  raceId: number;
  raceName: string;
  raceDate: string;
  division: string;
  trackName: string;
  fieldSize: number;
  actualWinner: string;
  actualFinish: number;
  winnerStart: number | null;
  winnerHeat: number | null;
  winnerQtRank: number | null;
  xgbRank: number;
  xgbProbability: number;
  xgbFavorite: string;
  xgbFavoriteProbability: number;
  agentRank: number | null;
  agentFavorite: string | null;
  agentScore: number | null;
  crownPriorTop3: boolean;
  crownPriorWin: boolean;
  recentWin14d: boolean;
  recentTop514d: boolean;
  priorDeepStartTop3Count: number;
  priorDeepStartWinCount: number;
  priorPlusMinusAvg: number | null;
  last5PlusMinusAvg: number | null;
  hasQualifying: boolean;
  hasHeatData: boolean;
  hasStartingLineup: boolean;
  gaps: string[];
};

export type CrownReplay = {
  generatedAt: string | null;
  summary: {
    races: number;
    xgbTop1: number;
    xgbTop3: number;
    agentTop1: number;
    agentTop3: number;
    avgXgbWinnerRank: number | null;
    avgAgentWinnerRank: number | null;
    missingQualifyingRaces: number;
    missingHeatRaces: number;
    missingStartRaces: number;
  };
  rows: CrownReplayRow[];
};

const emptyReplay: CrownReplay = {
  generatedAt: null,
  summary: {
    races: 0,
    xgbTop1: 0,
    xgbTop3: 0,
    agentTop1: 0,
    agentTop3: 0,
    avgXgbWinnerRank: null,
    avgAgentWinnerRank: null,
    missingQualifyingRaces: 0,
    missingHeatRaces: 0,
    missingStartRaces: 0,
  },
  rows: [],
};

export function getCrownReplay(): CrownReplay {
  const path = join(process.cwd(), "data", "crown-replay.json");
  if (!existsSync(path)) return emptyReplay;

  try {
    return JSON.parse(readFileSync(path, "utf8")) as CrownReplay;
  } catch {
    return emptyReplay;
  }
}
