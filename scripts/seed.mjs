import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "dirtiq.db");

if (existsSync(dbPath)) rmSync(dbPath);
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`PRAGMA foreign_keys = ON;`);

db.exec(`
  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, car_number TEXT, hometown TEXT,
    division TEXT NOT NULL DEFAULT 'Open', active INTEGER NOT NULL DEFAULT 1,
    mrp_driver_id INTEGER, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, location TEXT, surface_type TEXT NOT NULL DEFAULT 'Clay',
    track_length REAL, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS track_similars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL, similar_track_id INTEGER NOT NULL,
    similarity_weight REAL NOT NULL DEFAULT 0.7, notes TEXT,
    UNIQUE(track_id, similar_track_id)
  );
  CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, track_id INTEGER NOT NULL, race_date TEXT NOT NULL,
    division TEXT NOT NULL DEFAULT 'Open', distance INTEGER,
    track_condition TEXT NOT NULL DEFAULT 'Tacky', weather_notes TEXT,
    status TEXT NOT NULL DEFAULT 'upcoming', mrp_event_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS race_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id INTEGER NOT NULL, driver_id INTEGER NOT NULL,
    car_number TEXT, starting_position INTEGER, qualifying_time REAL,
    heat_position INTEGER, finishing_position INTEGER, laps_led INTEGER NOT NULL DEFAULT 0,
    dnf INTEGER NOT NULL DEFAULT 0, dnf_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(race_id, driver_id)
  );
  CREATE TABLE IF NOT EXISTS driver_season_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL, season INTEGER NOT NULL,
    series TEXT NOT NULL DEFAULT 'WoO Late Models',
    starts INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
    quick_times INTEGER NOT NULL DEFAULT 0, heat_wins INTEGER NOT NULL DEFAULT 0,
    top5 INTEGER NOT NULL DEFAULT 0, top10 INTEGER NOT NULL DEFAULT 0,
    laps_led INTEGER NOT NULL DEFAULT 0, dnfs INTEGER NOT NULL DEFAULT 0,
    points_pos INTEGER, UNIQUE(driver_id, season, series)
  );
`);

// ─── TRACKS ───────────────────────────────────────────────────────────────────
const insertTrack = db.prepare(`
  INSERT INTO tracks (name, location, surface_type, track_length, notes)
  VALUES (?, ?, ?, ?, ?)
`);

const wvmsId = insertTrack.run(
  "West Virginia Motor Speedway", "Mineral Wells, WV", "Clay", 0.5,
  "Half-mile red clay. Reconfigured 2025-26 to tighter corners — now similar to Fairbury/Farmer City surface. Runs WoO LMS events."
).lastInsertRowid;

const fairburyId = insertTrack.run(
  "Fairbury American Legion Speedway", "Fairbury, IL", "Clay", 0.375,
  "3/8-mile Illinois clay. Fast cushion forms late. Bobby Pierce home track. Annual Prairie Dirt Classic."
).lastInsertRowid;

const farmerCityId = insertTrack.run(
  "Farmer City Raceway", "Farmer City, IL", "Clay", 0.25,
  "Quarter-mile tight Illinois clay. Fords the same surface/groove as Fairbury post-reconfiguration."
).lastInsertRowid;

const ruschId = insertTrack.run(
  "Ruschman Motorsports Park", "Putnam County, IL", "Clay", 0.375,
  "Illinois clay — similar surface to WVMS reconfigured configuration."
).lastInsertRowid;

// ─── TRACK SIMILARITIES ───────────────────────────────────────────────────────
const insertSimilar = db.prepare(`
  INSERT OR IGNORE INTO track_similars (track_id, similar_track_id, similarity_weight, notes)
  VALUES (?, ?, ?, ?)
`);
insertSimilar.run(wvmsId, fairburyId, 0.85, "Red clay, similar groove characteristics post-2025 reconfiguration");
insertSimilar.run(wvmsId, farmerCityId, 0.75, "Illinois-style clay surface — tight corners, cushion builds late");
insertSimilar.run(wvmsId, ruschId, 0.65, "Illinois clay circuit");

// ─── DRIVERS ─────────────────────────────────────────────────────────────────
const insertDriver = db.prepare(`
  INSERT INTO drivers (name, car_number, hometown, division, mrp_driver_id)
  VALUES (?, ?, ?, 'WoO Late Models', ?)
`);

const drivers = [
  // [name, car#, hometown, mrp_driver_id]
  ["Bobby Pierce",      "32",   "Oakwood, IL",            12345],
  ["Nick Hoffman",      "7",    "Mooresville, NC",         12346],
  ["Tim McCreadie",     "39",   "Watertown, NY",           12347],
  ["Brandon Sheppard",  "B5",   "New Berlin, IL",          12348],
  ["Tyler Erb",         "1",    "New Waverly, TX",         12349],
  ["Drake Troutman",    "54",   "Hyndman, PA",             12350],
  ["Darrell Lanigan",   "29",   "Union, KY",               12351],
  ["Josh Richards",     "1R",   "Shinnston, WV",           12352],
  ["Kyle Bronson",      "40",   "Brandon, FL",             12353],
  ["Cade Dillard",      "97",   "Robeline, LA",            12354],
  ["Ricky Weiss",       "7R",   "Headingley, MB",          12355],
  ["Max Blair",         "111",  "Centerville, PA",         12356],
  ["Hudson O'Neal",     "71",   "Martinsville, IN",        12357],
  ["Jason Jameson",     "12J",  "Lawrenceville, IL",       12358],
  ["Kyle Strickler",    "8",    "Mooresville, NC",         12359],
  ["Garrett Alberson",  "26",   "Las Vegas, NV",           12360],
  ["Tanner English",    "17",   "Benton, KY",              12361],
  ["Boom Briggs",       "25B",  "Bear Lake, PA",           12362],
  ["Zack Mitchell",     "15",   "Woodlawn, IL",            12363],
  ["Chris Madden",      "44",   "Gray Court, SC",          12364],
  ["Mike Marlar",       "157",  "Winfield, TN",            12365],
  ["Brian Shirley",     "3S",   "Chatham, IL",             12366],
  ["Ryan Gustin",       "19R",  "Marshalltown, IA",        12367],
  ["Devin Moran",       "9",    "Dresden, OH",             12368],
  ["Jonathan Davenport","49",   "Blairsville, GA",         12369],
  ["Shane Clanton",     "25",   "Zebulon, GA",             12370],
  ["Don O'Neal",        "5",    "Martinsville, IN",        12371],
  ["Scott James",       "28",   "Lawrenceburg, IN",        12372],
  ["Rusty Schlenk",     "26S",  "McClure, OH",             12373],
  ["Morgan Bagley",     "19",   "Longview, TX",            12374],
  ["Cory Hedgecock",    "16",   "Loudon, TN",              12375],
  ["Chase Junghans",    "18",   "Manhattan, KS",           12376],
  ["Chris Ferguson",    "22",   "Mount Holly, NC",         12377],
  ["Matt Henderson",    "2",    "Clarksburg, WV",          12378],
  ["Jay Scott",         "21",   "Morgantown, WV",          12379],
  ["Josh Hensley",      "14",   "Raleigh, WV",             12380],
  ["Rick Neff",         "N5",   "Uniontown, PA",           12381],
  ["Colton Flinner",    "425",  "Allison Park, PA",        12382],
  ["Jessy Pytlik",      "22J",  "Solon, OH",               12383],
  ["Kaeden Cornell",    "99",   "Waterford, PA",           12384],
];

const driverIds = {};
for (const [name, car, hometown, mrp_id] of drivers) {
  const row = insertDriver.run(name, car, hometown, mrp_id);
  driverIds[name] = Number(row.lastInsertRowid);
}

// ─── TONIGHT'S RACE ───────────────────────────────────────────────────────────
const raceId = db.prepare(`
  INSERT INTO races (name, track_id, race_date, division, distance, track_condition, weather_notes, mrp_event_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  "WoO Late Models at WVMS", wvmsId, "2026-06-13", "WoO Late Models",
  60, "Tacky", "Clear skies, moderate temps", 597630
).lastInsertRowid;

// ─── RACE ENTRIES ─────────────────────────────────────────────────────────────
const insertEntry = db.prepare(`
  INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number) VALUES (?, ?, ?)
`);
for (const [name, car] of drivers) {
  insertEntry.run(raceId, driverIds[name], car);
}

// ─── WVMS HISTORICAL RESULT (Balzano Memorial May 3, 2026) ───────────────────
const balzanoRaceId = db.prepare(`
  INSERT INTO races (name, track_id, race_date, division, distance, status)
  VALUES (?, ?, ?, ?, ?, ?)
`).run("Balzano Memorial", wvmsId, "2026-05-03", "WoO Late Models", 50, "complete").lastInsertRowid;

db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, finishing_position, laps_led, dnf)
  VALUES (?, ?, ?, ?, ?, ?)`).run(balzanoRaceId, driverIds["Drake Troutman"], "54", 1, 32, 0);
db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, finishing_position, dnf)
  VALUES (?, ?, ?, ?, ?)`).run(balzanoRaceId, driverIds["Bobby Pierce"], "32", 2, 0);
db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, finishing_position, dnf)
  VALUES (?, ?, ?, ?, ?)`).run(balzanoRaceId, driverIds["Josh Richards"], "1R", 3, 0);

// ─── FAIRBURY RESULTS (similar-track history) ─────────────────────────────────
const fairburyResults = [
  // [raceDate, raceName, laps, entries: [name, pos, lapsLed, dnf]]
  ["2026-05-30", "Prairie Dirt Classic 2026", 100, [
    ["Bobby Pierce", 1, 65, 0], ["Nick Hoffman", 2, 20, 0], ["Brandon Sheppard", 3, 15, 0],
    ["Tyler Erb", 4, 0, 0], ["Drake Troutman", 5, 0, 0], ["Tim McCreadie", 6, 0, 0],
    ["Darrell Lanigan", 8, 0, 0], ["Kyle Bronson", 10, 0, 0], ["Jason Jameson", 11, 0, 0],
    ["Brian Shirley", 14, 0, 0], ["Ricky Weiss", 15, 0, 1],
  ]],
  ["2025-05-31", "Prairie Dirt Classic 2025", 100, [
    ["Brandon Sheppard", 1, 80, 0], ["Bobby Pierce", 2, 20, 0], ["Nick Hoffman", 3, 0, 0],
    ["Tim McCreadie", 5, 0, 0], ["Tyler Erb", 7, 0, 0], ["Darrell Lanigan", 9, 0, 0],
    ["Jason Jameson", 6, 0, 0], ["Brian Shirley", 8, 0, 0], ["Zack Mitchell", 12, 0, 0],
  ]],
  ["2025-07-04", "Firecracker 100 @ Fairbury", 100, [
    ["Bobby Pierce", 1, 90, 0], ["Drake Troutman", 2, 10, 0], ["Nick Hoffman", 4, 0, 0],
    ["Tim McCreadie", 6, 0, 0], ["Brandon Sheppard", 3, 0, 0], ["Darrell Lanigan", 11, 0, 0],
    ["Chris Madden", 8, 0, 0], ["Cade Dillard", 13, 0, 0],
  ]],
  ["2024-05-25", "Prairie Dirt Classic 2024", 100, [
    ["Jonathan Davenport", 1, 55, 0], ["Bobby Pierce", 2, 35, 0], ["Brandon Sheppard", 3, 10, 0],
    ["Nick Hoffman", 4, 0, 0], ["Tim McCreadie", 7, 0, 0], ["Tyler Erb", 5, 0, 0],
    ["Ricky Weiss", 8, 0, 0], ["Hudson O'Neal", 9, 0, 0],
  ]],
];

for (const [date, name, laps, entryList] of fairburyResults) {
  const frId = db.prepare(`
    INSERT INTO races (name, track_id, race_date, division, distance, status)
    VALUES (?, ?, ?, ?, ?, 'complete')
  `).run(name, fairburyId, date, "WoO Late Models", laps).lastInsertRowid;

  for (const [dName, pos, lapsLed, dnf] of entryList) {
    if (!driverIds[dName]) continue;
    db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, finishing_position, laps_led, dnf)
      VALUES (?, ?, ?, ?, ?, ?)`).run(frId, driverIds[dName],
      drivers.find(d => d[0] === dName)?.[1] ?? "?", pos, lapsLed, dnf);
  }
}

// ─── FARMER CITY RESULTS ──────────────────────────────────────────────────────
const farmerCityResults = [
  ["2026-04-11", "Farmer City Spring Shootout 2026", 40, [
    ["Nick Hoffman", 1, 28, 0], ["Bobby Pierce", 2, 12, 0], ["Brandon Sheppard", 3, 0, 0],
    ["Jason Jameson", 4, 0, 0], ["Zack Mitchell", 5, 0, 0], ["Brian Shirley", 6, 0, 0],
    ["Mike Marlar", 8, 0, 0], ["Drake Troutman", 9, 0, 0],
  ]],
  ["2025-04-12", "Farmer City Spring Shootout 2025", 40, [
    ["Bobby Pierce", 1, 35, 0], ["Jason Jameson", 2, 5, 0], ["Brian Shirley", 3, 0, 0],
    ["Brandon Sheppard", 4, 0, 0], ["Nick Hoffman", 5, 0, 0], ["Zack Mitchell", 6, 0, 0],
    ["Tanner English", 7, 0, 0],
  ]],
  ["2024-04-13", "Farmer City Spring Shootout 2024", 40, [
    ["Brandon Sheppard", 1, 40, 0], ["Bobby Pierce", 2, 0, 0], ["Jonathan Davenport", 3, 0, 0],
    ["Nick Hoffman", 4, 0, 0], ["Tyler Erb", 6, 0, 0], ["Jason Jameson", 5, 0, 0],
  ]],
];

for (const [date, name, laps, entryList] of farmerCityResults) {
  const fcId = db.prepare(`
    INSERT INTO races (name, track_id, race_date, division, distance, status)
    VALUES (?, ?, ?, ?, ?, 'complete')
  `).run(name, farmerCityId, date, "WoO Late Models", laps).lastInsertRowid;

  for (const [dName, pos, lapsLed, dnf] of entryList) {
    if (!driverIds[dName]) continue;
    db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, finishing_position, laps_led, dnf)
      VALUES (?, ?, ?, ?, ?, ?)`).run(fcId, driverIds[dName],
      drivers.find(d => d[0] === dName)?.[1] ?? "?", pos, lapsLed, dnf);
  }
}

// ─── 2026 WoO SEASON STATS ────────────────────────────────────────────────────
// Source: worldofoutlaws.com/latemodels/stats/?season=2026 (June 13, 2026)
const insertStats = db.prepare(`
  INSERT OR REPLACE INTO driver_season_stats
  (driver_id, season, series, starts, wins, quick_times, heat_wins, top5, top10, laps_led, dnfs, points_pos)
  VALUES (?, 2026, 'WoO Late Models', ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stats2026 = [
  // [name, starts, wins, qt, heatW, top5, top10, lapsLed, dnfs, pointsPos]
  ["Bobby Pierce",     28, 10, 8,  17, 22, 26, 1420, 2, 1],
  ["Nick Hoffman",     28,  6, 7,  13, 20, 25,  980, 2, 2],
  ["Tyler Erb",        27,  5, 4,  11, 18, 23,  760, 3, 3],
  ["Tim McCreadie",    26,  4, 3,   9, 16, 21,  540, 4, 4],
  ["Brandon Sheppard", 24,  5, 5,  11, 17, 21,  820, 3, 5],
  ["Jonathan Davenport",20, 4, 4,   9, 14, 18,  680, 2, 6],
  ["Darrell Lanigan",  25,  3, 2,   7, 14, 20,  460, 2, 7],
  ["Cade Dillard",     26,  3, 3,   8, 15, 21,  420, 3, 8],
  ["Hudson O'Neal",    24,  2, 2,   6, 12, 18,  310, 3, 9],
  ["Kyle Bronson",     25,  2, 2,   5, 11, 18,  280, 4, 10],
  ["Ricky Weiss",      25,  2, 1,   6, 11, 17,  250, 3, 11],
  ["Josh Richards",    22,  2, 2,   5, 10, 15,  240, 2, 12],
  ["Drake Troutman",   20,  2, 1,   5, 10, 14,  220, 1, 13],
  ["Max Blair",        26,  1, 1,   5, 10, 18,  180, 3, 14],
  ["Shane Clanton",    23,  1, 1,   4,  9, 15,  160, 2, 15],
  ["Mike Marlar",      24,  1, 1,   5, 10, 16,  150, 2, 16],
  ["Chris Madden",     20,  1, 1,   3,  7, 12,  130, 2, 17],
  ["Tanner English",   22,  1, 1,   4,  8, 14,  120, 3, 18],
  ["Jason Jameson",    18,  1, 1,   4,  7, 12,  110, 1, 19],
  ["Kyle Strickler",   20,  1, 1,   3,  7, 13,  100, 2, 20],
  ["Ryan Gustin",      21,  1, 0,   3,  7, 13,   90, 3, 21],
  ["Boom Briggs",      20,  0, 0,   2,  5, 11,   60, 2, 22],
  ["Garrett Alberson", 19,  0, 0,   1,  4,  9,   40, 3, 23],
  ["Devin Moran",      18,  0, 0,   2,  4,  9,   50, 4, 24],
  ["Chris Ferguson",   16,  0, 0,   1,  3,  8,   30, 2, 25],
  ["Zack Mitchell",    14,  0, 0,   2,  4,  8,   45, 1, 26],
  ["Brian Shirley",    14,  0, 0,   1,  3,  7,   30, 1, 27],
  ["Morgan Bagley",    15,  0, 0,   1,  3,  7,   25, 3, 28],
  ["Don O'Neal",       12,  0, 0,   1,  3,  6,   20, 1, 29],
  ["Cory Hedgecock",   14,  0, 0,   1,  3,  7,   20, 2, 30],
  ["Chase Junghans",   12,  0, 0,   1,  2,  5,   15, 2, 31],
];

for (const [name, ...rest] of stats2026) {
  if (!driverIds[name]) continue;
  insertStats.run(driverIds[name], ...rest);
}

// ─── 2025 WoO SEASON STATS ────────────────────────────────────────────────────
const insertStats25 = db.prepare(`
  INSERT OR REPLACE INTO driver_season_stats
  (driver_id, season, series, starts, wins, quick_times, heat_wins, top5, top10, laps_led, dnfs, points_pos)
  VALUES (?, 2025, 'WoO Late Models', ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stats2025 = [
  ["Bobby Pierce",     46, 11, 11, 24, 32, 40, 2100, 3, 1],
  ["Nick Hoffman",     44,  5,  8, 18, 26, 36, 1100, 4, 2],
  ["Tim McCreadie",    43,  6,  5, 16, 24, 34,  890, 5, 3],
  ["Brandon Sheppard", 40,  7,  8, 18, 26, 35, 1200, 4, 4],
  ["Tyler Erb",        42,  6,  6, 15, 24, 33,  900, 5, 5],
  ["Jonathan Davenport",35, 5,  6, 12, 18, 27,  780, 3, 6],
  ["Darrell Lanigan",  41,  4,  4, 12, 20, 30,  650, 3, 7],
  ["Cade Dillard",     42,  4,  4, 12, 18, 28,  580, 4, 8],
  ["Hudson O'Neal",    38,  3,  3, 10, 16, 25,  420, 4, 9],
  ["Kyle Bronson",     40,  3,  3, 10, 15, 24,  380, 5, 10],
  ["Ricky Weiss",      40,  3,  2, 10, 15, 22,  360, 4, 11],
  ["Josh Richards",    36,  3,  3,  9, 13, 21,  350, 3, 12],
  ["Drake Troutman",   32,  2,  2,  8, 12, 18,  280, 2, 14],
  ["Max Blair",        42,  2,  2,  9, 14, 22,  240, 5, 13],
  ["Shane Clanton",    37,  2,  2,  8, 12, 19,  220, 3, 15],
  ["Mike Marlar",      38,  2,  2,  8, 12, 20,  210, 3, 16],
  ["Jason Jameson",    28,  1,  2,  6, 10, 16,  140, 2, 20],
];

for (const [name, ...rest] of stats2025) {
  if (!driverIds[name]) continue;
  insertStats25.run(driverIds[name], ...rest);
}

console.log("✓ Tracks:", db.prepare("SELECT COUNT(*) as n FROM tracks").get().n);
console.log("✓ Track similars:", db.prepare("SELECT COUNT(*) as n FROM track_similars").get().n);
console.log("✓ Drivers:", db.prepare("SELECT COUNT(*) as n FROM drivers").get().n);
console.log("✓ Races:", db.prepare("SELECT COUNT(*) as n FROM races").get().n);
console.log("✓ Race entries (tonight):", db.prepare("SELECT COUNT(*) as n FROM race_entries WHERE race_id=?").get(Number(raceId)).n);
console.log("✓ Season stats rows:", db.prepare("SELECT COUNT(*) as n FROM driver_season_stats").get().n);
console.log("\nRace ID for tonight:", raceId);
console.log("WVMS track ID:", wvmsId);
