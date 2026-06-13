import "server-only";
import { getDb } from "./db";
import { calculateRaceOdds } from "./odds";
import { oddsToMultiplier } from "./book";

export type PropType = "win" | "top3" | "top5" | "h2h" | "dnf" | "laps_led";

export type PlayerAccount = {
  id: number;
  name: string;
  balance: number;
  created_at: string;
};

export type PlayerBet = {
  id: number;
  account_id: number;
  account_name: string;
  race_id: number;
  race_name: string;
  prop_type: PropType;
  description: string;
  driver_id: number | null;
  driver_name: string | null;
  driver_b_id: number | null;
  driver_b_name: string | null;
  american_odds: string;
  stake: number;
  payout_if_win: number;
  status: "open" | "won" | "lost" | "void";
  created_at: string;
};

export type PropMarket = {
  type: PropType;
  section: string;
  description: string;
  driver_id: number | null;
  driver_name: string | null;
  driver_b_id: number | null;
  driver_b_name: string | null;
  american_odds: string;
  implied_probability: number;
};

function toAmericanOdds(p: number): string {
  if (p >= 1) return "-∞";
  if (p <= 0) return "+∞";
  const odds = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  return odds < 0 ? Math.round(odds).toString() : `+${Math.round(odds)}`;
}

function propVig(p: number, vig: number): number {
  return Math.min(0.95, p * (1 + vig));
}

export function getOrCreateAccount(name: string): PlayerAccount {
  const db = getDb();
  const trimmed = name.trim();
  const existing = db
    .prepare("SELECT * FROM player_accounts WHERE name = ? COLLATE NOCASE")
    .get(trimmed) as PlayerAccount | undefined;
  if (existing) return existing;
  const result = db
    .prepare("INSERT INTO player_accounts (name) VALUES (?)")
    .run(trimmed);
  return db
    .prepare("SELECT * FROM player_accounts WHERE id = ?")
    .get(result.lastInsertRowid) as PlayerAccount;
}

export function getAccountByName(name: string): PlayerAccount | null {
  return (
    (getDb()
      .prepare("SELECT * FROM player_accounts WHERE name = ? COLLATE NOCASE")
      .get(name.trim()) as PlayerAccount) ?? null
  );
}

export function getAccount(id: number): PlayerAccount | null {
  return (
    (getDb()
      .prepare("SELECT * FROM player_accounts WHERE id = ?")
      .get(id) as PlayerAccount) ?? null
  );
}

export function listAccounts(): PlayerAccount[] {
  return getDb()
    .prepare("SELECT * FROM player_accounts ORDER BY name")
    .all() as PlayerAccount[];
}

export function addFunds(accountId: number, amount: number): void {
  getDb()
    .prepare("UPDATE player_accounts SET balance = balance + ? WHERE id = ?")
    .run(amount, accountId);
}

export function placePlayerBet(data: {
  account_id: number;
  race_id: number;
  prop_type: PropType;
  description: string;
  driver_id: number | null;
  driver_b_id: number | null;
  american_odds: string;
  stake: number;
}): void {
  const db = getDb();
  const account = db
    .prepare("SELECT balance FROM player_accounts WHERE id = ?")
    .get(data.account_id) as { balance: number } | undefined;
  if (!account) throw new Error("Account not found.");
  if (account.balance < data.stake) {
    throw new Error(`Insufficient balance. You have $${account.balance.toFixed(2)}.`);
  }
  const payout_if_win = data.stake + data.stake * oddsToMultiplier(data.american_odds);
  db.prepare("UPDATE player_accounts SET balance = balance - ? WHERE id = ?").run(
    data.stake,
    data.account_id
  );
  db.prepare(
    `INSERT INTO player_bets
       (account_id, race_id, prop_type, description, driver_id, driver_b_id, american_odds, stake, payout_if_win)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.account_id,
    data.race_id,
    data.prop_type,
    data.description,
    data.driver_id,
    data.driver_b_id,
    data.american_odds,
    data.stake,
    payout_if_win
  );
}

export function getAccountBets(accountId: number): PlayerBet[] {
  return getDb()
    .prepare(
      `SELECT pb.*, pa.name AS account_name, r.name AS race_name,
              d1.name AS driver_name, d2.name AS driver_b_name
       FROM player_bets pb
       JOIN player_accounts pa ON pa.id = pb.account_id
       JOIN races r ON r.id = pb.race_id
       LEFT JOIN drivers d1 ON d1.id = pb.driver_id
       LEFT JOIN drivers d2 ON d2.id = pb.driver_b_id
       WHERE pb.account_id = ?
       ORDER BY pb.created_at DESC`
    )
    .all(accountId) as PlayerBet[];
}

export function getPlayerRaceBets(accountId: number, raceId: number): PlayerBet[] {
  return getDb()
    .prepare(
      `SELECT pb.*, pa.name AS account_name, r.name AS race_name,
              d1.name AS driver_name, d2.name AS driver_b_name
       FROM player_bets pb
       JOIN player_accounts pa ON pa.id = pb.account_id
       JOIN races r ON r.id = pb.race_id
       LEFT JOIN drivers d1 ON d1.id = pb.driver_id
       LEFT JOIN drivers d2 ON d2.id = pb.driver_b_id
       WHERE pb.account_id = ? AND pb.race_id = ?
       ORDER BY pb.created_at DESC`
    )
    .all(accountId, raceId) as PlayerBet[];
}

export type SettleResult = {
  driver_id: number;
  finishing_position: number | null;
  laps_led: number;
  dnf: boolean;
};

export function settlePlayerBets(raceId: number, results: SettleResult[]): void {
  const db = getDb();
  const bets = db
    .prepare("SELECT * FROM player_bets WHERE race_id = ? AND status = 'open'")
    .all(raceId) as Array<{
    id: number;
    account_id: number;
    prop_type: PropType;
    driver_id: number | null;
    driver_b_id: number | null;
    stake: number;
    payout_if_win: number;
  }>;

  const posMap = new Map(results.map((r) => [r.driver_id, r]));

  for (const bet of bets) {
    let won = false;
    let shouldVoid = false;

    const dR = bet.driver_id != null ? posMap.get(bet.driver_id) : undefined;
    const dBR = bet.driver_b_id != null ? posMap.get(bet.driver_b_id) : undefined;

    switch (bet.prop_type) {
      case "win":
        won = !!dR && dR.finishing_position === 1 && !dR.dnf;
        break;
      case "top3":
        won = !!dR && !dR.dnf && (dR.finishing_position ?? 999) <= 3;
        break;
      case "top5":
        won = !!dR && !dR.dnf && (dR.finishing_position ?? 999) <= 5;
        break;
      case "h2h": {
        if (!dR || !dBR) { shouldVoid = true; break; }
        const posA = dR.dnf ? 9999 : (dR.finishing_position ?? 9999);
        const posB = dBR.dnf ? 9999 : (dBR.finishing_position ?? 9999);
        if (posA === posB) { shouldVoid = true; break; }
        won = posA < posB;
        break;
      }
      case "dnf":
        won = !!dR && dR.dnf;
        break;
      case "laps_led":
        won = !!dR && dR.laps_led > 0;
        break;
    }

    if (shouldVoid) {
      db.prepare("UPDATE player_bets SET status = 'void' WHERE id = ?").run(bet.id);
      db.prepare("UPDATE player_accounts SET balance = balance + ? WHERE id = ?").run(
        bet.stake,
        bet.account_id
      );
    } else if (won) {
      db.prepare("UPDATE player_bets SET status = 'won' WHERE id = ?").run(bet.id);
      db.prepare("UPDATE player_accounts SET balance = balance + ? WHERE id = ?").run(
        bet.payout_if_win,
        bet.account_id
      );
    } else {
      db.prepare("UPDATE player_bets SET status = 'lost' WHERE id = ?").run(bet.id);
    }
  }
}

export function generateProps(raceId: number, trackId: number): PropMarket[] {
  const odds = calculateRaceOdds(raceId, trackId);
  if (odds.length === 0) return [];

  const markets: PropMarket[] = [];

  const sumImplied = odds.reduce((s, o) => s + o.impliedProbability, 0);
  const withTrue = odds.map((o) => ({
    ...o,
    trueProb: sumImplied > 0 ? o.impliedProbability / sumImplied : 1 / odds.length,
  }));

  // Win market
  for (const o of withTrue) {
    markets.push({
      type: "win",
      section: "Race Winner",
      description: `${o.driverName} to Win`,
      driver_id: o.driverId,
      driver_name: o.driverName,
      driver_b_id: null,
      driver_b_name: null,
      american_odds: o.americanOdds,
      implied_probability: o.impliedProbability,
    });
  }

  // Top 3 finish (up to 12 drivers)
  const top12 = withTrue.slice(0, Math.min(12, withTrue.length));
  for (const o of top12) {
    const pTrue = Math.min(0.92, 1 - Math.pow(1 - o.trueProb, 2.5));
    const p = propVig(pTrue, 0.07);
    markets.push({
      type: "top3",
      section: "Top 3 Finish",
      description: `${o.driverName} Top 3`,
      driver_id: o.driverId,
      driver_name: o.driverName,
      driver_b_id: null,
      driver_b_name: null,
      american_odds: toAmericanOdds(p),
      implied_probability: p,
    });
  }

  // Head-to-head matchups between top drivers
  const top8 = withTrue.slice(0, Math.min(8, withTrue.length));
  const pairsDone = new Set<string>();

  const addPair = (
    a: (typeof withTrue)[number],
    b: (typeof withTrue)[number]
  ) => {
    const key = [a.driverId, b.driverId].sort().join("-");
    if (pairsDone.has(key)) return;
    pairsDone.add(key);
    const pA = a.trueProb / (a.trueProb + b.trueProb);
    const pB = 1 - pA;
    markets.push({
      type: "h2h",
      section: "Head to Head",
      description: `${a.driverName} beats ${b.driverName}`,
      driver_id: a.driverId,
      driver_name: a.driverName,
      driver_b_id: b.driverId,
      driver_b_name: b.driverName,
      american_odds: toAmericanOdds(propVig(pA, 0.05)),
      implied_probability: propVig(pA, 0.05),
    });
    markets.push({
      type: "h2h",
      section: "Head to Head",
      description: `${b.driverName} beats ${a.driverName}`,
      driver_id: b.driverId,
      driver_name: b.driverName,
      driver_b_id: a.driverId,
      driver_b_name: a.driverName,
      american_odds: toAmericanOdds(propVig(pB, 0.05)),
      implied_probability: propVig(pB, 0.05),
    });
  };

  // Adjacent pairs + cross matchups for variety
  for (let i = 0; i < top8.length - 1 && i < 5; i++) addPair(top8[i], top8[i + 1]);
  if (top8.length >= 3) addPair(top8[0], top8[2]);
  if (top8.length >= 4) { addPair(top8[0], top8[3]); addPair(top8[1], top8[3]); }

  // DNF props for drivers with elevated DNF history
  for (const o of withTrue) {
    const dnfRate = o.reasoning.dnfRate;
    if (dnfRate !== null && dnfRate >= 0.15) {
      const pDnf = Math.min(0.45, Math.max(0.08, dnfRate));
      markets.push({
        type: "dnf",
        section: "DNF Props",
        description: `${o.driverName} Will Not Finish`,
        driver_id: o.driverId,
        driver_name: o.driverName,
        driver_b_id: null,
        driver_b_name: null,
        american_odds: toAmericanOdds(propVig(pDnf, 0.08)),
        implied_probability: propVig(pDnf, 0.08),
      });
    }
  }

  // Laps Led props for the top 5 favorites
  const top5 = withTrue.slice(0, Math.min(5, withTrue.length));
  for (const o of top5) {
    const pLeads = Math.min(0.80, o.trueProb * 2.2);
    markets.push({
      type: "laps_led",
      section: "Leads a Lap",
      description: `${o.driverName} Leads a Lap`,
      driver_id: o.driverId,
      driver_name: o.driverName,
      driver_b_id: null,
      driver_b_name: null,
      american_odds: toAmericanOdds(propVig(pLeads, 0.07)),
      implied_probability: propVig(pLeads, 0.07),
    });
  }

  return markets;
}
