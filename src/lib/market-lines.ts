import "server-only";

import { getDb } from "@/lib/db";
import { priceOutrightWinnerLines, type BookExposureInput } from "@/lib/book-pricing";
import { buildPredictionCard } from "@/lib/prediction-card";

export type MarketLine = {
  race_id: number;
  driver_id: number;
  driver_name: string;
  market_odds: string;
  source: string;
  rationale: string | null;
  updated_at: string;
};

function isValidAmericanOdds(value: string) {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return false;
  const odds = Number(trimmed);
  return Number.isFinite(odds) && odds !== 0;
}

export function americanOddsToImpliedProbability(odds: string) {
  const n = Number(odds.replace(/^\+/, ""));
  if (!Number.isFinite(n) || n === 0) return null;

  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

export function listMarketLines(raceId: number): MarketLine[] {
  return getDb()
    .prepare(
      `SELECT ml.*, d.name AS driver_name
       FROM market_lines ml
       JOIN drivers d ON d.id = ml.driver_id
       JOIN race_entries re ON re.race_id = ml.race_id AND re.driver_id = ml.driver_id
       WHERE ml.race_id = ?
         AND COALESCE(re.entry_status, 'expected') != 'scratched'
       ORDER BY d.name`
    )
    .all(raceId) as MarketLine[];
}

export function getMarketLineMap(raceId: number): Record<number, string> {
  return Object.fromEntries(
    listMarketLines(raceId).map((line) => [line.driver_id, line.market_odds])
  );
}

export function getMarketLineDetailMap(raceId: number): Record<
  number,
  { marketOdds: string; source: string; rationale: string | null; updatedAt: string }
> {
  return Object.fromEntries(
    listMarketLines(raceId).map((line) => [
      line.driver_id,
      {
        marketOdds: line.market_odds,
        source: line.source,
        rationale: line.rationale,
        updatedAt: line.updated_at,
      },
    ])
  );
}

export function getOutrightExposureMap(raceId: number): Map<number, BookExposureInput> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT driver_id,
              COALESCE(SUM(total_staked), 0) AS total_staked,
              COALESCE(SUM(payout_if_win), 0) AS payout_if_win
       FROM (
         SELECT driver_id,
                SUM(stake) AS total_staked,
                SUM(payout_if_win) AS payout_if_win
         FROM player_bets
         WHERE race_id = ?
           AND status = 'open'
           AND prop_type = 'win'
           AND driver_id IS NOT NULL
         GROUP BY driver_id
         UNION ALL
         SELECT driver_id,
                SUM(amount) AS total_staked,
                SUM(payout_if_win) AS payout_if_win
         FROM bets
         WHERE race_id = ?
           AND status = 'open'
         GROUP BY driver_id
       )
       GROUP BY driver_id`
    )
    .all(raceId, raceId) as Array<{
      driver_id: number;
      total_staked: number;
      payout_if_win: number;
    }>;
  const totalHandle = rows.reduce((sum, row) => sum + Number(row.total_staked ?? 0), 0);

  return new Map(
    rows.map((row) => [
      row.driver_id,
      {
        totalHandle,
        totalStaked: Number(row.total_staked ?? 0),
        payoutIfWin: Number(row.payout_if_win ?? 0),
      },
    ])
  );
}

export function upsertMarketLine(data: {
  race_id: number;
  driver_id: number;
  market_odds: string;
  source?: string;
  rationale?: string | null;
}) {
  const marketOdds = data.market_odds.trim();
  if (!isValidAmericanOdds(marketOdds)) {
    throw new Error("Enter American odds like +450 or -120.");
  }

  const db = getDb();
  const entry = db
    .prepare("SELECT entry_status FROM race_entries WHERE race_id = ? AND driver_id = ?")
    .get(data.race_id, data.driver_id) as { entry_status: string | null } | undefined;

  if (!entry) {
    throw new Error("Driver is not entered in this race.");
  }
  if ((entry.entry_status ?? "expected") === "scratched") {
    throw new Error("Driver is scratched from this race.");
  }

  db.prepare(
    `INSERT INTO market_lines (race_id, driver_id, market_odds, source, rationale, updated_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(race_id, driver_id) DO UPDATE SET
       market_odds = excluded.market_odds,
       source = excluded.source,
       rationale = excluded.rationale,
       updated_at = excluded.updated_at`
  ).run(
    data.race_id,
    data.driver_id,
    marketOdds,
    data.source ?? "manual",
    data.rationale ?? null
  );
}

export function deleteMarketLine(raceId: number, driverId: number) {
  getDb()
    .prepare("DELETE FROM market_lines WHERE race_id = ? AND driver_id = ?")
    .run(raceId, driverId);
}

export function clearMarketLines(raceId: number) {
  const result = getDb()
    .prepare("DELETE FROM market_lines WHERE race_id = ?")
    .run(raceId);

  return Number(result.changes);
}

export function applyRationalMarketLines(raceId: number) {
  const card = buildPredictionCard(raceId);
  if (!card) throw new Error("Race not found.");
  if (card.fieldSize === 0) throw new Error("Race has no entries.");

  const prices = priceOutrightWinnerLines(card, getOutrightExposureMap(raceId));
  const firstPrice = prices[0];
  const source = firstPrice?.stage === "race-night" ? "book-model-race-night" : firstPrice?.stage === "confirmed" ? "book-model-confirmed" : "book-model-open";
  const db = getDb();
  const priceMap = new Map(prices.map((price) => [price.driverId, price]));

  const lines = card.rows.flatMap((row) => {
    const price = priceMap.get(row.driverId);
    if (!price) return [];
    const topReason = row.caveatMultiplier < 1
      ? row.warnings[0] ?? "active line caveat"
      : row.reasons[0] ?? "model rank and field-relative probability";

    return [{
      race_id: raceId,
      driver_id: row.driverId,
      market_odds: price.americanOdds,
      source,
      rationale: `${price.rationale}; ${row.confidence.toLowerCase()} confidence; ${topReason}`,
    }];
  });

  db.exec("BEGIN");
  try {
    db.prepare(
      `DELETE FROM market_lines
       WHERE race_id = ?
         AND driver_id IN (
           SELECT driver_id
           FROM race_entries
           WHERE race_id = ?
             AND COALESCE(entry_status, 'expected') = 'scratched'
         )`
    ).run(raceId, raceId);

    for (const line of lines) {
      upsertMarketLine(line);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    raceId,
    raceName: card.raceName,
    fieldSize: card.fieldSize,
    hold: firstPrice?.hold ?? 0,
    source,
    missingRaceNightInputs: firstPrice?.stage !== "race-night",
    linesWritten: lines.length,
  };
}
