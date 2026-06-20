import "server-only";

import { getDb } from "@/lib/db";

export type OddsFreshness = {
  status: "current" | "needs_publish";
  lineCount: number;
  fieldSize: number;
  lastPublishedAt: string | null;
  latestCaveatAt: string | null;
  latestEntryStatusAt: string | null;
  reason: string;
};

type FreshnessRow = {
  line_count: number;
  active_entry_count: number;
  last_published_at: string | null;
  latest_caveat_at: string | null;
  latest_entry_status_at: string | null;
};

export function getOddsFreshness(raceId: number, fieldSize: number): OddsFreshness {
  const row = getDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*)
          FROM market_lines ml
          JOIN race_entries re ON re.race_id = ml.race_id AND re.driver_id = ml.driver_id
          WHERE ml.race_id = ?
            AND COALESCE(re.entry_status, 'expected') != 'scratched') AS line_count,
         (SELECT COUNT(*) FROM race_entries WHERE race_id = ? AND COALESCE(entry_status, 'expected') != 'scratched') AS active_entry_count,
         (SELECT MAX(updated_at) FROM market_lines WHERE race_id = ?) AS last_published_at,
         (SELECT MAX(COALESCE(resolved_at, created_at)) FROM line_caveats WHERE race_id = ?) AS latest_caveat_at,
         (SELECT MAX(entry_status_updated_at) FROM race_entries WHERE race_id = ?) AS latest_entry_status_at`
    )
    .get(raceId, raceId, raceId, raceId, raceId) as FreshnessRow;
  const requiredLines = row.active_entry_count || fieldSize;

  if (row.line_count < requiredLines) {
    return {
      status: "needs_publish",
      lineCount: row.line_count,
      fieldSize: requiredLines,
      lastPublishedAt: row.last_published_at,
      latestCaveatAt: row.latest_caveat_at,
      latestEntryStatusAt: row.latest_entry_status_at,
      reason: "Missing published odds for part of the field.",
    };
  }

  if (
    row.latest_caveat_at &&
    (!row.last_published_at || row.latest_caveat_at > row.last_published_at)
  ) {
    return {
      status: "needs_publish",
      lineCount: row.line_count,
      fieldSize: requiredLines,
      lastPublishedAt: row.last_published_at,
      latestCaveatAt: row.latest_caveat_at,
      latestEntryStatusAt: row.latest_entry_status_at,
      reason: "A caveat changed after odds were published.",
    };
  }

  if (
    row.latest_entry_status_at &&
    (!row.last_published_at || row.latest_entry_status_at > row.last_published_at)
  ) {
    return {
      status: "needs_publish",
      lineCount: row.line_count,
      fieldSize: requiredLines,
      lastPublishedAt: row.last_published_at,
      latestCaveatAt: row.latest_caveat_at,
      latestEntryStatusAt: row.latest_entry_status_at,
      reason: "An entry status changed after odds were published.",
    };
  }

  return {
    status: "current",
    lineCount: row.line_count,
    fieldSize: requiredLines,
    lastPublishedAt: row.last_published_at,
    latestCaveatAt: row.latest_caveat_at,
    latestEntryStatusAt: row.latest_entry_status_at,
    reason: "Published odds match the current field and caveats.",
  };
}
