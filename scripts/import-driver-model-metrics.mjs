/**
 * Imports aggregate WoO Late Model modeling metrics from a pasted markdown file.
 *
 * Usage:
 *   node scripts/import-driver-model-metrics.mjs /path/to/pasted-text.txt [series]
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "dirtiq.db");
const SOURCE_PATH = process.argv[2];
const SERIES = process.argv[3] ?? "WoO Late Models";

if (!SOURCE_PATH) {
  console.error("Usage: node scripts/import-driver-model-metrics.mjs /path/to/pasted-text.txt");
  process.exit(1);
}

function parseCSVLine(line) {
  const fields = [];
  let cur = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (ch === "," && !inQuote) {
      fields.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }

  fields.push(cur.trim());
  return fields;
}

function normName(name) {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addMetric(metrics, driver, key, value) {
  const n = toNumber(value);
  if (!driver || n === null) return;
  if (!metrics.has(driver)) metrics.set(driver, {});
  metrics.get(driver)[key] = (metrics.get(driver)[key] ?? 0) + n;
}

function setMetric(metrics, driver, key, value) {
  const n = toNumber(value);
  if (!driver || n === null) return;
  if (!metrics.has(driver)) metrics.set(driver, {});
  metrics.get(driver)[key] = n;
}

function parseSections(text) {
  const sections = new Map();
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }

  return sections;
}

function parseTable(lines) {
  if (!lines?.length) return [];
  const header = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

const text = readFileSync(SOURCE_PATH, "utf-8");
const sections = parseSections(text);
const metrics = new Map();
const trackSizeWins = [];

for (const row of parseTable(sections.get("Whos_Hot_Last_5"))) {
  setMetric(metrics, row.Driver, "last5_avg_finish", row.Avg_Finish);
}

for (const row of parseTable(sections.get("Feature_Wins"))) {
  addMetric(metrics, row.Driver, "feature_wins", row.Wins);
  setMetric(metrics, row.Driver, "laps_led_per_win", row.Laps_Led_Per_Win);
}

for (const row of parseTable(sections.get("Top_Fives"))) {
  addMetric(metrics, row.Driver, "top5s", row.Top_5s);
}

for (const row of parseTable(sections.get("Top_Tens"))) {
  addMetric(metrics, row.Driver, "top10s", row.Top_10s);
}

for (const row of parseTable(sections.get("Laps_Led"))) {
  addMetric(metrics, row.Driver, "laps_led", row.Laps_Led);
}

for (const row of parseTable(sections.get("Hard_Chargers"))) {
  addMetric(metrics, row.Driver, "hard_charger_count", row.Hard_Charger_Count);
}

for (const row of parseTable(sections.get("Heat_Race_Wins"))) {
  addMetric(metrics, row.Driver, "heat_wins", row.Heat_Wins);
}

for (const row of parseTable(sections.get("Average_Finish"))) {
  setMetric(metrics, row.Driver, "avg_finish", row.Avg_Finish);
  setMetric(metrics, row.Driver, "avg_start", row.Avg_Start);
}

for (const row of parseTable(sections.get("Avg_Qual_Position"))) {
  setMetric(metrics, row.Driver, "avg_qual_position", row.Avg_Qual_Pos);
  setMetric(metrics, row.Driver, "quick_times", row.Quick_Times);
  setMetric(metrics, row.Driver, "qual_attempts", row.Attempts);
}

for (const row of parseTable(sections.get("Wins_By_Track_Size"))) {
  const wins = toNumber(row.Wins);
  if (!row.Driver || !row.Track_Size || wins === null) continue;
  trackSizeWins.push({ driver: row.Driver, trackSize: row.Track_Size, wins });
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS driver_model_metrics (
    driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    series TEXT NOT NULL DEFAULT 'WoO Late Models',
    last5_avg_finish REAL,
    avg_finish REAL,
    avg_start REAL,
    avg_qual_position REAL,
    quick_times INTEGER NOT NULL DEFAULT 0,
    qual_attempts INTEGER NOT NULL DEFAULT 0,
    feature_wins INTEGER NOT NULL DEFAULT 0,
    laps_led_per_win REAL,
    top5s INTEGER NOT NULL DEFAULT 0,
    top10s INTEGER NOT NULL DEFAULT 0,
    laps_led INTEGER NOT NULL DEFAULT 0,
    hard_charger_count INTEGER NOT NULL DEFAULT 0,
    heat_wins INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (driver_id, series)
  );
  CREATE TABLE IF NOT EXISTS driver_track_size_wins (
    driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    series TEXT NOT NULL DEFAULT 'WoO Late Models',
    track_size TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (driver_id, series, track_size)
  );
`);

const existingDrivers = db.prepare("SELECT id, name FROM drivers").all();
const driverCache = new Map(existingDrivers.map((d) => [normName(d.name), d.id]));
const insertDriver = db.prepare("INSERT INTO drivers (name, division) VALUES (?, ?)");

function getOrCreateDriver(name) {
  const norm = normName(name);
  if (driverCache.has(norm)) return driverCache.get(norm);

  const lastName = norm.split(" ").pop() ?? "";
  const firstLetter = norm[0] ?? "";
  for (const [cachedName, id] of driverCache) {
    if (cachedName.split(" ").pop() === lastName && cachedName[0] === firstLetter) {
      driverCache.set(norm, id);
      return id;
    }
  }

  const id = insertDriver.run(name, SERIES).lastInsertRowid;
  driverCache.set(norm, id);
  return id;
}

const upsertMetric = db.prepare(`
  INSERT INTO driver_model_metrics
    (driver_id, series, last5_avg_finish, avg_finish, avg_start, avg_qual_position,
     quick_times, qual_attempts, feature_wins, laps_led_per_win, top5s, top10s, laps_led,
     hard_charger_count, heat_wins, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(driver_id, series) DO UPDATE SET
    series = excluded.series,
    last5_avg_finish = excluded.last5_avg_finish,
    avg_finish = excluded.avg_finish,
    avg_start = excluded.avg_start,
    avg_qual_position = excluded.avg_qual_position,
    quick_times = excluded.quick_times,
    qual_attempts = excluded.qual_attempts,
    feature_wins = excluded.feature_wins,
    laps_led_per_win = excluded.laps_led_per_win,
    top5s = excluded.top5s,
    top10s = excluded.top10s,
    laps_led = excluded.laps_led,
    hard_charger_count = excluded.hard_charger_count,
    heat_wins = excluded.heat_wins,
    updated_at = excluded.updated_at
`);

const clearTrackSizeWins = db.prepare("DELETE FROM driver_track_size_wins WHERE series = ?");
const upsertTrackSizeWin = db.prepare(`
  INSERT INTO driver_track_size_wins (driver_id, series, track_size, wins, updated_at)
  VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(driver_id, series, track_size) DO UPDATE SET
    wins = driver_track_size_wins.wins + excluded.wins,
    updated_at = excluded.updated_at
`);

db.exec("BEGIN");
try {
  clearTrackSizeWins.run(SERIES);

  for (const [driver, m] of metrics) {
    const driverId = getOrCreateDriver(driver);
    upsertMetric.run(
      driverId,
      SERIES,
      m.last5_avg_finish ?? null,
      m.avg_finish ?? null,
      m.avg_start ?? null,
      m.avg_qual_position ?? null,
      Math.round(m.quick_times ?? 0),
      Math.round(m.qual_attempts ?? 0),
      Math.round(m.feature_wins ?? 0),
      m.laps_led_per_win ?? null,
      Math.round(m.top5s ?? 0),
      Math.round(m.top10s ?? 0),
      Math.round(m.laps_led ?? 0),
      Math.round(m.hard_charger_count ?? 0),
      Math.round(m.heat_wins ?? 0),
    );
  }

  for (const row of trackSizeWins) {
    const driverId = getOrCreateDriver(row.driver);
    upsertTrackSizeWin.run(driverId, SERIES, row.trackSize, row.wins);
  }

  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

console.log(`Imported aggregate metrics for ${metrics.size} drivers.`);
console.log(`Imported ${trackSizeWins.length} track-size win rows.`);
