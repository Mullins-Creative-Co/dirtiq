import "server-only";
import { getDb } from "./db";
import {
  featuredPickId,
  featuredPicks,
  featuredRaces,
  type FeaturedMarket,
} from "./featured-board";
import { oddsToMultiplier } from "./book";
import { ensureLiveBetTables, getLiveBetSql, hasLiveBetDatabase, toIsoString } from "./live-bets-db";

export type FeaturedBoardBet = {
  id: number;
  account_id: number;
  account_name: string;
  race_key: string;
  race_name: string;
  series: string;
  track: string;
  market: FeaturedMarket;
  selection: string;
  description: string;
  american_odds: string;
  stake: number;
  payout_if_win: number;
  status: "open" | "won" | "lost" | "void";
  created_at: string;
};

function ensureFeaturedBoardBetsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS featured_board_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
      race_key TEXT NOT NULL,
      race_name TEXT NOT NULL,
      series TEXT NOT NULL,
      track TEXT NOT NULL,
      market TEXT NOT NULL,
      selection TEXT NOT NULL,
      description TEXT NOT NULL,
      american_odds TEXT NOT NULL,
      stake REAL NOT NULL,
      payout_if_win REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','void')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_featured_board_bets_account ON featured_board_bets(account_id);
    CREATE INDEX IF NOT EXISTS idx_featured_board_bets_race ON featured_board_bets(race_key);
  `);
}

function toFeaturedBoardBet(row: Record<string, unknown>): FeaturedBoardBet {
  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    account_name: String(row.account_name),
    race_key: String(row.race_key),
    race_name: String(row.race_name),
    series: String(row.series),
    track: String(row.track),
    market: row.market as FeaturedMarket,
    selection: String(row.selection),
    description: String(row.description),
    american_odds: String(row.american_odds),
    stake: Number(row.stake),
    payout_if_win: Number(row.payout_if_win),
    status: row.status as FeaturedBoardBet["status"],
    created_at: toIsoString(row.created_at),
  };
}

export async function placeFeaturedBoardBet(data: {
  accountId: number;
  pickId: string;
  stake: number;
}): Promise<void> {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
  } else {
    ensureFeaturedBoardBetsTable();
  }
  const stake = Math.round(data.stake * 100) / 100;
  if (!Number.isFinite(stake) || stake <= 0) {
    throw new Error("Stake must be greater than zero.");
  }

  const pick = featuredPicks.find((candidate) => featuredPickId(candidate) === data.pickId);
  if (!pick) throw new Error("That line is no longer available.");

  const race = featuredRaces.find((candidate) => candidate.id === pick.raceId);
  if (!race) throw new Error("Race not found.");
  if (race.status !== "OPEN") throw new Error("Betting is closed for this race.");

  const payoutIfWin = stake + stake * oddsToMultiplier(pick.line);
  const description = `${pick.market}: ${pick.selection}`;

  if (hasLiveBetDatabase()) {
    const sql = getLiveBetSql();
    if (!sql) throw new Error("Live betting database is not configured.");
    const placed = (await sql`
      WITH charged AS (
        UPDATE player_accounts
        SET balance = balance - ${stake}
        WHERE id = ${data.accountId} AND balance >= ${stake}
        RETURNING id
      )
      INSERT INTO featured_board_bets
        (account_id, race_key, race_name, series, track, market, selection, description, american_odds, stake, payout_if_win)
      SELECT ${data.accountId}, ${race.id}, ${race.raceName}, ${race.series}, ${race.track},
             ${pick.market}, ${pick.selection}, ${description}, ${pick.line}, ${stake}, ${payoutIfWin}
      FROM charged
      RETURNING id
    `) as Array<Record<string, unknown>>;
    if (placed.length > 0) return;

    const [account] = (await sql`
      SELECT balance
      FROM player_accounts
      WHERE id = ${data.accountId}
      LIMIT 1
    `) as Array<Record<string, unknown>>;
    if (!account) throw new Error("Account not found.");
    throw new Error(`Insufficient balance. You have $${Number(account.balance).toFixed(2)}.`);
  }

  const db = getDb();
  const account = db
    .prepare("SELECT balance FROM player_accounts WHERE id = ?")
    .get(data.accountId) as { balance: number } | undefined;
  if (!account) throw new Error("Account not found.");
  if (account.balance < stake) {
    throw new Error(`Insufficient balance. You have $${account.balance.toFixed(2)}.`);
  }

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE player_accounts SET balance = balance - ? WHERE id = ?").run(
      stake,
      data.accountId,
    );
    db.prepare(
      `INSERT INTO featured_board_bets
        (account_id, race_key, race_name, series, track, market, selection, description, american_odds, stake, payout_if_win)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.accountId,
      race.id,
      race.raceName,
      race.series,
      race.track,
      pick.market,
      pick.selection,
      description,
      pick.line,
      stake,
      payoutIfWin,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function getFeaturedBoardBets(accountId: number): Promise<FeaturedBoardBet[]> {
  if (hasLiveBetDatabase()) {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) return [];
    const bets = (await sql`
      SELECT fbb.*, pa.name AS account_name
      FROM featured_board_bets fbb
      JOIN player_accounts pa ON pa.id = fbb.account_id
      WHERE fbb.account_id = ${accountId}
      ORDER BY fbb.created_at DESC
    `) as Array<Record<string, unknown>>;
    return bets.map(toFeaturedBoardBet);
  }

  ensureFeaturedBoardBetsTable();
  return getDb()
    .prepare(
      `SELECT fbb.*, pa.name AS account_name
       FROM featured_board_bets fbb
       JOIN player_accounts pa ON pa.id = fbb.account_id
       WHERE fbb.account_id = ?
       ORDER BY fbb.created_at DESC`
    )
    .all(accountId) as FeaturedBoardBet[];
}
