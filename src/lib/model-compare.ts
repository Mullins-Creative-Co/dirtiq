import "server-only";
import { getDb } from "./db";
import { calculateRaceOdds } from "./odds";
import { eloWinProbabilities } from "./elo";

export type ModelVariantKey = "blended" | "elo_only" | "composite_only";

export type RaceModelDetail = {
  raceId: number;
  raceName: string;
  raceDate: string;
  trackName: string;
  fieldSize: number;
  actualWinner: string;
  actualWinnerProb: number; // blended implied prob for the actual winner
  winnerRankBlended: number;
  winnerRankElo: number;
  winnerRankComposite: number;
  favoriteNameBlended: string;
  favoriteNameElo: string;
  favoriteNameComposite: string;
};

export type VariantSummary = {
  racesRun: number;
  favoriteWonCount: number;
  top3WonCount: number;
  totalWinnerRank: number; // accumulated — divide by racesRun for mean
};

export type ModelComparisonResult = {
  blended: VariantSummary;
  elo_only: VariantSummary;
  composite_only: VariantSummary;
  races: RaceModelDetail[];
};

function emptyVariant(): VariantSummary {
  return { racesRun: 0, favoriteWonCount: 0, top3WonCount: 0, totalWinnerRank: 0 };
}

export function runModelComparison(): ModelComparisonResult {
  const db = getDb();

  const completedRaces = db
    .prepare(
      `SELECT r.id, r.name, r.track_id, r.race_date, t.name AS track_name
       FROM races r JOIN tracks t ON t.id = r.track_id
       WHERE r.status = 'complete'
       ORDER BY r.race_date ASC`
    )
    .all() as Array<{ id: number; name: string; track_id: number; race_date: string; track_name: string }>;

  const result: ModelComparisonResult = {
    blended: emptyVariant(),
    elo_only: emptyVariant(),
    composite_only: emptyVariant(),
    races: [],
  };

  for (const race of completedRaces) {
    const winner = db
      .prepare(
        `SELECT re.driver_id, d.name AS driver_name
         FROM race_entries re JOIN drivers d ON d.id = re.driver_id
         WHERE re.race_id = ? AND re.finishing_position = 1 AND re.dnf = 0`
      )
      .get(race.id) as { driver_id: number; driver_name: string } | null;

    if (!winner) continue;

    let odds: ReturnType<typeof calculateRaceOdds>;
    try {
      odds = calculateRaceOdds(race.id, race.track_id);
    } catch {
      continue;
    }

    if (odds.length < 2) continue;

    const driverIds = odds.map((o) => o.driverId);

    // ── 1. Blended: already sorted by impliedProbability desc ───────────────
    const blendedRanked = odds; // sorted desc already
    const winnerBlendedIdx = blendedRanked.findIndex((o) => o.driverId === winner.driver_id);
    const winnerRankBlended = winnerBlendedIdx >= 0 ? winnerBlendedIdx + 1 : odds.length;
    const actualWinnerProb = blendedRanked[winnerBlendedIdx]?.impliedProbability ?? 0;

    // ── 2. ELO-only: rank by eloWinProbabilities ────────────────────────────
    const eloProbs = eloWinProbabilities(driverIds, race.id);
    const eloRanked = [...odds].sort(
      (a, b) => (eloProbs.get(b.driverId) ?? 0) - (eloProbs.get(a.driverId) ?? 0)
    );
    const winnerEloIdx = eloRanked.findIndex((o) => o.driverId === winner.driver_id);
    const winnerRankElo = winnerEloIdx >= 0 ? winnerEloIdx + 1 : odds.length;

    // ── 3. Composite-only: rank by rawScore ──────────────────────────────────
    const compositeRanked = [...odds].sort((a, b) => b.rawScore - a.rawScore);
    const winnerCompositeIdx = compositeRanked.findIndex((o) => o.driverId === winner.driver_id);
    const winnerRankComposite = winnerCompositeIdx >= 0 ? winnerCompositeIdx + 1 : odds.length;

    // ── Accumulate stats ─────────────────────────────────────────────────────
    function record(variant: VariantSummary, winnerRank: number) {
      variant.racesRun++;
      variant.totalWinnerRank += winnerRank;
      if (winnerRank === 1) variant.favoriteWonCount++;
      if (winnerRank <= 3) variant.top3WonCount++;
    }

    record(result.blended, winnerRankBlended);
    record(result.elo_only, winnerRankElo);
    record(result.composite_only, winnerRankComposite);

    result.races.push({
      raceId: race.id,
      raceName: race.name,
      raceDate: race.race_date,
      trackName: race.track_name,
      fieldSize: odds.length,
      actualWinner: winner.driver_name,
      actualWinnerProb,
      winnerRankBlended,
      winnerRankElo,
      winnerRankComposite,
      favoriteNameBlended: blendedRanked[0]?.driverName ?? "—",
      favoriteNameElo: eloRanked[0]?.driverName ?? "—",
      favoriteNameComposite: compositeRanked[0]?.driverName ?? "—",
    });
  }

  return result;
}
