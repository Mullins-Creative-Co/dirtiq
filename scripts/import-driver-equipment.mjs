/**
 * Imports driver equipment profiles from CSV.
 *
 * Usage:
 *   node scripts/import-driver-equipment.mjs /path/to/equipment.csv
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "dirtiq.db");
const SOURCE_PATH = process.argv[2];

if (!SOURCE_PATH) {
  console.error("Usage: node scripts/import-driver-equipment.mjs /path/to/equipment.csv");
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

function parseCSV(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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

function normName(name) {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function family(value, rules, fallback = "Other") {
  const text = (value ?? "").toLowerCase();
  for (const [label, pattern] of rules) {
    if (pattern.test(text)) return label;
  }
  return value ? fallback : null;
}

function chassisFamily(chassis) {
  return family(chassis, [
    ["Longhorn", /longhorn/],
    ["Rocket", /rocket/],
    ["Middle Tennessee", /middle tennessee/],
  ]);
}

function engineFamily(engine) {
  return family(engine, [
    ["Clements", /clements/],
    ["Cornett", /cornett/],
    ["Durham", /durham/],
    ["Vic Hill", /vic hill/],
    ["Pro Power", /pro power/],
    ["Dickens", /dickens/],
  ]);
}

function shockFamily(shocks) {
  return family(shocks, [
    ["Ohlins", /[oö]hlins/i],
    ["Bilstein", /bilstein/],
    ["Penske", /penske/],
    ["Integra", /integra/],
  ]);
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS driver_equipment_profiles (
    driver_id INTEGER PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
    car_number TEXT,
    team TEXT,
    series TEXT,
    chassis TEXT,
    chassis_family TEXT,
    engine TEXT,
    engine_family TEXT,
    shocks TEXT,
    shock_family TEXT,
    tire_brand TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

const existingDrivers = db.prepare("SELECT id, name FROM drivers").all();
const driverCache = new Map(existingDrivers.map((d) => [normName(d.name), d.id]));
const insertDriver = db.prepare("INSERT INTO drivers (name, car_number, division, notes) VALUES (?, ?, ?, ?)");

function getOrCreateDriver(name, carNumber, series, notes) {
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

  const id = insertDriver.run(name, carNumber || null, series || "Open", notes || null).lastInsertRowid;
  driverCache.set(norm, id);
  return id;
}

const upsert = db.prepare(`
  INSERT INTO driver_equipment_profiles
    (driver_id, car_number, team, series, chassis, chassis_family, engine, engine_family,
     shocks, shock_family, tire_brand, notes, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(driver_id) DO UPDATE SET
    car_number = excluded.car_number,
    team = excluded.team,
    series = excluded.series,
    chassis = excluded.chassis,
    chassis_family = excluded.chassis_family,
    engine = excluded.engine,
    engine_family = excluded.engine_family,
    shocks = excluded.shocks,
    shock_family = excluded.shock_family,
    tire_brand = excluded.tire_brand,
    notes = excluded.notes,
    updated_at = excluded.updated_at
`);

const rows = parseCSV(readFileSync(SOURCE_PATH, "utf-8"));
let imported = 0;

db.exec("BEGIN");
try {
  for (const row of rows) {
    if (!row.Driver) continue;
    const driverId = getOrCreateDriver(row.Driver, row["Car Number"], row.Series, row.Notes);
    upsert.run(
      driverId,
      row["Car Number"] || null,
      row.Team || null,
      row.Series || null,
      row.Chassis || null,
      chassisFamily(row.Chassis),
      row.Engine || null,
      engineFamily(row.Engine),
      row.Shocks || null,
      shockFamily(row.Shocks),
      row.Tires || null,
      row.Notes || null,
    );
    imported++;
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

console.log(`Imported equipment profiles for ${imported} rows.`);
