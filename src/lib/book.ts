import "server-only";
import { getDb } from "./db";
import { isRaceBettingOpen } from "./races";

export type RiskLimits = {
  race_id: number;
  max_payout_per_driver: number | null;
  max_bet_size: number | null;
  alert_handle_pct: number;
};

export type Bet = {
  id: number;
  race_id: number;
  driver_id: number;
  driver_name: string;
  bettor_name: string | null;
  amount: number;
  american_odds: string;
  payout_if_win: number;
  status: "open" | "won" | "lost" | "void";
  created_at: string;
};

export type DriverLiability = {
  driver_id: number;
  driver_name: string;
  num_bets: number;
  total_staked: number;
  payout_if_win: number;
  net_pl_if_win: number; // house perspective: positive = profit, negative = loss
  handle_pct: number;   // share of total handle on this driver
};

export type BookSummary = {
  total_handle: number;
  num_bets: number;
  worst_case_pl: number;   // most negative outcome for house
  best_case_pl: number;    // most positive outcome for house
  uncovered_drivers: number; // drivers in field with zero bets (free outcomes for house)
};

/** American odds string → profit multiplier (profit per $1 staked, not including stake) */
export function oddsToMultiplier(odds: string): number {
  const n = parseInt(odds, 10);
  if (isNaN(n)) return 1;
  return n > 0 ? n / 100 : 100 / Math.abs(n);
}

export function payoutFromOdds(stake: number, odds: string): number {
  return stake + stake * oddsToMultiplier(odds);
}

export function getRiskLimits(raceId: number): RiskLimits {
  const row = getDb()
    .prepare(`SELECT * FROM race_risk_limits WHERE race_id = ?`)
    .get(raceId) as RiskLimits | undefined;
  return row ?? { race_id: raceId, max_payout_per_driver: null, max_bet_size: null, alert_handle_pct: 0.30 };
}

export function setRiskLimits(data: {
  race_id: number;
  max_payout_per_driver: number | null;
  max_bet_size: number | null;
  alert_handle_pct: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO race_risk_limits (race_id, max_payout_per_driver, max_bet_size, alert_handle_pct)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(race_id) DO UPDATE SET
         max_payout_per_driver = excluded.max_payout_per_driver,
         max_bet_size = excluded.max_bet_size,
         alert_handle_pct = excluded.alert_handle_pct`
    )
    .run(data.race_id, data.max_payout_per_driver, data.max_bet_size, data.alert_handle_pct);
}

export function placeBet(data: {
  race_id: number;
  driver_id: number;
  bettor_name?: string;
  amount: number;
  american_odds: string;
}): void {
  const db = getDb();
  const race = db
    .prepare("SELECT race_date, division, series_mode, status, is_live, betting_status FROM races WHERE id = ?")
    .get(data.race_id) as
      | { race_date: string; division: string | null; series_mode: string | null; status: string; is_live: number; betting_status: string | null }
      | undefined;
  if (!race) throw new Error("Race not found.");
  if (!isRaceBettingOpen(race)) {
    throw new Error("Betting is closed for this race.");
  }

  const scratched = db
    .prepare(
      `SELECT d.name
       FROM race_entries re
       JOIN drivers d ON d.id = re.driver_id
       WHERE re.race_id = ?
         AND re.driver_id = ?
         AND COALESCE(re.entry_status, 'expected') = 'scratched'`
    )
    .get(data.race_id, data.driver_id) as { name: string } | undefined;
  if (scratched) {
    throw new Error(`${scratched.name} is scratched and not bettable.`);
  }

  const limits = getRiskLimits(data.race_id);

  if (limits.max_bet_size !== null && data.amount > limits.max_bet_size) {
    throw new Error(`Stake exceeds max bet size of $${limits.max_bet_size.toFixed(2)}.`);
  }

  const payout_if_win = payoutFromOdds(data.amount, data.american_odds);

  if (limits.max_payout_per_driver !== null) {
    const { current } = db
      .prepare(
        `SELECT COALESCE(SUM(payout_if_win), 0) AS current
         FROM bets WHERE race_id = ? AND driver_id = ? AND status != 'void'`
      )
      .get(data.race_id, data.driver_id) as { current: number };
    if (current + payout_if_win > limits.max_payout_per_driver) {
      const headroom = Math.max(0, limits.max_payout_per_driver - current);
      throw new Error(
        `Payout would exceed max exposure of $${limits.max_payout_per_driver.toFixed(2)} on this driver. Remaining headroom: $${headroom.toFixed(2)}.`
      );
    }
  }

  db.prepare(
      `INSERT INTO bets (race_id, driver_id, bettor_name, amount, american_odds, payout_if_win)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.race_id,
      data.driver_id,
      data.bettor_name?.trim() || null,
      data.amount,
      data.american_odds,
      payout_if_win
    );
}

export function getRaceBets(raceId: number): Bet[] {
  return getDb()
    .prepare(
      `SELECT b.*, d.name AS driver_name
       FROM bets b JOIN drivers d ON d.id = b.driver_id
       WHERE b.race_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(raceId) as Bet[];
}

export function getDriverLiabilities(raceId: number): DriverLiability[] {
  const db = getDb();

  const { handle } = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS handle
       FROM bets WHERE race_id = ? AND status != 'void'`
    )
    .get(raceId) as { handle: number };

  const rows = db
    .prepare(
      `SELECT b.driver_id, d.name AS driver_name,
              COUNT(*) AS num_bets,
              SUM(b.amount) AS total_staked,
              SUM(b.payout_if_win) AS payout_if_win
       FROM bets b JOIN drivers d ON d.id = b.driver_id
       WHERE b.race_id = ? AND b.status != 'void'
       GROUP BY b.driver_id
       ORDER BY payout_if_win DESC`
    )
    .all(raceId) as Array<{
      driver_id: number;
      driver_name: string;
      num_bets: number;
      total_staked: number;
      payout_if_win: number;
    }>;

  return rows.map((r) => ({
    driver_id: r.driver_id,
    driver_name: r.driver_name,
    num_bets: r.num_bets,
    total_staked: r.total_staked,
    payout_if_win: r.payout_if_win,
    net_pl_if_win: handle - r.payout_if_win,
    handle_pct: handle > 0 ? r.total_staked / handle : 0,
  }));
}

export function getBookSummary(raceId: number): BookSummary {
  const db = getDb();

  const { handle, num_bets } = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS handle, COUNT(*) AS num_bets
       FROM bets WHERE race_id = ? AND status != 'void'`
    )
    .get(raceId) as { handle: number; num_bets: number };

  // Payouts grouped by driver — worst case is the max payout on any one driver
  const payouts = db
    .prepare(
      `SELECT COALESCE(SUM(payout_if_win), 0) AS total_payout
       FROM bets WHERE race_id = ? AND status != 'void'
       GROUP BY driver_id
       ORDER BY total_payout DESC`
    )
    .all(raceId) as Array<{ total_payout: number }>;

  const maxPayout = payouts[0]?.total_payout ?? 0;
  const minPayout = payouts[payouts.length - 1]?.total_payout ?? 0;

  // Drivers in the field with zero action = free wins for the house
  const { uncovered } = db
    .prepare(
      `SELECT COUNT(*) AS uncovered
       FROM race_entries re
       WHERE re.race_id = ?
         AND COALESCE(re.entry_status, 'expected') != 'scratched'
         AND re.driver_id NOT IN (
           SELECT DISTINCT driver_id FROM bets WHERE race_id = ? AND status != 'void'
         )`
    )
    .get(raceId, raceId) as { uncovered: number };

  return {
    total_handle: handle,
    num_bets,
    worst_case_pl: handle - maxPayout,
    best_case_pl: handle - minPayout,
    uncovered_drivers: uncovered,
  };
}

export function settleBets(raceId: number, winningDriverId: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE bets SET status = 'won' WHERE race_id = ? AND driver_id = ? AND status = 'open'`
  ).run(raceId, winningDriverId);
  db.prepare(
    `UPDATE bets SET status = 'lost' WHERE race_id = ? AND driver_id != ? AND status = 'open'`
  ).run(raceId, winningDriverId);
}

export function voidBet(betId: number): void {
  getDb()
    .prepare(`UPDATE bets SET status = 'void' WHERE id = ?`)
    .run(betId);
}
