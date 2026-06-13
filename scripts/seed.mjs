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
    avg_finish REAL, last5_avg_finish REAL,
    points_pos INTEGER, UNIQUE(driver_id, season, series)
  );
`);

const insertTrack = db.prepare(`INSERT INTO tracks (name, location, surface_type, track_length, notes) VALUES (?, ?, ?, ?, ?)`);
const wvmsId     = insertTrack.run("West Virginia Motor Speedway","Mineral Wells, WV","Clay",0.5,"Half-mile red clay. Reconfigured 2025-26 — tighter corners now similar to Fairbury/Farmer City.").lastInsertRowid;
const fairburyId = insertTrack.run("Fairbury American Legion Speedway","Fairbury, IL","Clay",0.375,"3/8-mile IL clay. Bobby Pierce home track. Annual Prairie Dirt Classic.").lastInsertRowid;
const farmerCityId = insertTrack.run("Farmer City Raceway","Farmer City, IL","Clay",0.25,"Quarter-mile tight IL clay. Same surface/groove as Fairbury post-reconfiguration.").lastInsertRowid;
const ruschId    = insertTrack.run("Ruschman Motorsports Park","Putnam County, IL","Clay",0.375,"IL clay — similar surface to WVMS reconfigured layout.").lastInsertRowid;

const insertSim = db.prepare(`INSERT OR IGNORE INTO track_similars (track_id, similar_track_id, similarity_weight, notes) VALUES (?, ?, ?, ?)`);
insertSim.run(wvmsId, fairburyId,   0.85, "Red clay, similar groove post-2025 WVMS reconfiguration");
insertSim.run(wvmsId, farmerCityId, 0.75, "IL-style clay — tight corners, cushion builds late");
insertSim.run(wvmsId, ruschId,      0.60, "IL clay circuit");

const insertDriver = db.prepare(`INSERT INTO drivers (name, car_number, hometown, division, mrp_driver_id) VALUES (?, ?, ?, 'WoO Late Models', ?)`);
const D = [
  ["Bobby Pierce","32","Oakwood, IL",12345],
  ["Nick Hoffman","7","Mooresville, NC",12346],
  ["Tim McCreadie","39","Watertown, NY",12347],
  ["Brandon Sheppard","B5","New Berlin, IL",12348],
  ["Tyler Erb","1","New Waverly, TX",12349],
  ["Drake Troutman","54","Hyndman, PA",12350],
  ["Darrell Lanigan","29","Union, KY",12351],
  ["Josh Richards","1R","Shinnston, WV",12352],
  ["Kyle Bronson","40","Brandon, FL",12353],
  ["Cade Dillard","97","Robeline, LA",12354],
  ["Ricky Weiss","7R","Headingley, MB",12355],
  ["Max Blair","111","Centerville, PA",12356],
  ["Hudson O'Neal","71","Martinsville, IN",12357],
  ["Jason Jameson","12J","Lawrenceville, IL",12358],
  ["Kyle Strickler","8","Mooresville, NC",12359],
  ["Garrett Alberson","26","Las Vegas, NV",12360],
  ["Tanner English","17","Benton, KY",12361],
  ["Boom Briggs","25B","Bear Lake, PA",12362],
  ["Zack Mitchell","15","Woodlawn, IL",12363],
  ["Chris Madden","44","Gray Court, SC",12364],
  ["Mike Marlar","157","Winfield, TN",12365],
  ["Brian Shirley","3S","Chatham, IL",12366],
  ["Ryan Gustin","19R","Marshalltown, IA",12367],
  ["Devin Moran","9","Dresden, OH",12368],
  ["Jonathan Davenport","49","Blairsville, GA",12369],
  ["Shane Clanton","25","Zebulon, GA",12370],
  ["Don O'Neal","5","Martinsville, IN",12371],
  ["Scott James","28","Lawrenceburg, IN",12372],
  ["Rusty Schlenk","26S","McClure, OH",12373],
  ["Morgan Bagley","19","Longview, TX",12374],
  ["Cory Hedgecock","16","Loudon, TN",12375],
  ["Chase Junghans","18","Manhattan, KS",12376],
  ["Chris Ferguson","22","Mount Holly, NC",12377],
  ["Matt Henderson","2","Clarksburg, WV",12378],
  ["Jay Scott","21","Morgantown, WV",12379],
  ["Josh Hensley","14","Raleigh, WV",12380],
  ["Rick Neff","N5","Uniontown, PA",12381],
  ["Colton Flinner","425","Allison Park, PA",12382],
  ["Jessy Pytlik","22J","Solon, OH",12383],
  ["Kaeden Cornell","99","Waterford, PA",12384],
];
const ids = {};
for (const [name,car,home,mrp] of D) ids[name] = Number(insertDriver.run(name,car,home,mrp).lastInsertRowid);

const raceId = Number(db.prepare(`INSERT INTO races (name, track_id, race_date, division, distance, track_condition, weather_notes, mrp_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  .run("WoO Late Models at WVMS", wvmsId, "2026-06-13", "WoO Late Models", 60, "Tacky", "Clear skies, warm temps", 597630).lastInsertRowid);
const ie = db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number) VALUES (?, ?, ?)`);
for (const [name,car] of D) ie.run(raceId, ids[name], car);

const ar = (rId, name, car, pos, ll, dnf) => {
  if (!ids[name]) return;
  db.prepare(`INSERT OR IGNORE INTO race_entries (race_id, driver_id, car_number, finishing_position, laps_led, dnf) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(rId, ids[name], car, pos, ll, dnf ? 1 : 0);
};

const bId = Number(db.prepare(`INSERT INTO races (name, track_id, race_date, division, distance, status) VALUES ('Balzano Memorial', ?, '2026-05-03', 'WoO Late Models', 50, 'complete')`).run(wvmsId).lastInsertRowid);
ar(bId,"Drake Troutman","54",1,32,false); ar(bId,"Bobby Pierce","32",2,8,false);
ar(bId,"Josh Richards","1R",3,0,false);  ar(bId,"Nick Hoffman","7",4,0,false);
ar(bId,"Tim McCreadie","39",5,0,false);  ar(bId,"Tyler Erb","1",6,0,false);

const fbRaces = [
  ["2026-05-30","Prairie Dirt Classic 2026",fairburyId,100,[
    ["Bobby Pierce","32",1,65,false],["Nick Hoffman","7",2,18,false],["Brandon Sheppard","B5",3,10,false],
    ["Tyler Erb","1",4,0,false],["Drake Troutman","54",5,7,false],["Tim McCreadie","39",6,0,false],
    ["Jonathan Davenport","49",7,0,false],["Ryan Gustin","19R",8,0,false],["Darrell Lanigan","29",9,0,false],
    ["Kyle Bronson","40",11,0,false],["Jason Jameson","12J",13,0,false],["Brian Shirley","3S",16,0,false],
    ["Ricky Weiss","7R",18,0,true],
  ]],
  ["2025-07-04","Firecracker 100 @ Fairbury 2025",fairburyId,100,[
    ["Bobby Pierce","32",1,82,false],["Brandon Sheppard","B5",2,14,false],["Drake Troutman","54",3,4,false],
    ["Tim McCreadie","39",4,0,false],["Nick Hoffman","7",5,0,false],["Jonathan Davenport","49",6,0,false],
    ["Tyler Erb","1",7,0,false],["Jason Jameson","12J",8,0,false],["Chris Madden","44",9,0,false],
    ["Darrell Lanigan","29",10,0,false],["Cade Dillard","97",14,0,false],
  ]],
  ["2025-05-31","Prairie Dirt Classic 2025",fairburyId,100,[
    ["Brandon Sheppard","B5",1,78,false],["Bobby Pierce","32",2,16,false],["Nick Hoffman","7",3,6,false],
    ["Tim McCreadie","39",4,0,false],["Jonathan Davenport","49",5,0,false],["Jason Jameson","12J",6,0,false],
    ["Tyler Erb","1",7,0,false],["Darrell Lanigan","29",8,0,false],["Brian Shirley","3S",9,0,false],
    ["Zack Mitchell","15",12,0,false],
  ]],
  ["2024-07-04","Firecracker 100 @ Fairbury 2024",fairburyId,100,[
    ["Bobby Pierce","32",1,70,false],["Jonathan Davenport","49",2,25,false],["Nick Hoffman","7",3,5,false],
    ["Brandon Sheppard","B5",4,0,false],["Tim McCreadie","39",5,0,false],["Drake Troutman","54",6,0,false],
    ["Tyler Erb","1",8,0,false],["Hudson O'Neal","71",9,0,false],
  ]],
  ["2024-05-25","Prairie Dirt Classic 2024",fairburyId,100,[
    ["Jonathan Davenport","49",1,52,false],["Bobby Pierce","32",2,38,false],["Brandon Sheppard","B5",3,10,false],
    ["Nick Hoffman","7",4,0,false],["Tyler Erb","1",5,0,false],["Jason Jameson","12J",6,0,false],
    ["Ryan Gustin","19R",7,0,false],["Ricky Weiss","7R",9,0,false],["Hudson O'Neal","71",10,0,false],
  ]],
  ["2026-04-11","Spring Shootout Farmer City 2026",farmerCityId,40,[
    ["Nick Hoffman","7",1,30,false],["Bobby Pierce","32",2,8,false],["Brandon Sheppard","B5",3,2,false],
    ["Jason Jameson","12J",4,0,false],["Zack Mitchell","15",5,0,false],["Brian Shirley","3S",6,0,false],
    ["Mike Marlar","157",7,0,false],["Drake Troutman","54",8,0,false],["Tyler Erb","1",9,0,false],
    ["Tim McCreadie","39",11,0,false],
  ]],
  ["2025-04-12","Spring Shootout Farmer City 2025",farmerCityId,40,[
    ["Bobby Pierce","32",1,38,false],["Jason Jameson","12J",2,2,false],["Brian Shirley","3S",3,0,false],
    ["Brandon Sheppard","B5",4,0,false],["Nick Hoffman","7",5,0,false],["Zack Mitchell","15",6,0,false],
    ["Tanner English","17",7,0,false],["Drake Troutman","54",8,0,false],
  ]],
  ["2024-04-13","Spring Shootout Farmer City 2024",farmerCityId,40,[
    ["Brandon Sheppard","B5",1,40,false],["Bobby Pierce","32",2,0,false],["Jonathan Davenport","49",3,0,false],
    ["Nick Hoffman","7",4,0,false],["Tyler Erb","1",5,0,false],["Jason Jameson","12J",6,0,false],
    ["Ryan Gustin","19R",7,0,false],
  ]],
];

for (const [date,name,trackId,laps,entries] of fbRaces) {
  const rId = Number(db.prepare(`INSERT INTO races (name, track_id, race_date, division, distance, status) VALUES (?, ?, ?, ?, ?, 'complete')`)
    .run(name, trackId, date, "WoO Late Models", laps).lastInsertRowid);
  for (const [dName,car,pos,ll,dnf] of entries) ar(rId, dName, car, pos, ll, dnf);
}

// 2026 WoO stats — verified from dirtrackr.com June 13 2026
// cols: starts,wins,qt,heatW,top5,top10,lapsLed,dnfs,avgFinish,last5Avg,pointsPos
const is26 = db.prepare(`INSERT OR REPLACE INTO driver_season_stats (driver_id,season,series,starts,wins,quick_times,heat_wins,top5,top10,laps_led,dnfs,avg_finish,last5_avg_finish,points_pos) VALUES (?,2026,'WoO Late Models',?,?,?,?,?,?,?,?,?,?,?)`);
const s26 = [
  ["Bobby Pierce",      28,10, 5,12,20,28,236,1, 3.68, 2.8, 1],
  ["Nick Hoffman",      28, 6, 9,16,23,27,134,1, 3.89, 6.4, 2],
  ["Tyler Erb",         28, 1, 2, 8,12,20, 40,2, 8.64, 4.2, 3],
  ["Tim McCreadie",     28, 2, 2, 3, 9,17, 46,3,10.00,12.5, 4],
  ["Drake Troutman",    28, 0, 1, 6, 9,18, 19,1, 8.89, 8.8, 5],
  ["Brandon Sheppard",  12, 2, 3, 5, 8,10, 58,1, 5.75, 9.0, 6],
  ["Ryan Gustin",       28, 1, 0, 7, 8,14, 50,2,10.43,13.2, 7],
  ["Hudson O'Neal",     14, 2, 2, 5, 6, 9, 45,1, 6.91, 8.0, 8],
  ["Chris Madden",      12, 1, 5, 7, 5, 6, 36,1, 7.83,11.0, 9],
  ["Ricky Thornton",    11, 1, 3, 5, 5, 8, 40,0, 9.55,14.0,10],
  ["Jonathan Davenport", 8, 0, 1, 3, 4, 5, 22,0, 9.00,10.5,11],
  ["Ethan Dotson",      28, 0, 0, 2, 5,16, 12,2,10.67,14.0,12],
  ["Daulton Wilson",    20, 0, 0, 4, 7,13, 14,2,11.50,15.0,13],
  ["Mason Zeigler",      7, 1, 1, 3, 2, 2, 11,0,11.20,10.0,14],
  ["Dustin Sorensen",   22, 0, 0, 2, 2,13,  8,2,12.00,14.5,15],
  ["Cade Dillard",      20, 0, 0, 0, 1, 2,  4,3,15.50,18.0,16],
  ["Max Blair",         22, 0, 0, 1, 1, 4,  5,2,14.00,17.0,17],
  ["Mike Marlar",        8, 1, 0, 1, 1, 2, 39,0,12.00,13.0,18],
  ["Garrett Alberson",  20, 0, 1, 1, 0, 4,  4,3, 7.40,12.0,19],
  ["Ricky Weiss",       20, 0, 0, 0, 0, 2,  3,4,15.00,18.0,20],
  ["Darrell Lanigan",   18, 0, 0, 0, 0, 2,  2,3,14.50,18.0,21],
  ["Kyle Bronson",      16, 0, 0, 0, 0, 1,  2,4,16.00,20.0,22],
  ["Kyle Strickler",    14, 0, 0, 0, 0, 2,  2,2,15.00,17.0,23],
  ["Chase Junghans",    12, 0, 0, 0, 0, 1,  1,2,17.00,19.0,24],
  ["Tanner English",    14, 0, 0, 0, 0, 1,  2,2,16.50,18.5,25],
  ["Brian Shirley",     10, 0, 0, 0, 0, 1,  2,1,15.00,17.0,26],
  ["Boom Briggs",       12, 0, 0, 0, 0, 0,  1,2,18.00,20.0,27],
  ["Chris Ferguson",    10, 0, 0, 0, 0, 3,  1,1,14.00,16.0,28],
  ["Devin Moran",        8, 0, 0, 0, 0, 0,  1,2,17.00,20.0,29],
  ["Zack Mitchell",      8, 0, 0, 0, 0, 1,  2,1,10.50,13.0,30],
  ["Josh Richards",     10, 0, 0, 0, 0, 1,  2,1,15.00,16.0,31],
];
for (const [name,...rest] of s26) { if (!ids[name]) continue; is26.run(ids[name], ...rest); }

// 2025 WoO stats
const is25 = db.prepare(`INSERT OR REPLACE INTO driver_season_stats (driver_id,season,series,starts,wins,quick_times,heat_wins,top5,top10,laps_led,dnfs,avg_finish,last5_avg_finish,points_pos) VALUES (?,2025,'WoO Late Models',?,?,?,?,?,?,?,?,?,?,?)`);
const s25 = [
  ["Bobby Pierce",      40,11,10,26,28,36,494,2, 4.2,null,1],
  ["Nick Hoffman",      40, 5,10,16,24,35,178,3, 5.8,null,2],
  ["Tim McCreadie",     40, 4, 2,11,18,28,176,4, 7.5,null,3],
  ["Brian Shirley",     40, 3, 4,15,20,30,136,3, 7.2,null,4],
  ["Drake Troutman",    40, 2, 2,11,16,28, 76,2, 8.1,null,5],
  ["Ryan Gustin",       40, 4, 0,12,18,30,280,3, 7.8,null,6],
  ["Jonathan Davenport",14, 3, 2, 4,10,13, 98,1, 7.2,null,7],
  ["Brandon Sheppard",  20, 3, 2, 3,12,16,100,2, 8.0,null,8],
  ["Tyler Erb",         18, 2, 2, 3, 8,12, 50,2, 9.0,null,9],
  ["Dennis Erb",        30, 2, 1, 4,10,18, 58,2, 9.5,null,10],
  ["Ethan Dotson",      40, 2, 2, 5,10,20, 54,3,10.5,null,11],
  ["Garrett Alberson",  18, 1, 1, 5, 5, 9, 22,1, 9.8,null,12],
  ["Ashton Winger",     20, 2, 0, 4, 6,10, 88,2,10.0,null,13],
  ["Hudson O'Neal",     20, 1, 0, 3, 4, 8,  8,3,11.5,null,14],
  ["Mike Marlar",       14, 1, 1, 2, 4, 8,  8,1,10.5,null,15],
  ["Tanner English",    20, 1, 0, 2, 4, 8, 40,2,11.0,null,16],
];
for (const [name,...rest] of s25) { if (!ids[name]) continue; is25.run(ids[name], ...rest); }

// 2026 Lucas Oil stats (cross-series versatility indicator)
const ilucas = db.prepare(`INSERT OR REPLACE INTO driver_season_stats (driver_id,season,series,starts,wins,quick_times,heat_wins,top5,top10,laps_led,dnfs,avg_finish,last5_avg_finish,points_pos) VALUES (?,2026,'Lucas Oil',?,?,?,?,?,?,?,?,?,?,?)`);
const luc26 = [
  ["Hudson O'Neal",      18,4,2,10,16,17, 80,1,4.5,null,1],
  ["Brandon Sheppard",   12,3,3,11,14,16, 70,1,4.2,null,2],
  ["Devin Moran",        14,3,2, 5,13,15, 60,1,5.0,null,3],
  ["Jonathan Davenport", 10,2,3, 5, 7, 9, 45,1,6.5,null,4],
  ["Ricky Thornton",     12,2,3, 5, 7,10, 38,0,6.8,null,5],
  ["Max Blair",          18,2,0, 1,10,15, 40,1,7.0,null,6],
  ["Garrett Alberson",    8,1,4, 4, 5, 7, 22,1,5.0,null,7],
  ["Kyle Bronson",        4,0,2, 2, 1, 3,  5,1,10.0,null,8],
  ["Bobby Pierce",        4,0,1, 1, 2, 3,  8,0,8.5,null,9],
  ["Nick Hoffman",        3,0,0, 0, 1, 2,  3,0,9.0,null,10],
  ["Drake Troutman",      4,0,2, 0, 1, 2,  2,0,9.5,null,11],
  ["Jason Jameson",       6,0,0, 1, 0, 2,  2,1,14.0,null,12],
  ["Chase Junghans",      4,0,0, 1, 0, 1,  1,1,16.0,null,13],
  ["Tim McCreadie",       8,0,0, 0, 2, 4,  5,2,11.0,null,14],
  ["Mike Marlar",         4,0,1, 1, 0, 1,  1,0,12.0,null,15],
];
for (const [name,...rest] of luc26) { if (!ids[name]) continue; ilucas.run(ids[name], ...rest); }

console.log("Tracks:", db.prepare("SELECT COUNT(*) as n FROM tracks").get().n);
console.log("Track similars:", db.prepare("SELECT COUNT(*) as n FROM track_similars").get().n);
console.log("Drivers:", db.prepare("SELECT COUNT(*) as n FROM drivers").get().n);
console.log("Races:", db.prepare("SELECT COUNT(*) as n FROM races").get().n);
console.log("Entries tonight:", db.prepare("SELECT COUNT(*) as n FROM race_entries WHERE race_id=1").get().n);
console.log("Season stat rows:", db.prepare("SELECT COUNT(*) as n FROM driver_season_stats").get().n);
console.log("\nTop drivers by 2026 WoO win rate (dirtrackr verified):");
const top = db.prepare(`SELECT d.name,s.wins,s.starts,s.quick_times,s.heat_wins,s.avg_finish,s.last5_avg_finish FROM driver_season_stats s JOIN drivers d ON d.id=s.driver_id WHERE s.season=2026 AND s.series='WoO Late Models' AND s.starts>=8 ORDER BY CAST(s.wins AS REAL)/s.starts DESC LIMIT 12`).all();
for (const r of top) console.log(`  ${r.name.padEnd(22)} ${r.wins}W/${r.starts}S  QT%=${(r.quick_times/r.starts*100).toFixed(0)}%  AvgFin=${r.avg_finish?.toFixed(1)}  Hot5=${r.last5_avg_finish}`);
