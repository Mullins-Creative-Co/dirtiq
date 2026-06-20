import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getStorageStatus } from "@/lib/storage-status";

export const runtime = "nodejs";

const exportTables = [
  "drivers",
  "tracks",
  "track_similars",
  "races",
  "race_entries",
  "driver_season_stats",
  "driver_model_metrics",
  "driver_track_size_wins",
  "driver_equipment_profiles",
  "driver_specialties",
  "race_predictions",
  "market_lines",
  "line_caveats",
  "track_driver_trends",
  "underwriting_notes",
  "race_context_adjustments",
  "driver_series_commitments",
  "model_race_reviews",
  "race_risk_limits",
] as const;

function listColumns(table: string) {
  return getDb()
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
}

function tableRows(table: string) {
  return getDb().prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
}

export async function GET() {
  const generatedAt = new Date().toISOString();
  const tables: Record<string, { columns: string[]; rows: Array<Record<string, unknown>> }> = {};

  for (const table of exportTables) {
    try {
      tables[table] = {
        columns: listColumns(table).map((column) => column.name),
        rows: tableRows(table),
      };
    } catch {
      tables[table] = { columns: [], rows: [] };
    }
  }

  const payload = {
    app: "DirtIQ",
    kind: "race-admin-snapshot",
    version: 1,
    generatedAt,
    storage: getStorageStatus(),
    tables,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="dirtiq-race-admin-snapshot-${generatedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
