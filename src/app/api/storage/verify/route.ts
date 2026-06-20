import { NextResponse } from "next/server";

import { ensureLiveBetTables, getLiveBetSql, hasLiveBetDatabase } from "@/lib/live-bets-db";
import { getStorageStatus } from "@/lib/storage-status";

export const runtime = "nodejs";

function countFrom(row: Record<string, unknown> | undefined) {
  if (!row) return 0;
  return Number(row.count ?? row.n ?? 0);
}

export async function GET() {
  const storage = getStorageStatus();

  if (!hasLiveBetDatabase()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      storage,
      message: "DATABASE_URL is not configured. Add Neon/Postgres to Vercel, then redeploy.",
    });
  }

  try {
    await ensureLiveBetTables();
    const sql = getLiveBetSql();
    if (!sql) throw new Error("DATABASE_URL is configured but no SQL client was created.");

    const accounts = (await sql`SELECT COUNT(*)::int AS count FROM player_accounts`) as Array<Record<string, unknown>>;
    const playerBets = (await sql`SELECT COUNT(*)::int AS count FROM player_bets`) as Array<Record<string, unknown>>;
    const featuredBets = (await sql`SELECT COUNT(*)::int AS count FROM featured_board_bets`) as Array<Record<string, unknown>>;

    return NextResponse.json({
      ok: true,
      configured: true,
      storage,
      message: "Neon is connected and public betting tables are ready.",
      tables: {
        player_accounts: countFrom(accounts[0]),
        player_bets: countFrom(playerBets[0]),
        featured_board_bets: countFrom(featuredBets[0]),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        storage,
        message: error instanceof Error ? error.message : "Failed to verify storage.",
      },
      { status: 500 }
    );
  }
}
