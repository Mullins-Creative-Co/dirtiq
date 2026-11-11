import "server-only";

import { getDb } from "./db";
import { ensureLiveBetTables, getLiveBetSql, hasLiveBetDatabase, toIsoString } from "./live-bets-db";
import { getAllResultsIndex, getLedgerIndex } from "./model-reports";
import { BET_MARKETS, BET_STATUSES, gradeGameBet, gradeRaceBet, type BetMarket, type BetStatus, type MyBet } from "./my-bets/grade";

export type { MyBet, BetMarket, BetStatus } from "./my-bets/grade";

export type NewBet = Omit<MyBet, "id" | "status" | "resultValue" | "settledAt" | "manual">;

let pgReady: Promise<void> | null = null;

async function ensurePg() {
  await ensureLiveBetTables();
  const sql = getLiveBetSql();
  if (!sql) throw new Error("Live betting database is not configured.");
  if (!pgReady) {
    pgReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS my_bets (
          id BIGSERIAL PRIMARY KEY,
          sport TEXT NOT NULL,
          event_id TEXT,
          event_label TEXT NOT NULL,
          event_start TIMESTAMPTZ,
          market TEXT NOT NULL,
          selection TEXT NOT NULL,
          selection_label TEXT NOT NULL,
          line DOUBLE PRECISION,
          price INTEGER NOT NULL,
          stake DOUBLE PRECISION NOT NULL,
          book TEXT,
          note TEXT,
          model_prob DOUBLE PRECISION,
          market_prob DOUBLE PRECISION,
          placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','push','void')),
          result_value DOUBLE PRECISION,
          settled_at TIMESTAMPTZ,
          manual BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_my_bets_status ON my_bets(status)`;
    })();
  }
  await pgReady;
  return sql;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBet(row: Record<string, unknown>): MyBet {
  const market = String(row.market) as BetMarket;
  const status = String(row.status) as BetStatus;
  return {
    id: Number(row.id), sport: String(row.sport), eventId: row.event_id ? String(row.event_id) : null,
    eventLabel: String(row.event_label), eventStart: row.event_start ? toIsoString(row.event_start) : null,
    market: BET_MARKETS.includes(market) ? market : "other", selection: String(row.selection), selectionLabel: String(row.selection_label),
    line: num(row.line), price: Number(row.price), stake: Number(row.stake), book: row.book ? String(row.book) : null,
    note: row.note ? String(row.note) : null, modelProb: num(row.model_prob), marketProb: num(row.market_prob),
    placedAt: toIsoString(row.placed_at), status: BET_STATUSES.includes(status) ? status : "open",
    resultValue: num(row.result_value), settledAt: row.settled_at ? toIsoString(row.settled_at) : null,
    manual: Boolean(row.manual),
  };
}

export function myBetsStorage(): "postgres" | "sqlite" {
  return hasLiveBetDatabase() ? "postgres" : "sqlite";
}

export async function listBets(): Promise<MyBet[]> {
  if (hasLiveBetDatabase()) {
    const sql = await ensurePg();
    const rows = (await sql`SELECT * FROM my_bets ORDER BY placed_at DESC, id DESC`) as Array<Record<string, unknown>>;
    return rows.map(toBet);
  }
  const rows = getDb().prepare("SELECT * FROM my_bets ORDER BY placed_at DESC, id DESC").all() as Array<Record<string, unknown>>;
  return rows.map(toBet);
}

export async function addBet(bet: NewBet): Promise<MyBet> {
  if (hasLiveBetDatabase()) {
    const sql = await ensurePg();
    const [row] = (await sql`
      INSERT INTO my_bets (sport, event_id, event_label, event_start, market, selection, selection_label, line, price, stake, book, note, model_prob, market_prob, placed_at)
      VALUES (${bet.sport}, ${bet.eventId}, ${bet.eventLabel}, ${bet.eventStart}, ${bet.market}, ${bet.selection}, ${bet.selectionLabel}, ${bet.line}, ${bet.price}, ${bet.stake}, ${bet.book}, ${bet.note}, ${bet.modelProb}, ${bet.marketProb}, ${bet.placedAt})
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return toBet(row);
  }
  const db = getDb();
  const res = db.prepare(`INSERT INTO my_bets (sport, event_id, event_label, event_start, market, selection, selection_label, line, price, stake, book, note, model_prob, market_prob, placed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    bet.sport, bet.eventId, bet.eventLabel, bet.eventStart, bet.market, bet.selection, bet.selectionLabel, bet.line, bet.price, bet.stake, bet.book, bet.note, bet.modelProb, bet.marketProb, bet.placedAt);
  return toBet(db.prepare("SELECT * FROM my_bets WHERE id = ?").get(res.lastInsertRowid) as Record<string, unknown>);
}

export async function deleteBet(id: number): Promise<void> {
  if (hasLiveBetDatabase()) {
    const sql = await ensurePg();
    await sql`DELETE FROM my_bets WHERE id = ${id}`;
    return;
  }
  getDb().prepare("DELETE FROM my_bets WHERE id = ?").run(id);
}

export async function setBetStatus(id: number, status: BetStatus, manual = true): Promise<void> {
  const settledAt = status === "open" ? null : new Date().toISOString();
  if (hasLiveBetDatabase()) {
    const sql = await ensurePg();
    await sql`UPDATE my_bets SET status = ${status}, settled_at = ${settledAt}, manual = ${manual} WHERE id = ${id}`;
    return;
  }
  getDb().prepare("UPDATE my_bets SET status = ?, settled_at = ?, manual = ? WHERE id = ?").run(status, settledAt, manual ? 1 : 0, id);
}

async function recordGrade(id: number, status: BetStatus, resultValue: number | null): Promise<void> {
  const settledAt = new Date().toISOString();
  if (hasLiveBetDatabase()) {
    const sql = await ensurePg();
    await sql`UPDATE my_bets SET status = ${status}, result_value = ${resultValue}, settled_at = ${settledAt} WHERE id = ${id} AND status = 'open' AND manual = false`;
    return;
  }
  getDb().prepare("UPDATE my_bets SET status = ?, result_value = ?, settled_at = ? WHERE id = ? AND status = 'open' AND manual = 0").run(status, resultValue, settledAt, id);
}

/** Grade every open, non-manual bet from the published results and the settled ledger. Returns the number graded. */
export async function settleOpenBets(bets?: MyBet[]): Promise<number> {
  const list = bets ?? await listBets();
  const open = list.filter((b) => b.status === "open" && !b.manual && b.eventId);
  if (!open.length) return 0;
  const results = getAllResultsIndex();
  const ledger = getLedgerIndex();
  let graded = 0;
  for (const bet of open) {
    const eventId = bet.eventId as string;
    if (eventId.startsWith("race:")) {
      const rows = ledger.get(eventId)?.rows ?? [];
      const g = gradeRaceBet(bet, rows);
      if (g) { await recordGrade(bet.id, g.status, null); graded += 1; }
      continue;
    }
    const result = results.get(eventId);
    if (!result) continue;
    const g = gradeGameBet(bet, result);
    if (g) { await recordGrade(bet.id, g.status, g.resultValue); graded += 1; }
  }
  return graded;
}
