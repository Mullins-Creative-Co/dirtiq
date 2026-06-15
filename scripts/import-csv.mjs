/**
 * import-csv.mjs
 * Loads historical WoO Late Models feature results from the combined CSV into dirtiq.db.
 * Enriches each feature entry with qualifying time and heat position from the same event.
 * Safe to re-run: skips races already in DB by mrp_event_id + session name.
 *
 * Usage:  node scripts/import-csv.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH  = join(__dirname, "..", "data", "dirtiq.db");
const CSV_PATH = join(__dirname, "..", "woo_latemodels_2021_2026_combined.csv");

// ── CSV parser ─────────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const fields = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === "," && !inQuote) { fields.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  fields.push(cur.trim());
  return fields;
}

// ── Date parser ────────────────────────────────────────────────────────────────
// Handles both "SATURDAY OCT 2 2021" and "2026-01-21"
const MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // e.g. "SATURDAY OCT 2 2021"
  const parts = s.trim().split(/\s+/);
  // find year (4 digits), month (3-letter abbrev), day (1-2 digits)
  let year, month, day;
  for (const p of parts) {
    if (/^\d{4}$/.test(p)) year = parseInt(p, 10);
    else if (MONTHS[p.toUpperCase()]) month = MONTHS[p.toUpperCase()];
    else if (/^\d{1,2}$/.test(p)) day = parseInt(p, 10);
  }
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

// ── Name normalizer ────────────────────────────────────────────────────────────
function normName(n) {
  return n.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// ── Track name aliases (CSV short name → DB full name) ─────────────────────────
// Add entries here when a CSV track name differs from the canonical DB name.
const TRACK_ALIASES = {
  "fairbury speedway": "Fairbury American Legion Speedway",
};

// ── Main ───────────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");

// ── Load CSV ───────────────────────────────────────────────────────────────────
const lines = readFileSync(CSV_PATH, "utf-8").split("\n").filter(Boolean);
const header = parseCSVLine(lines[0]);

// Build column index map
const C = {};
header.forEach((h, i) => { C[h.trim()] = i; });

const allRows = lines.slice(1).map(l => parseCSVLine(l));

// Separate by session category
const featureRows  = allRows.filter(r => r[C.session_category] === "feature");
const heatRows     = allRows.filter(r => r[C.session_category] === "heat");
const qualRows     = allRows.filter(r => r[C.session_category] === "qualifying");

console.log(`Rows: ${allRows.length} total | ${featureRows.length} feature | ${heatRows.length} heat | ${qualRows.length} qualifying`);

// ── Build heat-position lookup: eventId+driverNorm → best heat finish ─────────
// Heat finish pos is in the "Pos." column (col 19)
const heatMap = new Map();
for (const row of heatRows) {
  const eventId   = row[C.event_id];
  const driver    = row[C.Driver]?.trim();
  const heatPos   = parseFloat(row[C["Pos."]]);
  if (!driver || isNaN(heatPos) || heatPos <= 0) continue;
  const key = `${eventId}|${normName(driver)}`;
  const cur = heatMap.get(key);
  if (cur === undefined || heatPos < cur) heatMap.set(key, heatPos);
}

// ── Build qualifying lookup: eventId → sorted [{driver, time}] ────────────────
// Qualifying time is in the "Time" column (col 22), qual position in "POS" (col 8)
const qualByEvent = new Map();
for (const row of qualRows) {
  const eventId = row[C.event_id];
  const driver  = row[C.Driver]?.trim();
  const timeStr = row[C.Time]?.trim();
  const time    = timeStr && timeStr !== "No Time" ? parseFloat(timeStr) : null;
  if (!driver || !time || isNaN(time)) continue;
  if (!qualByEvent.has(eventId)) qualByEvent.set(eventId, []);
  qualByEvent.get(eventId).push({ driver: normName(driver), time });
}

// Build qual rank map: eventId+driverNorm → {time, rank}
const qualRankMap = new Map();
for (const [eventId, entries] of qualByEvent) {
  // Deduplicate by driver, keep best (lowest) time
  const byDriver = new Map();
  for (const e of entries) {
    const cur = byDriver.get(e.driver);
    if (!cur || e.time < cur) byDriver.set(e.driver, e.time);
  }
  const sorted = [...byDriver.entries()].sort((a, b) => a[1] - b[1]);
  sorted.forEach(([driver, time], i) => {
    qualRankMap.set(`${eventId}|${driver}`, { time, rank: i + 1 });
  });
}

// ── Load existing tracks and drivers ──────────────────────────────────────────
const dbTracks  = db.prepare("SELECT id, name FROM tracks").all();
const dbDrivers = db.prepare("SELECT id, name FROM drivers").all();

// Track cache: normalized name → id
const trackCache = new Map(dbTracks.map(t => [t.name.toLowerCase(), t.id]));
// Also add aliases pointing to existing ids
for (const [alias, canonical] of Object.entries(TRACK_ALIASES)) {
  const id = trackCache.get(canonical.toLowerCase());
  if (id) trackCache.set(alias.toLowerCase(), id);
}

// Driver cache: normalized name → id
const driverCache = new Map(dbDrivers.map(d => [normName(d.name), d.id]));

function getOrCreateTrack(name, location) {
  const key = name.toLowerCase();
  const aliasKey = TRACK_ALIASES[key]?.toLowerCase() ?? key;
  if (trackCache.has(key))      return trackCache.get(key);
  if (trackCache.has(aliasKey)) return trackCache.get(aliasKey);
  const canonical = TRACK_ALIASES[key] ?? name;
  const r = db.prepare("INSERT INTO tracks (name, location, surface_type) VALUES (?, ?, 'Clay')")
    .run(canonical, location || null);
  const id = r.lastInsertRowid;
  trackCache.set(key, id);
  trackCache.set(canonical.toLowerCase(), id);
  console.log(`  + Track: ${canonical}`);
  return id;
}

function getOrCreateDriver(name, carNumber) {
  const norm = normName(name);
  if (driverCache.has(norm)) return driverCache.get(norm);
  // Last-name + first-initial fallback
  const lastName    = norm.split(" ").pop() ?? "";
  const firstLetter = norm[0] ?? "";
  for (const [n, id] of driverCache) {
    if (n.split(" ").pop() === lastName && n[0] === firstLetter) {
      driverCache.set(norm, id);
      return id;
    }
  }
  const r = db.prepare("INSERT INTO drivers (name, car_number, division) VALUES (?, ?, 'WoO Late Models')")
    .run(name.trim(), carNumber || null);
  const id = r.lastInsertRowid;
  driverCache.set(norm, id);
  return id;
}

// ── Existing mrp_event_id + name combos (skip on re-run) ─────────────────────
const existingRaces = new Set(
  db.prepare("SELECT mrp_event_id, name FROM races WHERE mrp_event_id IS NOT NULL").all()
    .map(r => `${r.mrp_event_id}|${r.name}`)
);

// ── Prepared statements ───────────────────────────────────────────────────────
const stmtRace = db.prepare(`
  INSERT INTO races (name, track_id, race_date, division, distance, status, mrp_event_id)
  VALUES (?, ?, ?, 'WoO Late Models', ?, 'complete', ?)
`);
const stmtEntry = db.prepare(`
  INSERT OR IGNORE INTO race_entries
    (race_id, driver_id, car_number, starting_position, qualifying_time,
     heat_position, finishing_position, laps_led, dnf, money)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// ── Group feature rows by (event_id, session) ─────────────────────────────────
const featureGroups = new Map();
for (const row of featureRows) {
  const key = `${row[C.event_id]}|${row[C.session]?.trim()}`;
  if (!featureGroups.has(key)) featureGroups.set(key, []);
  featureGroups.get(key).push(row);
}

// ── Import ────────────────────────────────────────────────────────────────────
let racesImported = 0, racesSkipped = 0;
let entriesImported = 0, driversCreated = 0;

const prevDriverCount = driverCache.size;

db.exec("BEGIN");
try {
  for (const [key, rows] of featureGroups) {
    const [eventId, session] = key.split("|");
    const sample = rows[0];

    const raceName    = sample[C.race_name]?.trim() || "WoO Feature";
    const sessionTag  = session === "Feature Results" ? ""
                      : session === "Feature 2 Results" ? " (Night 2)"
                      : session === "Feature 3 Results" ? " (Night 3)"
                      : ` (${session.replace(" Results", "")})`;
    const fullName    = `${raceName}${sessionTag}`;
    const dedupeKey   = `${eventId}|${fullName}`;

    if (existingRaces.has(dedupeKey)) { racesSkipped++; continue; }

    const trackName   = sample[C.track]?.trim();
    const location    = sample[C.location]?.trim();
    const dateStr     = sample[C.date]?.trim();
    const raceDate    = parseDate(dateStr);

    if (!trackName || !raceDate) continue;

    const trackId = getOrCreateTrack(trackName, location);

    // Distance = max laps completed among non-DNF finishers
    const maxLaps = Math.max(...rows
      .filter(r => /^running$/i.test(r[C.Status]))
      .map(r => parseFloat(r[C.Laps]) || 0), 0);

    const raceId = stmtRace.run(fullName, trackId, raceDate, maxLaps || null, parseInt(eventId, 10)).lastInsertRowid;
    racesImported++;

    for (const row of rows) {
      const driverName = row[C.Driver]?.trim();
      const carNum     = row[C["#"]]?.trim();
      if (!driverName) continue;

      const finPos  = parseFloat(row[C.POS]) || null;
      if (!finPos) continue;

      const driverId = getOrCreateDriver(driverName, carNum);

      const rawStart  = parseFloat(row[C.Start]);
      const startPos  = rawStart > 0 ? rawStart : null;
      const lapsLed   = parseFloat(row[C.Led]) || 0;
      const dnf       = /^running$/i.test(row[C.Status]?.trim() || "") ? 0 : 1;
      const money     = parseFloat(row[C.Money_num]) || null;

      const driverNorm = normName(driverName);
      const heatPos    = heatMap.get(`${eventId}|${driverNorm}`) ?? null;
      const qualData   = qualRankMap.get(`${eventId}|${driverNorm}`);
      const qualTime   = qualData?.time ?? null;

      stmtEntry.run(raceId, driverId, carNum || null, startPos, qualTime, heatPos, finPos, lapsLed, dnf, money);
      entriesImported++;
    }
  }

  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

driversCreated = driverCache.size - prevDriverCount;

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n=== Import complete ===");
console.log(`Races imported:   ${racesImported}`);
console.log(`Races skipped:    ${racesSkipped}  (already in DB)`);
console.log(`Entries imported: ${entriesImported}`);
console.log(`New drivers:      ${driversCreated}`);
console.log(`New tracks:       ${trackCache.size - dbTracks.length}`);

const totals = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM races)        AS races,
    (SELECT COUNT(*) FROM race_entries) AS entries,
    (SELECT COUNT(*) FROM drivers)      AS drivers,
    (SELECT COUNT(*) FROM tracks)       AS tracks
`).get();
console.log("\nDB totals:", totals);
