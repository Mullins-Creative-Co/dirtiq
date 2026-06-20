import "server-only";
import { getDb } from "./db";
import { calculateRaceOdds } from "./odds";
import { oddsToMultiplier } from "./book";
import { buildPredictionCard } from "./prediction-card";
import { ensureLiveBetTables, getLiveBetSql, hasLiveBetDatabase, toIsoString } from "./live-bets-db";
import { isRaceBettingOpen } from "./races";
import { assessPlayerBetUnderwriting } from "./underwriting";

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
  metric_series: string | null;
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

function getActiveDriverIds(raceId: number): Set<number> {
  const rows = getDb()
    .prepare(
      `SELECT driver_id
       FROM race_entries
       WHERE race_id = ?
         AND COALESCE(entry_status, 'expected') != 'scratched'`
    )
    .all(raceId) as Array<{ driver_id: number }>;
  return new Set(rows.map((row) => row.driver_id));
}

function assertDriversBettable(raceId: number, driverIds: Array<number | null>): void {
  const ids = driverIds.filter((id): id is number => id !== null);
  if (ids.length === 0) return;

  const placeholders = ids.map(() => "?").join(", ");
  const scratched = getDb()
    .prepare(
      `SELECT d.name
       FROM race_entries re
       JOIN drivers d ON d.id = re.driver_id
       WHERE re.race_id = ?
         AND re.driver_id IN (${placeholders})
         AND COALESCE(re.entry_status, 'expected') = 'scratched'`
    )
    .all(raceId, ...ids) as Array<{ name: string }>;

  if (scratched.length > 0) {
    throw new Error(`${scratched.map((driver) => driver.name).join(", ")} is scratched and not bettable.`);
  }
}

function toPlayerAccount(row: Record<string, unknown>): PlayerAccount {
  return {
    id: Number(row.id),
    name: String(row.name),
    balance: Number(row.balance),
    created_at: toIsoString(row.created_at),
  };
}

function toPlayerBet(row: Record<string, unknown>): PlayerBet {
  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    account_name: String(row.account_name),
    race_id: Number(row.race_id),
    race_name: String(row.race_name),
    prop_type: row.prop_type as PropType,
    description: String(row.description),
    driver_id: row.driver_id == null ? null : Number(row.driver_id),
    driver_name: row.driver_name == null ? null : String(row.driver_name),
    driver_b_id: row.driver_b_id == null ? null : Number(row.driver_b_id),
    driver_b_name: row.driver_b_name == null ? null : String(row.driver_b_name),
    american_odds: String(row.american_odds),
    stake: Number(row.stake),
    payout_if_win: Number(row.payout_if_win),
    status: row.status as PlayerBet["status"],
    created_at: toIsoString(row.created_at),
  };
}

export async function getOrCreateAccount(name: string): Promise<PlayerAccount> {
  const trimmed = name.trim();
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) throw new Error("Live betting database is not configured.");
    const [account] = (await sql`
      INSERT INTO player_accounts (name, name_key)
      VALUES (${trimmed}, ${trimmed.toLowerCase()})
      ON CONFLICT (name_key) DO UPDATE SET name = player_accounts.name
      RETURNING id, name, balance, created_at
    `) as Array<Record<string, unknown>>;
    return toPlayerAccount(account);
  }

  const db = getDb();
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

export async function getAccountByName(name: string): Promise<PlayerAccount | null> {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) return null;
    const [account] = (await sql`
      SELECT id, name, balance, created_at
      FROM player_accounts
      WHERE name_key = ${name.trim().toLowerCase()}
      LIMIT 1
    `) as Array<Record<string, unknown>>;
    return account ? toPlayerAccount(account) : null;
  }

  return (
    (getDb()
      .prepare("SELECT * FROM player_accounts WHERE name = ? COLLATE NOCASE")
      .get(name.trim()) as PlayerAccount) ?? null
  );
}

export async function getAccount(id: number): Promise<PlayerAccount | null> {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) return null;
    const [account] = (await sql`
      SELECT id, name, balance, created_at
      FROM player_accounts
      WHERE id = ${id}
      LIMIT 1
    `) as Array<Record<string, unknown>>;
    return account ? toPlayerAccount(account) : null;
  }

  return (
    (getDb()
      .prepare("SELECT * FROM player_accounts WHERE id = ?")
      .get(id) as PlayerAccount) ?? null
  );
}

export async function listAccounts(): Promise<PlayerAccount[]> {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) return [];
    const accounts = (await sql`
      SELECT id, name, balance, created_at
      FROM player_accounts
      ORDER BY name
    `) as Array<Record<string, unknown>>;
    return accounts.map(toPlayerAccount);
  }

  return getDb()
    .prepare("SELECT * FROM player_accounts ORDER BY name")
    .all() as PlayerAccount[];
}

export async function addFunds(accountId: number, amount: number): Promise<void> {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) throw new Error("Live betting database is not configured.");
    await sql`
      UPDATE player_accounts
      SET balance = balance + ${amount}
      WHERE id = ${accountId}
    `;
    return;
  }

  getDb()
    .prepare("UPDATE player_accounts SET balance = balance + ? WHERE id = ?")
    .run(amount, accountId);
}

export async function placePlayerBet(data: {
  account_id: number;
  race_id: number;
  prop_type: PropType;
  description: string;
  driver_id: number | null;
  driver_b_id: number | null;
  american_odds: string;
  stake: number;
}): Promise<void> {
  const db = getDb();
  const race = db
    .prepare(
      `SELECT r.race_date, r.division, r.series_mode, r.status, r.is_live, r.betting_status, r.name AS race_name,
              d1.name AS driver_name, d2.name AS driver_b_name
       FROM races r
       LEFT JOIN drivers d1 ON d1.id = ?
       LEFT JOIN drivers d2 ON d2.id = ?
       WHERE r.id = ?`
    )
    .get(data.driver_id, data.driver_b_id, data.race_id) as
      | {
          race_date: string;
          division: string | null;
          series_mode: string | null;
          status: string;
          is_live: number;
          betting_status: string | null;
          race_name: string;
          driver_name: string | null;
          driver_b_name: string | null;
        }
      | undefined;
  if (!race) throw new Error("Race not found.");
  if (!isRaceBettingOpen(race)) {
    throw new Error("Betting is closed for this race.");
  }
  assertDriversBettable(data.race_id, [data.driver_id, data.driver_b_id]);

  await assessPlayerBetUnderwriting(
    {
      race_id: data.race_id,
      prop_type: data.prop_type,
      description: data.description,
      driver_id: data.driver_id,
      driver_b_id: data.driver_b_id,
      american_odds: data.american_odds,
    },
    data.stake,
  );

  const payout_if_win = data.stake + data.stake * oddsToMultiplier(data.american_odds);

  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) throw new Error("Live betting database is not configured.");
    const placed = (await sql`
      WITH charged AS (
        UPDATE player_accounts
        SET balance = balance - ${data.stake}
        WHERE id = ${data.account_id} AND balance >= ${data.stake}
        RETURNING id
      )
      INSERT INTO player_bets
        (account_id, race_id, race_name, prop_type, description, driver_id, driver_name, driver_b_id, driver_b_name, american_odds, stake, payout_if_win)
      SELECT ${data.account_id}, ${data.race_id}, ${race.race_name}, ${data.prop_type}, ${data.description},
             ${data.driver_id}, ${race.driver_name}, ${data.driver_b_id}, ${race.driver_b_name},
             ${data.american_odds}, ${data.stake}, ${payout_if_win}
      FROM charged
      RETURNING id
    `) as Array<Record<string, unknown>>;
    if (placed.length > 0) return;

    const account = await getAccount(data.account_id);
    if (!account) throw new Error("Account not found.");
    throw new Error(`Insufficient balance. You have $${account.balance.toFixed(2)}.`);
  }

  const account = db
    .prepare("SELECT balance FROM player_accounts WHERE id = ?")
    .get(data.account_id) as { balance: number } | undefined;
  if (!account) throw new Error("Account not found.");
  if (account.balance < data.stake) {
    throw new Error(`Insufficient balance. You have $${account.balance.toFixed(2)}.`);
  }
  db.exec("BEGIN");
  try {
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
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export async function getAccountBets(accountId: number): Promise<PlayerBet[]> {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) return [];
    const bets = (await sql`
      SELECT pb.*, pa.name AS account_name
      FROM player_bets pb
      JOIN player_accounts pa ON pa.id = pb.account_id
      WHERE pb.account_id = ${accountId}
      ORDER BY pb.created_at DESC
    `) as Array<Record<string, unknown>>;
    return bets.map(toPlayerBet);
  }

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

export async function getPlayerRaceBets(accountId: number, raceId: number): Promise<PlayerBet[]> {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) return [];
    const bets = (await sql`
      SELECT pb.*, pa.name AS account_name
      FROM player_bets pb
      JOIN player_accounts pa ON pa.id = pb.account_id
      WHERE pb.account_id = ${accountId} AND pb.race_id = ${raceId}
      ORDER BY pb.created_at DESC
    `) as Array<Record<string, unknown>>;
    return bets.map(toPlayerBet);
  }

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

export async function settlePlayerBets(raceId: number, results: SettleResult[]): Promise<void> {
  const db = getDb();
  const bets = hasLiveBetDatabase()
    ? await (async () => {
        await ensureLiveBetTables();
        const sql = getLiveBetSql();
        if (!sql) return [];
        return (await sql`
          SELECT id, account_id, prop_type, driver_id, driver_b_id, stake, payout_if_win
          FROM player_bets
          WHERE race_id = ${raceId} AND status = 'open'
        `) as Array<Record<string, unknown>>;
      })()
    : (db
        .prepare("SELECT * FROM player_bets WHERE race_id = ? AND status = 'open'")
        .all(raceId) as Array<Record<string, unknown>>);

  const normalizedBets = bets.map((bet) => ({
    id: Number(bet.id),
    account_id: Number(bet.account_id),
    prop_type: bet.prop_type as PropType,
    driver_id: bet.driver_id == null ? null : Number(bet.driver_id),
    driver_b_id: bet.driver_b_id == null ? null : Number(bet.driver_b_id),
    stake: Number(bet.stake),
    payout_if_win: Number(bet.payout_if_win),
  })) as Array<{
    id: number;
    account_id: number;
    prop_type: PropType;
    driver_id: number | null;
    driver_b_id: number | null;
    stake: number;
    payout_if_win: number;
  }>;

  const posMap = new Map(results.map((r) => [r.driver_id, r]));

  for (const bet of normalizedBets) {
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

    if (hasLiveBetDatabase()) {
      const sql = getLiveBetSql();
      if (!sql) throw new Error("Live betting database is not configured.");
      if (shouldVoid) {
        await sql`UPDATE player_bets SET status = 'void' WHERE id = ${bet.id} AND status = 'open'`;
        await sql`
          UPDATE player_accounts
          SET balance = balance + ${bet.stake}
          WHERE id = ${bet.account_id}
        `;
      } else if (won) {
        await sql`UPDATE player_bets SET status = 'won' WHERE id = ${bet.id} AND status = 'open'`;
        await sql`
          UPDATE player_accounts
          SET balance = balance + ${bet.payout_if_win}
          WHERE id = ${bet.account_id}
        `;
      } else {
        await sql`UPDATE player_bets SET status = 'lost' WHERE id = ${bet.id} AND status = 'open'`;
      }
      continue;
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
  const activeDriverIds = getActiveDriverIds(raceId);
  const card = buildPredictionCard(raceId);
  if (!card) return [];
  const oddsReasoning = new Map(calculateRaceOdds(raceId, trackId).map((o) => [o.driverId, o.reasoning]));
  const cardRows = card.rows.filter((row) => activeDriverIds.has(row.driverId) && row.entryStatus !== "scratched");
  if (cardRows.length === 0) return [];
  const markets: PropMarket[] = [];

  const sumImplied = cardRows.reduce((s, o) => s + o.modelProbability, 0);
  const withTrue = cardRows.map((o) => ({
    driverId: o.driverId,
    driverName: o.driverName,
    americanOdds: o.fairOdds,
    impliedProbability: o.modelProbability,
    metricSeries: o.metricSeries,
    reasoning: oddsReasoning.get(o.driverId),
    trueProb: sumImplied > 0 ? o.modelProbability / sumImplied : 1 / cardRows.length,
  }));

  // Win market
  for (const o of withTrue) {
    markets.push({
      type: "win",
      section: "Race Winner",
      description: `${o.driverName} to Win`,
      metric_series: o.metricSeries,
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
      metric_series: o.metricSeries,
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
      metric_series: a.metricSeries,
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
      metric_series: b.metricSeries,
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
    const dnfRate = o.reasoning?.dnfRate ?? null;
    if (dnfRate !== null && dnfRate >= 0.15) {
      const pDnf = Math.min(0.45, Math.max(0.08, dnfRate));
      markets.push({
        type: "dnf",
        section: "DNF Props",
        description: `${o.driverName} Will Not Finish`,
        metric_series: o.metricSeries,
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
      metric_series: o.metricSeries,
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
