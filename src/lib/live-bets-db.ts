import "server-only";
import { neon } from "@neondatabase/serverless";

type LiveBetSql = ReturnType<typeof neon>;

let sqlClient: LiveBetSql | null = null;
let schemaReady: Promise<void> | null = null;

export function hasLiveBetDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function getLiveBetSql() {
  if (!process.env.DATABASE_URL) return null;
  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

export async function ensureLiveBetTables() {
  const sql = getLiveBetSql();
  if (!sql) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS player_accounts (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL UNIQUE,
          balance DOUBLE PRECISION NOT NULL DEFAULT 1000,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS player_bets (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
          race_id INTEGER NOT NULL,
          race_name TEXT NOT NULL,
          prop_type TEXT NOT NULL DEFAULT 'win',
          description TEXT NOT NULL,
          driver_id INTEGER,
          driver_name TEXT,
          driver_b_id INTEGER,
          driver_b_name TEXT,
          american_odds TEXT NOT NULL,
          stake DOUBLE PRECISION NOT NULL,
          payout_if_win DOUBLE PRECISION NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','void')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS featured_board_bets (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
          race_key TEXT NOT NULL,
          race_name TEXT NOT NULL,
          series TEXT NOT NULL,
          track TEXT NOT NULL,
          market TEXT NOT NULL,
          selection TEXT NOT NULL,
          description TEXT NOT NULL,
          american_odds TEXT NOT NULL,
          stake DOUBLE PRECISION NOT NULL,
          payout_if_win DOUBLE PRECISION NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','void')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_player_bets_account ON player_bets(account_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_player_bets_race ON player_bets(race_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_featured_board_bets_account ON featured_board_bets(account_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_featured_board_bets_race ON featured_board_bets(race_key)`;
    })();
  }
  await schemaReady;
}

export function toIsoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
