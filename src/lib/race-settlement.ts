import "server-only";
import { getRaceEntries, recordResult, completeRace, lockBetting } from "@/lib/races";
import { settleBets } from "@/lib/book";
import { settlePlayerBets, type SettleResult } from "@/lib/player-bets";

export type ImportedRaceResult = {
  driver_name: string;
  car_number: string | null;
  finishing_position: number;
  starting_position: number | null;
  laps_led: number;
  dnf: boolean;
};

export type RaceSettlementResult = {
  synced: number;
  total: number;
  winner_driver_id: number | null;
  winner_name: string | null;
  unmatched: string[];
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export async function applyRaceResults(
  raceId: number,
  results: ImportedRaceResult[],
  source: string
): Promise<RaceSettlementResult> {
  if (results.length === 0) {
    throw new Error("No results were found to settle.");
  }

  const entries = getRaceEntries(raceId);
  const usedDriverIds = new Set<number>();
  const unmatched: string[] = [];
  const settlementRows: SettleResult[] = [];
  let winnerDriverId: number | null = null;
  let winnerName: string | null = null;
  let synced = 0;

  lockBetting(raceId, `results import: ${source}`);

  for (const result of results) {
    const normalizedResultName = normalizeName(result.driver_name);
    const car = result.car_number?.trim().toLowerCase() ?? null;
    const match = entries.find((entry) => {
      if (usedDriverIds.has(entry.driver_id)) return false;
      if (normalizeName(entry.driver_name) === normalizedResultName) return true;
      if (car && entry.car_number?.trim().toLowerCase() === car) return true;
      const resultLast = normalizedResultName.split(" ").pop();
      const entryLast = normalizeName(entry.driver_name).split(" ").pop();
      return !!resultLast && resultLast.length >= 3 && resultLast === entryLast;
    });

    if (!match) {
      unmatched.push(result.driver_name);
      continue;
    }

    usedDriverIds.add(match.driver_id);
    recordResult({
      race_id: raceId,
      driver_id: match.driver_id,
      finishing_position: result.finishing_position,
      starting_position: result.starting_position,
      laps_led: result.laps_led,
      dnf: result.dnf,
    });
    settlementRows.push({
      driver_id: match.driver_id,
      finishing_position: result.finishing_position,
      laps_led: result.laps_led,
      dnf: result.dnf,
    });
    synced++;

    if (result.finishing_position === 1 && !result.dnf) {
      winnerDriverId = match.driver_id;
      winnerName = match.driver_name;
    }
  }

  if (synced === 0) {
    throw new Error("Results were fetched, but none matched drivers in this race.");
  }

  completeRace(raceId, source);
  if (winnerDriverId !== null) settleBets(raceId, winnerDriverId);
  await settlePlayerBets(raceId, settlementRows);

  return {
    synced,
    total: results.length,
    winner_driver_id: winnerDriverId,
    winner_name: winnerName,
    unmatched,
  };
}
