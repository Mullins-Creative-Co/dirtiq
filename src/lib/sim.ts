import "server-only";
import { getDb } from "./db";
import { payoutFromOdds, getRiskLimits } from "./book";

export type Bettor = {
  id: number;
  name: string;
  persona: string;
  bankroll: number;
  created_at: string;
};

export type SimBet = {
  id: number;
  race_id: number;
  bettor_id: number;
  bettor_name: string;
  driver_id: number;
  driver_name: string;
  amount: number;
  american_odds: string;
  payout_if_win: number;
  status: "open" | "won" | "lost" | "void" | "blocked";
  blocked_reason: string | null;
  created_at: string;
};

export type SimBettorResult = {
  bettor_id: number;
  bettor_name: string;
  persona: string;
  bankroll: number;
  bets: number;
  blocked: number;
  total_staked: number;
  total_won: number; // payout received (includes stake)
  net_pl: number;   // bettor P&L: won - staked
};

export type SimBookSummary = {
  total_handle: number;
  num_bets: number;
  num_blocked: number;
  worst_case_pl: number;
  best_case_pl: number;
};

export type OddsInput = {
  driverId: number;
  driverName: string;
  americanOdds: string;
  impliedProbability: number;
};

type BetSpec = { driver_id: number; driver_name: string; amount: number; american_odds: string };

function weightedPick<T>(items: T[], weightFn: (item: T) => number): T {
  const weights = items.map(weightFn);
  const total = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  if (total === 0) return items[Math.floor(Math.random() * items.length)];
  let rand = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= Math.max(weights[i], 0);
    if (rand <= 0) return items[i];
  }
  return items[items.length - 1];
}

function pick(items: OddsInput[], n: number, weightFn: (o: OddsInput) => number): OddsInput[] {
  const pool = [...items];
  const result: OddsInput[] = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    const chosen = weightedPick(pool, weightFn);
    result.push(chosen);
    pool.splice(pool.indexOf(chosen), 1);
  }
  return result;
}

function rand(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

function generatePersonaBets(persona: string, bankroll: number, odds: OddsInput[]): BetSpec[] {
  if (odds.length === 0) return [];

  const sorted = [...odds].sort((a, b) => b.impliedProbability - a.impliedProbability);
  const favorites = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.3)));
  const midtier  = sorted.slice(Math.ceil(sorted.length * 0.3), Math.ceil(sorted.length * 0.7));
  const longshots = sorted.slice(Math.ceil(sorted.length * 0.7));

  switch (persona) {
    case "square": {
      // 2-3 bets, heavily weighted toward top half, average stakes
      const picks = pick(sorted, 2 + Math.floor(Math.random() * 2), o => o.impliedProbability * 2);
      return picks.map(o => ({ driver_id: o.driverId, driver_name: o.driverName, amount: rand(20, 80), american_odds: o.americanOdds }));
    }

    case "chalk_chaser": {
      // 1-2 big bets on the favorite(s)
      const top = favorites.slice(0, 1 + Math.floor(Math.random() * 2));
      return top.map(o => ({ driver_id: o.driverId, driver_name: o.driverName, amount: rand(100, 300), american_odds: o.americanOdds }));
    }

    case "contrarian": {
      // 2-3 bets on mid-tier and longshots
      const pool = [...midtier, ...longshots];
      if (pool.length === 0) return [];
      const picks = pick(pool, 2 + Math.floor(Math.random() * 2), o => 1 / (o.impliedProbability + 0.01));
      return picks.map(o => ({ driver_id: o.driverId, driver_name: o.driverName, amount: rand(25, 75), american_odds: o.americanOdds }));
    }

    case "sharp": {
      // Finds value: drivers where implied odds undervalue them (low implied prob relative to raw score)
      // Proxy: bet underdogs in the top half of probability — likely where model diverges from public line
      const valueTargets = sorted.filter(o => {
        const decimal = o.americanOdds.startsWith("+")
          ? parseInt(o.americanOdds) / 100 + 1
          : 100 / Math.abs(parseInt(o.americanOdds)) + 1;
        const impliedFromOdds = 1 / decimal;
        return impliedFromOdds < o.impliedProbability * 0.85; // odds understate model confidence
      });
      const pool = valueTargets.length > 0 ? valueTargets : favorites.slice(0, 2);
      const picks = pick(pool, 1 + Math.floor(Math.random() * 2), o => o.impliedProbability);
      return picks.map(o => ({ driver_id: o.driverId, driver_name: o.driverName, amount: rand(75, 200), american_odds: o.americanOdds }));
    }

    case "small_stakes": {
      // 3-5 small bets on random longshots
      const pool = longshots.length >= 2 ? longshots : sorted;
      const picks = pick(pool, 3 + Math.floor(Math.random() * 3), () => 1);
      return picks.map(o => ({ driver_id: o.driverId, driver_name: o.driverName, amount: rand(2, 10), american_odds: o.americanOdds }));
    }

    case "high_roller": {
      // 1-2 large bets on top 2 favorites
      const top = favorites.slice(0, 2);
      return top.map(o => ({ driver_id: o.driverId, driver_name: o.driverName, amount: rand(200, 600), american_odds: o.americanOdds }));
    }

    default:
      return [];
  }
}

export function listBettors(): Bettor[] {
  return getDb().prepare(`SELECT * FROM bettors ORDER BY id`).all() as Bettor[];
}

export function getSimBets(raceId: number): SimBet[] {
  return getDb()
    .prepare(
      `SELECT s.*, b.name AS bettor_name, d.name AS driver_name
       FROM sim_bets s
       JOIN bettors b ON b.id = s.bettor_id
       JOIN drivers d ON d.id = s.driver_id
       WHERE s.race_id = ?
       ORDER BY s.created_at DESC`
    )
    .all(raceId) as SimBet[];
}

export function getSimBettorResults(raceId: number): SimBettorResult[] {
  const bettors = listBettors();
  return bettors.map((bettor) => {
    const rows = getDb()
      .prepare(
        `SELECT status, amount, payout_if_win
         FROM sim_bets WHERE race_id = ? AND bettor_id = ?`
      )
      .all(raceId, bettor.id) as Array<{ status: string; amount: number; payout_if_win: number }>;

    const activeBets = rows.filter((r) => r.status !== "blocked");
    const total_staked = activeBets.reduce((s, r) => s + r.amount, 0);
    const total_won = activeBets.filter((r) => r.status === "won").reduce((s, r) => s + r.payout_if_win, 0);
    const net_pl = total_won - total_staked;

    return {
      bettor_id: bettor.id,
      bettor_name: bettor.name,
      persona: bettor.persona,
      bankroll: bettor.bankroll,
      bets: activeBets.length,
      blocked: rows.filter((r) => r.status === "blocked").length,
      total_staked,
      total_won,
      net_pl,
    };
  });
}

export function getSimBookSummary(raceId: number): SimBookSummary {
  const db = getDb();

  const { handle, num_bets, num_blocked } = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status != 'blocked' THEN amount ELSE 0 END), 0) AS handle,
         COUNT(CASE WHEN status != 'blocked' THEN 1 END) AS num_bets,
         COUNT(CASE WHEN status = 'blocked' THEN 1 END) AS num_blocked
       FROM sim_bets WHERE race_id = ?`
    )
    .get(raceId) as { handle: number; num_bets: number; num_blocked: number };

  const payouts = db
    .prepare(
      `SELECT COALESCE(SUM(payout_if_win), 0) AS total_payout
       FROM sim_bets WHERE race_id = ? AND status NOT IN ('blocked','void')
       GROUP BY driver_id ORDER BY total_payout DESC`
    )
    .all(raceId) as Array<{ total_payout: number }>;

  const maxPayout = payouts[0]?.total_payout ?? 0;
  const minPayout = payouts[payouts.length - 1]?.total_payout ?? 0;

  return {
    total_handle: handle,
    num_bets,
    num_blocked,
    worst_case_pl: handle - maxPayout,
    best_case_pl: handle - minPayout,
  };
}

function tryPlaceSimBet(data: {
  race_id: number;
  bettor_id: number;
  driver_id: number;
  driver_name: string;
  amount: number;
  american_odds: string;
}): { blocked: boolean; blocked_reason?: string } {
  const db = getDb();
  const limits = getRiskLimits(data.race_id);

  let blocked_reason: string | null = null;

  if (limits.max_bet_size !== null && data.amount > limits.max_bet_size) {
    blocked_reason = `Stake $${data.amount.toFixed(2)} exceeds max bet size of $${limits.max_bet_size.toFixed(2)}`;
  }

  const payout_if_win = payoutFromOdds(data.amount, data.american_odds);

  if (!blocked_reason && limits.max_payout_per_driver !== null) {
    const { current } = db
      .prepare(
        `SELECT COALESCE(SUM(payout_if_win), 0) AS current
         FROM sim_bets WHERE race_id = ? AND driver_id = ? AND status NOT IN ('blocked','void')`
      )
      .get(data.race_id, data.driver_id) as { current: number };
    if (current + payout_if_win > limits.max_payout_per_driver) {
      blocked_reason = `Payout would exceed max exposure of $${limits.max_payout_per_driver.toFixed(2)} on ${data.driver_name}`;
    }
  }

  db.prepare(
    `INSERT INTO sim_bets (race_id, bettor_id, driver_id, amount, american_odds, payout_if_win, status, blocked_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.race_id,
    data.bettor_id,
    data.driver_id,
    data.amount,
    data.american_odds,
    payout_if_win,
    blocked_reason ? "blocked" : "open",
    blocked_reason
  );

  return blocked_reason ? { blocked: true, blocked_reason } : { blocked: false };
}

export function runSimulation(
  raceId: number,
  odds: OddsInput[]
): { placed: number; blocked: number } {
  const bettors = listBettors();
  let placed = 0;
  let blocked = 0;

  for (const bettor of bettors) {
    const bets = generatePersonaBets(bettor.persona, bettor.bankroll, odds);
    for (const bet of bets) {
      const result = tryPlaceSimBet({
        race_id: raceId,
        bettor_id: bettor.id,
        driver_id: bet.driver_id,
        driver_name: bet.driver_name,
        amount: bet.amount,
        american_odds: bet.american_odds,
      });
      if (result.blocked) blocked++;
      else placed++;
    }
  }

  return { placed, blocked };
}

export function simulateWinner(odds: OddsInput[]): number {
  if (odds.length === 0) throw new Error("No drivers in field");
  const total = odds.reduce((s, o) => s + o.impliedProbability, 0);
  let rand = Math.random() * total;
  for (const o of odds) {
    rand -= o.impliedProbability;
    if (rand <= 0) return o.driverId;
  }
  return odds[odds.length - 1].driverId;
}

export function settleSimBets(raceId: number, winningDriverId: number): void {
  const db = getDb();
  db.prepare(`UPDATE sim_bets SET status = 'won'  WHERE race_id = ? AND driver_id = ? AND status = 'open'`).run(raceId, winningDriverId);
  db.prepare(`UPDATE sim_bets SET status = 'lost' WHERE race_id = ? AND driver_id != ? AND status = 'open'`).run(raceId, winningDriverId);
}

export function placeManualSimBet(data: {
  race_id: number;
  bettor_id: number;
  driver_id: number;
  driver_name: string;
  amount: number;
  american_odds: string;
}): { blocked: boolean; blocked_reason?: string } {
  return tryPlaceSimBet(data);
}

export function clearSimBets(raceId: number): void {
  getDb().prepare(`DELETE FROM sim_bets WHERE race_id = ?`).run(raceId);
}
