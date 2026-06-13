import "server-only";
import { getDb } from "./db";
import { calculateRaceOdds } from "./odds";

export type SimParams = {
  bettorsPerRace: number;  // simulated bettors per race
  stakePerBet: number;     // flat stake in dollars
  squareness: number;      // 0=uniform 1=prob-proportional 2=chalk-heavy
  numSimulations: number;  // Monte Carlo iterations
};

export type RaceSimResult = {
  raceId: number;
  raceName: string;
  trackName: string;
  raceDate: string;
  fieldSize: number;
  actualWinnerName: string;
  actualWinnerOdds: string;
  actualWinnerModelRank: number;  // 1 = model's favorite, 2 = second pick, etc.
  modelFavoriteName: string;
  modelFavoriteWon: boolean;
  meanHandle: number;
  meanHousePL: number;
  p10HousePL: number;
  p90HousePL: number;
  stakeOnWinnerMean: number;  // expected amount bet on actual winner
};

export type BacktestResult = {
  params: SimParams;
  races: RaceSimResult[];
  summary: {
    racesRun: number;
    meanTotalHandle: number;
    meanTotalPL: number;
    holdPct: number;
    favoriteWonCount: number;
    top3WonCount: number;
    meanWinnerRank: number;
    bankrollFor95Survival: number;
    worstRaceMeanPL: number;
    // Percentile paths for cumulative P&L (indexed by race, value = cumulative P&L)
    cumPaths: { p10: number[]; p50: number[]; p90: number[] };
  };
};

// Mulberry32 seeded RNG — deterministic and fast
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(weights: number[], rand: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[idx];
}

function oddsToMultiplier(odds: string): number {
  const n = parseInt(odds, 10);
  if (isNaN(n)) return 1;
  return n > 0 ? n / 100 : 100 / Math.abs(n);
}

export function runBacktest(params: SimParams): BacktestResult {
  const db = getDb();

  const completedRaces = db
    .prepare(
      `SELECT r.id, r.name, r.track_id, r.race_date, t.name AS track_name
       FROM races r JOIN tracks t ON t.id = r.track_id
       WHERE r.status = 'complete'
       ORDER BY r.race_date ASC`
    )
    .all() as Array<{ id: number; name: string; track_id: number; race_date: string; track_name: string }>;

  const { bettorsPerRace, stakePerBet, squareness, numSimulations } = params;
  const rng = mulberry32(0xdeadbeef); // fixed seed — same result every run

  // Cumulative P&L for each simulation across all races
  // simPaths[simIdx][raceIdx] = cumulative P&L at that point
  const simPaths: number[][] = Array.from({ length: numSimulations }, () => []);

  const raceResults: RaceSimResult[] = [];

  for (const race of completedRaces) {
    // Get model odds — pass raceId so Elo excludes this race from its history
    const odds = calculateRaceOdds(race.id, race.track_id);
    if (odds.length === 0) continue;

    // Find actual winner
    const winner = db
      .prepare(
        `SELECT re.driver_id, d.name AS driver_name
         FROM race_entries re JOIN drivers d ON d.id = re.driver_id
         WHERE re.race_id = ? AND re.finishing_position = 1 AND re.dnf = 0`
      )
      .get(race.id) as { driver_id: number; driver_name: string } | null;

    if (!winner) continue;

    const winnerOddsEntry = odds.find((o) => o.driverId === winner.driver_id);
    const winnerOdds = winnerOddsEntry?.americanOdds ?? "+999";
    const winnerProfitMult = oddsToMultiplier(winnerOdds);
    const winnerModelRank = winnerOddsEntry
      ? odds.indexOf(winnerOddsEntry) + 1
      : odds.length;
    const modelFavorite = odds[0];

    // Bettor weight per driver — squareness controls how much money goes to favorites
    // squareness=0 → uniform, 1 → proportional to model prob, 2 → p^2 (chalk-heavy)
    const probs = odds.map((o) => o.impliedProbability);
    const rawWeights = squareness === 0
      ? odds.map(() => 1)
      : probs.map((p) => Math.max(p, 0.001) ** squareness);
    const weightSum = rawWeights.reduce((a, b) => a + b, 0);
    const weights = rawWeights.map((w) => w / weightSum);

    // Index of actual winner in the odds array
    const winnerIdx = odds.findIndex((o) => o.driverId === winner.driver_id);

    // Per-simulation P&L for this race
    const simPLs: number[] = [];

    for (let s = 0; s < numSimulations; s++) {
      let handle = 0;
      let payout = 0;

      for (let b = 0; b < bettorsPerRace; b++) {
        const pick = weightedPick(weights, rng);
        handle += stakePerBet;
        if (pick === winnerIdx) {
          payout += stakePerBet + stakePerBet * winnerProfitMult;
        }
      }

      simPLs.push(handle - payout);
    }

    simPLs.sort((a, b) => a - b);
    const meanPL = simPLs.reduce((a, b) => a + b, 0) / simPLs.length;
    const meanHandle = bettorsPerRace * stakePerBet;
    const stakeOnWinnerMean = meanHandle * weights[winnerIdx < 0 ? 0 : winnerIdx];

    // Accumulate into simulation paths
    for (let s = 0; s < numSimulations; s++) {
      const prev = simPaths[s].length > 0 ? simPaths[s][simPaths[s].length - 1] : 0;
      simPaths[s].push(prev + simPLs[s]);
    }

    raceResults.push({
      raceId: race.id,
      raceName: race.name,
      trackName: race.track_name,
      raceDate: race.race_date,
      fieldSize: odds.length,
      actualWinnerName: winner.driver_name,
      actualWinnerOdds: winnerOdds,
      actualWinnerModelRank: winnerModelRank,
      modelFavoriteName: modelFavorite.driverName,
      modelFavoriteWon: modelFavorite.driverId === winner.driver_id,
      meanHandle,
      meanHousePL: meanPL,
      p10HousePL: percentile(simPLs, 10),
      p90HousePL: percentile(simPLs, 90),
      stakeOnWinnerMean,
    });
  }

  const racesRun = raceResults.length;
  if (racesRun === 0) {
    return {
      params,
      races: [],
      summary: {
        racesRun: 0, meanTotalHandle: 0, meanTotalPL: 0, holdPct: 0,
        favoriteWonCount: 0, top3WonCount: 0, meanWinnerRank: 0,
        bankrollFor95Survival: 0, worstRaceMeanPL: 0,
        cumPaths: { p10: [], p50: [], p90: [] },
      },
    };
  }

  // Compute bankroll needed for 95% survival
  // = 95th percentile of (max negative cumulative P&L) across all simulations
  const maxNegatives = simPaths.map((path) => {
    const minVal = Math.min(0, ...path);
    return -minVal; // positive number = how much you went negative
  });
  maxNegatives.sort((a, b) => a - b);
  const bankrollFor95Survival = percentile(maxNegatives, 95);

  // Cumulative path percentiles at each race step
  const cumPaths = {
    p10: [] as number[],
    p50: [] as number[],
    p90: [] as number[],
  };
  for (let rIdx = 0; rIdx < racesRun; rIdx++) {
    const valuesAtStep = simPaths.map((p) => p[rIdx]).sort((a, b) => a - b);
    cumPaths.p10.push(percentile(valuesAtStep, 10));
    cumPaths.p50.push(percentile(valuesAtStep, 50));
    cumPaths.p90.push(percentile(valuesAtStep, 90));
  }

  const meanTotalHandle = raceResults.reduce((s, r) => s + r.meanHandle, 0);
  const meanTotalPL = raceResults.reduce((s, r) => s + r.meanHousePL, 0);
  const favoriteWonCount = raceResults.filter((r) => r.modelFavoriteWon).length;
  const top3WonCount = raceResults.filter((r) => r.actualWinnerModelRank <= 3).length;
  const meanWinnerRank =
    raceResults.reduce((s, r) => s + r.actualWinnerModelRank, 0) / racesRun;

  return {
    params,
    races: raceResults,
    summary: {
      racesRun,
      meanTotalHandle,
      meanTotalPL,
      holdPct: meanTotalHandle > 0 ? meanTotalPL / meanTotalHandle : 0,
      favoriteWonCount,
      top3WonCount,
      meanWinnerRank,
      bankrollFor95Survival,
      worstRaceMeanPL: Math.min(...raceResults.map((r) => r.meanHousePL)),
      cumPaths,
    },
  };
}
