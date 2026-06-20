#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB = path.join(ROOT, "data", "dirtiq.db");
const MRP_SOURCE = path.join(ROOT, "src", "lib", "mrp-lineup.ts");

function usage() {
  console.error("Usage: node --experimental-strip-types scripts/sync_mrp_prelims.mjs [--race-id ID] [--limit N]");
  process.exit(1);
}

const args = process.argv.slice(2);
let raceId = null;
let limit = 4;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--race-id") {
    raceId = Number(args[++i]);
  } else if (arg === "--limit") {
    limit = Number(args[++i]);
  } else {
    usage();
  }
}

if ((raceId !== null && !Number.isFinite(raceId)) || !Number.isFinite(limit)) usage();

const parserModulePath = path.join(tmpdir(), `dirtiq-mrp-lineup-${Date.now()}.ts`);
const source = readFileSync(MRP_SOURCE, "utf8")
  .split("\n")
  .filter((line) => !line.includes('"server-only"') && !line.includes("'server-only'"))
  .join("\n");
writeFileSync(parserModulePath, source);
const { fetchMrpLineup, filterMrpLineupForRace } = await import(`file://${parserModulePath}`);

function normName(name) {
  return String(name ?? "").trim().toLowerCase();
}

function modelSlug(series) {
  return String(series ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveModel(race) {
  const key = `${race.name ?? ""} ${race.series_mode ?? ""} ${race.division ?? ""}`.toLowerCase();
  if (/(dream|world 100|north\/south|north south|topless|firecracker|pdc|gopher|hawkeye|dirt track world championship|dtwc|crown|combined)/.test(key)) {
    return "crown";
  }
  if (/summer nationals|hell tour|helltour|dirtcar/.test(key)) return "summer";
  if (/lucas/.test(key)) return "lucas";
  if (/woo|world of outlaws/.test(key)) return "woo";
  return "auto";
}

function scoreRace(id, model) {
  const args = ["scripts/predict_model.py", String(id), "--cache"];
  if (model !== "auto") args.push("--model", model);
  const raw = execFileSync("python3", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(raw);
}

function raceRows(db) {
  if (raceId !== null) {
    return db
      .prepare(
        `SELECT r.id, r.name, r.race_date, r.division, r.series_mode, r.mrp_event_id
         FROM races r
         WHERE r.id = ? AND r.mrp_event_id IS NOT NULL`
      )
      .all(raceId);
  }
  return db
    .prepare(
      `SELECT r.id, r.name, r.race_date, r.division, r.series_mode, r.mrp_event_id
       FROM races r
       WHERE r.status = 'upcoming'
         AND r.mrp_event_id IS NOT NULL
         AND (
           lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '')) LIKE '%late model%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '')) LIKE '%lucas%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '')) LIKE '%woo%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '')) LIKE '%crown%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '')) LIKE '%dirtcar%'
         )
         AND lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '')) NOT LIKE '%sprint%'
       ORDER BY r.race_date ASC, r.id ASC
       LIMIT ?`
    )
    .all(limit);
}

const db = new DatabaseSync(DB);
db.exec("PRAGMA busy_timeout = 10000");
const races = raceRows(db);
if (races.length === 0) {
  console.log("No MRP-linked races found.");
  process.exit(0);
}

const predictionDir = path.join(ROOT, "data", "ml-predictions");
if (!existsSync(predictionDir)) mkdirSync(predictionDir, { recursive: true });

const results = [];

for (const race of races) {
  const rawLineup = await fetchMrpLineup(race.mrp_event_id);
  const lineup = filterMrpLineupForRace(rawLineup, race);
  let updated = 0;
  let added = 0;
  let scratched = 0;
  const sessionCounts = lineup.sessions.map((session) => ({
    name: session.name,
    type: session.type,
    count: session.entries.length,
  }));
  const targetNames = new Set(lineup.entries.map((entry) => normName(entry.driver_name)));
  const excludedEntries = rawLineup.entries.filter((entry) => !targetNames.has(normName(entry.driver_name)));

  for (const entry of lineup.entries) {
    const driver = db
      .prepare("SELECT id FROM drivers WHERE lower(name) = ? LIMIT 1")
      .get(normName(entry.driver_name));

    if (!driver) continue;

    const exists = db
      .prepare("SELECT id FROM race_entries WHERE race_id = ? AND driver_id = ?")
      .get(race.id, driver.id);

    if (!exists) {
      db.prepare(
        "INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, entry_status, entry_status_updated_at) VALUES (?, ?, ?, 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
      ).run(race.id, driver.id, entry.car_number ?? null);
      added++;
    }

    db.prepare(
      `UPDATE race_entries
       SET entry_status = 'confirmed',
           entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           car_number = COALESCE(car_number, ?),
           qualifying_time = COALESCE(?, qualifying_time),
           heat_position = COALESCE(?, heat_position),
           bmain_position = COALESCE(?, bmain_position),
           starting_position = COALESCE(?, starting_position)
       WHERE race_id = ? AND driver_id = ?`
    ).run(
      entry.car_number ?? null,
      entry.qualifying_time,
      entry.heat_position,
      entry.bmain_position,
      entry.starting_position,
      race.id,
      driver.id
    );
    if (exists) updated++;
  }

  for (const entry of excludedEntries) {
    const driver = db
      .prepare("SELECT id FROM drivers WHERE lower(name) = ? LIMIT 1")
      .get(normName(entry.driver_name));

    if (!driver) continue;

    const exists = db
      .prepare("SELECT id, entry_status FROM race_entries WHERE race_id = ? AND driver_id = ?")
      .get(race.id, driver.id);

    if (!exists || exists.entry_status === "scratched") continue;

    db.prepare(
      `UPDATE race_entries
       SET entry_status = 'scratched',
           entry_status_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           qualifying_time = NULL,
           heat_position = NULL,
           starting_position = NULL
       WHERE race_id = ? AND driver_id = ?`
    ).run(race.id, driver.id);
    scratched++;
  }

  const model = resolveModel(race);
  let modelScored = 0;
  let modelSeries = null;
  let modelCache = null;
  let modelError = null;
  try {
    const scored = scoreRace(race.id, model);
    modelScored = scored.predictions?.length ?? 0;
    modelSeries = scored.modelSeries ?? null;
    const slug = model === "auto" ? null : modelSlug(modelSeries);
    modelCache = slug
      ? path.join("data", "ml-predictions", `race_${race.id}_${slug}.json`)
      : path.join("data", "ml-predictions", `race_${race.id}.json`);
  } catch (error) {
    modelError = error instanceof Error ? error.message : String(error);
  }

  results.push({
    raceId: race.id,
    raceName: race.name,
    mrpEventId: race.mrp_event_id,
    eventName: lineup.event_name,
    sessions: sessionCounts,
    updated,
    added,
    scratched,
    model,
    modelSeries,
    modelScored,
    modelCache,
    modelError,
    warnings: lineup.warnings,
  });
}

console.log(JSON.stringify(results, null, 2));
