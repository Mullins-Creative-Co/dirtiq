#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB = path.join(ROOT, "data", "dirtiq.db");
const MRP_SOURCE = path.join(ROOT, "src", "lib", "mrp-lineup.ts");

function usage() {
  console.error("Usage: node --experimental-strip-types scripts/sync_mrp_results.mjs --race-id ID");
  process.exit(1);
}

const args = process.argv.slice(2);
let raceId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--race-id") {
    raceId = Number(args[++i]);
  } else {
    usage();
  }
}
if (!Number.isFinite(raceId)) usage();

const parserModulePath = path.join(tmpdir(), `dirtiq-mrp-results-${Date.now()}.ts`);
const source = readFileSync(MRP_SOURCE, "utf8")
  .split("\n")
  .filter((line) => !line.includes('"server-only"') && !line.includes("'server-only'"))
  .join("\n");
writeFileSync(parserModulePath, source);
const { fetchMrpLineup, filterMrpLineupForRace } = await import(`file://${parserModulePath}`);

function normName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLateModelSession(name) {
  const normalized = String(name ?? "").toLowerCase();
  if (
    normalized.includes("sportmod") ||
    normalized.includes("modified") ||
    normalized.includes("stock") ||
    normalized.includes("front wheel") ||
    normalized.includes("crown vic") ||
    normalized.includes("sprint")
  ) {
    return false;
  }
  return (
    normalized.includes("late model") ||
    normalized.includes("super late") ||
    normalized.includes("lolmds") ||
    normalized.includes("outlaws") ||
    normalized.includes("feature")
  );
}

function pickFinalSession(sessions) {
  return sessions
    .filter((session) => session.type === "feature" && session.entries.length > 0 && isLateModelSession(session.name))
    .sort((a, b) => b.entries.length - a.entries.length)[0] ?? null;
}

function matchEntry(entries, usedDriverIds, result) {
  const normalizedResultName = normName(result.driver_name);
  const resultLast = normalizedResultName.split(" ").pop();
  const car = result.car_number?.trim().toLowerCase() ?? null;
  return entries.find((entry) => {
    if (usedDriverIds.has(entry.driver_id)) return false;
    if (normName(entry.driver_name) === normalizedResultName) return true;
    if (car && entry.car_number?.trim().toLowerCase() === car) return true;
    const entryLast = normName(entry.driver_name).split(" ").pop();
    return !!resultLast && resultLast.length >= 3 && resultLast === entryLast;
  });
}

function settlePlayerBet(db, bet, posMap) {
  const dR = bet.driver_id == null ? null : posMap.get(bet.driver_id);
  const dBR = bet.driver_b_id == null ? null : posMap.get(bet.driver_b_id);
  let won = false;
  let shouldVoid = false;

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
      if (!dR || !dBR) {
        shouldVoid = true;
        break;
      }
      const posA = dR.dnf ? 9999 : dR.finishing_position ?? 9999;
      const posB = dBR.dnf ? 9999 : dBR.finishing_position ?? 9999;
      if (posA === posB) {
        shouldVoid = true;
        break;
      }
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
    db.prepare("UPDATE player_bets SET status = 'void' WHERE id = ? AND status = 'open'").run(bet.id);
    db.prepare("UPDATE player_accounts SET balance = balance + ? WHERE id = ?").run(bet.stake, bet.account_id);
  } else if (won) {
    db.prepare("UPDATE player_bets SET status = 'won' WHERE id = ? AND status = 'open'").run(bet.id);
    db.prepare("UPDATE player_accounts SET balance = balance + ? WHERE id = ?").run(bet.payout_if_win, bet.account_id);
  } else {
    db.prepare("UPDATE player_bets SET status = 'lost' WHERE id = ? AND status = 'open'").run(bet.id);
  }
}

const db = new DatabaseSync(DB);
db.exec("PRAGMA busy_timeout = 10000");

const race = db
  .prepare(
    `SELECT r.id, r.name, r.race_date, r.division, r.series_mode, r.mrp_event_id
     FROM races r
     WHERE r.id = ?`
  )
  .get(raceId);

if (!race) throw new Error(`Race ${raceId} not found.`);
if (!race.mrp_event_id) throw new Error(`Race ${raceId} has no MRP event id.`);

const rawLineup = await fetchMrpLineup(race.mrp_event_id);
const lineup = filterMrpLineupForRace(rawLineup, race);
const session = pickFinalSession(lineup.sessions);

if (!session) {
  console.log(JSON.stringify({
    raceId,
    raceName: race.name,
    mrpEventId: race.mrp_event_id,
    eventName: lineup.event_name,
    synced: 0,
    error: "No final late-model feature result session found on MRP.",
    sessions: lineup.sessions.map((item) => ({ name: item.name, type: item.type, count: item.entries.length })),
    warnings: lineup.warnings,
  }, null, 2));
  process.exit(2);
}

const entries = db
  .prepare(
    `SELECT re.id, re.driver_id, re.car_number, d.name AS driver_name
     FROM race_entries re
     JOIN drivers d ON d.id = re.driver_id
     WHERE re.race_id = ?`
  )
  .all(raceId);

const usedDriverIds = new Set();
const unmatched = [];
const settlementRows = [];
let winnerDriverId = null;
let winnerName = null;
let synced = 0;

db.exec("BEGIN");
try {
  db.prepare(
    `UPDATE races
     SET betting_status = 'locked',
         betting_locked_at = COALESCE(betting_locked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
         betting_lock_reason = ?
     WHERE id = ? AND betting_status != 'settled'`
  ).run(`results import: MRP ${race.mrp_event_id}`, raceId);

  for (const result of session.entries) {
    const match = matchEntry(entries, usedDriverIds, result);
    if (!match) {
      unmatched.push(result.driver_name);
      continue;
    }

    usedDriverIds.add(match.driver_id);
    db.prepare(
      `UPDATE race_entries
       SET finishing_position = ?,
           starting_position = COALESCE(?, starting_position),
           laps_led = 0,
           dnf = ?,
           dnf_reason = NULL
       WHERE race_id = ? AND driver_id = ?`
    ).run(result.position, result.starting_position ?? null, result.dnf ? 1 : 0, raceId, match.driver_id);

    settlementRows.push({
      driver_id: match.driver_id,
      finishing_position: result.position,
      laps_led: 0,
      dnf: !!result.dnf,
    });
    synced++;

    if (result.position === 1 && !result.dnf) {
      winnerDriverId = match.driver_id;
      winnerName = match.driver_name;
    }
  }

  if (synced === 0) {
    throw new Error("Results were fetched, but no local race entries matched.");
  }

  db.prepare(
    `UPDATE races
     SET status = 'complete',
         is_live = 0,
         betting_status = 'settled',
         betting_locked_at = COALESCE(betting_locked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
         betting_lock_reason = COALESCE(betting_lock_reason, 'results posted'),
         results_source = ?,
         results_imported_at = COALESCE(results_imported_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
         settled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(`MRP ${race.mrp_event_id}`, raceId);

  if (winnerDriverId !== null) {
    db.prepare("UPDATE bets SET status = 'won' WHERE race_id = ? AND driver_id = ? AND status = 'open'").run(raceId, winnerDriverId);
    db.prepare("UPDATE bets SET status = 'lost' WHERE race_id = ? AND driver_id != ? AND status = 'open'").run(raceId, winnerDriverId);
  }

  const posMap = new Map(settlementRows.map((row) => [row.driver_id, row]));
  const playerBets = db
    .prepare("SELECT * FROM player_bets WHERE race_id = ? AND status = 'open'")
    .all(raceId);
  for (const bet of playerBets) settlePlayerBet(db, bet, posMap);

  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(JSON.stringify({
  raceId,
  raceName: race.name,
  mrpEventId: race.mrp_event_id,
  eventName: lineup.event_name,
  session: { name: session.name, type: session.type, count: session.entries.length },
  synced,
  total: session.entries.length,
  winnerDriverId,
  winnerName,
  unmatched,
  warnings: lineup.warnings,
}, null, 2));
