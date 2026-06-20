import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] ?? "data/dirtiq.db";
const db = new DatabaseSync(dbPath);

const tracks = [
  ["141 Speedway", "Maribel, WI"],
  ["34 Raceway", "West Burlington, IA"],
  ["Adams County Speedway", "Corning, IA"],
  ["Atomic Speedway", "Chillicothe, OH"],
  ["Batesville Motor Speedway", "Locust Grove, AR"],
  ["Boothill Speedway", "Greenwood, LA"],
  ["Brownstown Speedway", "Brownstown, IN"],
  ["Cedar Lake Speedway", "New Richmond, WI"],
  ["Deer Creek Speedway", "Spring Valley, MN"],
  ["Eldora Speedway", "Rossburg, OH"],
  ["Fairbury Speedway", "Fairbury, IL"],
  ["Florence Speedway", "Walton, KY"],
  ["I-55 Federated Auto Parts Raceway Park", "Pevely, MO"],
  ["I-94 emr Speedway", "Fergus Falls, MN"],
  ["Knoxville Raceway", "Knoxville, IA"],
  ["Lernerville Speedway", "Sarver, PA"],
  ["Lucas Oil Speedway", "Wheatland, MO"],
  ["Maquoketa Speedway", "Maquoketa, IA"],
  ["Modoc Speedway", "Modoc, SC"],
  ["Muskingum County Speedway", "Dresden, OH"],
  ["Nodak Speedway", "Minot, ND"],
  ["Norman County Raceway", "Ada, MN"],
  ["Ogilvie Raceway", "Ogilvie, MN"],
  ["Pittsburgh Pennsylvania Motor Speedway", "Imperial, PA"],
  ["Port Royal Speedway", "Port Royal, PA"],
  ["River Cities Speedway", "Grand Forks, ND"],
  ["Sharon Speedway", "Hartford, OH"],
  ["Shelby County Speedway", "Harlan, IA"],
  ["Smoky Mountain Speedway", "Maryville, TN"],
  ["Southern Iowa Speedway", "Oskaloosa, IA"],
  ["Stateline Speedway", "Busti, NY"],
  ["The Dirt Track at Charlotte", "Concord, NC"],
  ["West Virginia Motor Speedway", "Mineral Wells, WV"],
];

const races = [
  ["2026-06-19", "WORLD OF OUTLAWS MARIBEL LATE MODEL SHOWDOWN", "141 Speedway", "WoO Late Models"],
  ["2026-06-20", "WORLD OF OUTLAWS MARIBEL LATE MODEL SHOWDOWN", "141 Speedway", "WoO Late Models"],
  ["2026-06-22", "WORLD OF OUTLAWS LAND OF LAKES CLASSIC", "Ogilvie Raceway", "WoO Late Models"],
  ["2026-06-24", "WORLD OF OUTLAWS FERGUS FALLS FRENZY", "I-94 emr Speedway", "WoO Late Models"],
  ["2026-06-26", "WORLD OF OUTLAWS GRAND FORKS LATE MODEL SHOWDOWN", "River Cities Speedway", "WoO Late Models"],
  ["2026-06-28", "WORLD OF OUTLAWS MINOT MAYHEM", "Nodak Speedway", "WoO Late Models"],
  ["2026-06-30", "WORLD OF OUTLAWS START TO FINISH SHOWDOWN", "Norman County Raceway", "WoO Late Models"],
  ["2026-07-02", "WORLD OF OUTLAWS NAPA AUTO PARTS GOPHER 50", "Deer Creek Speedway", "WoO Late Models"],
  ["2026-07-03", "WORLD OF OUTLAWS NAPA AUTO PARTS GOPHER 50", "Deer Creek Speedway", "WoO Late Models"],
  ["2026-07-04", "WORLD OF OUTLAWS NAPA AUTO PARTS GOPHER 50", "Deer Creek Speedway", "WoO Late Models"],
  ["2026-07-08", "RICK BRIGGS MEMORIAL POWERED BY DAVE WARREN POWERSPORTS", "Stateline Speedway", "WoO Late Models"],
  ["2026-07-10", "WORLD OF OUTLAWS BATTLE AT THE BORDER", "Sharon Speedway", "WoO Late Models"],
  ["2026-07-11", "WORLD OF OUTLAWS BATTLE AT THE BORDER", "Sharon Speedway", "WoO Late Models"],
  ["2026-07-24", "WORLD OF OUTLAWS PRAIRIE DIRT CLASSIC", "Fairbury Speedway", "WoO Late Models"],
  ["2026-07-25", "WORLD OF OUTLAWS PRAIRIE DIRT CLASSIC", "Fairbury Speedway", "WoO Late Models"],
  ["2026-07-30", "WORLD OF OUTLAWS USA NATIONALS", "Cedar Lake Speedway", "WoO Late Models"],
  ["2026-07-31", "WORLD OF OUTLAWS USA NATIONALS", "Cedar Lake Speedway", "WoO Late Models"],
  ["2026-08-01", "WORLD OF OUTLAWS USA NATIONALS", "Cedar Lake Speedway", "WoO Late Models"],
  ["2026-08-20", "WORLD OF OUTLAWS HAWKEYE 100 PRACTICE NIGHT", "Maquoketa Speedway", "WoO Late Models"],
  ["2026-08-21", "WORLD OF OUTLAWS HAWKEYE 100", "Maquoketa Speedway", "WoO Late Models"],
  ["2026-08-22", "WORLD OF OUTLAWS HAWKEYE 100", "Maquoketa Speedway", "WoO Late Models"],
  ["2026-08-26", "WORLD OF OUTLAWS OSKALOOSA CORN BELT SHOWDOWN", "Southern Iowa Speedway", "WoO Late Models"],
  ["2026-08-28", "WORLD OF OUTLAWS CORNING LATE MODEL SHOWDOWN", "Adams County Speedway", "WoO Late Models"],
  ["2026-08-29", "WORLD OF OUTLAWS HARLAN LATE MODEL SHOWDOWN", "Shelby County Speedway", "WoO Late Models"],
  ["2026-09-25", "WORLD OF OUTLAWS KING OF THE ARCH", "I-55 Federated Auto Parts Raceway Park", "WoO Late Models"],
  ["2026-09-26", "WORLD OF OUTLAWS KING OF THE ARCH", "I-55 Federated Auto Parts Raceway Park", "WoO Late Models"],
  ["2026-10-02", "WORLD OF OUTLAWS BAYOU CLASSIC", "Boothill Speedway", "WoO Late Models"],
  ["2026-10-03", "WORLD OF OUTLAWS BAYOU CLASSIC", "Boothill Speedway", "WoO Late Models"],
  ["2026-10-23", "WORLD OF OUTLAWS MODOC 100", "Modoc Speedway", "WoO Late Models"],
  ["2026-10-24", "WORLD OF OUTLAWS MODOC 100", "Modoc Speedway", "WoO Late Models"],
  ["2026-11-04", "WORLD OF OUTLAWS WORLD FINALS", "The Dirt Track at Charlotte", "WoO Late Models"],
  ["2026-11-05", "WORLD OF OUTLAWS WORLD FINALS", "The Dirt Track at Charlotte", "WoO Late Models"],
  ["2026-11-06", "WORLD OF OUTLAWS WORLD FINALS", "The Dirt Track at Charlotte", "WoO Late Models"],
  ["2026-11-07", "WORLD OF OUTLAWS WORLD FINALS", "The Dirt Track at Charlotte", "WoO Late Models"],

  ["2026-06-19", "Mountain Moonshine Classic | Night 1", "Smoky Mountain Speedway", "Lucas Oil LMDS"],
  ["2026-06-20", "Mountain Moonshine Classic | Night 2", "Smoky Mountain Speedway", "Lucas Oil LMDS"],
  ["2026-06-25", "20th Annual Firecracker 100 | Night 1", "Lernerville Speedway", "Lucas Oil LMDS"],
  ["2026-06-26", "20th Annual Firecracker 100 | Night 2", "Lernerville Speedway", "Lucas Oil LMDS"],
  ["2026-06-27", "20th Annual Firecracker 100 | Night 3", "Lernerville Speedway", "Lucas Oil LMDS"],
  ["2026-07-03", "Independence 50", "Atomic Speedway", "Lucas Oil LMDS"],
  ["2026-07-04", "Freedom 50", "Muskingum County Speedway", "Lucas Oil LMDS"],
  ["2026-07-09", "Lucas Oil Late Model Dirt Series", "34 Raceway", "Lucas Oil LMDS"],
  ["2026-07-10", "Salute to Forrest", "Lucas Oil Speedway", "Lucas Oil LMDS"],
  ["2026-07-11", "20th Annual CMH Diamond Nationals", "Lucas Oil Speedway", "Lucas Oil LMDS"],
  ["2026-07-14", "Lucas Oil Late Model Dirt Series", "Adams County Speedway", "Lucas Oil LMDS"],
  ["2026-07-16", "Go 50", "Shelby County Speedway", "Lucas Oil LMDS"],
  ["2026-07-17", "16th Annual Silver Dollar Nationals | Night 1", "Shelby County Speedway", "Lucas Oil LMDS"],
  ["2026-07-18", "16th Annual Silver Dollar Nationals | Night 2", "Shelby County Speedway", "Lucas Oil LMDS"],
  ["2026-08-06", "44th Annual Sunoco North/South 100 | Night 1", "Florence Speedway", "Lucas Oil LMDS"],
  ["2026-08-07", "44th Annual Sunoco North/South 100 | Night 2", "Florence Speedway", "Lucas Oil LMDS"],
  ["2026-08-08", "44th Annual Sunoco North/South 100 | Night 3", "Florence Speedway", "Lucas Oil LMDS"],
  ["2026-08-14", "34th Annual Nutrien Ag Solutions Topless 100 Presented by Big River Steel | Night 1", "Batesville Motor Speedway", "Lucas Oil LMDS"],
  ["2026-08-15", "34th Annual Nutrien Ag Solutions Topless 100 Presented by Big River Steel | Night 2", "Batesville Motor Speedway", "Lucas Oil LMDS"],
  ["2026-08-28", "The Rumble by the River | Night 1", "Port Royal Speedway", "Lucas Oil LMDS"],
  ["2026-08-29", "The Rumble by the River | Night 2", "Port Royal Speedway", "Lucas Oil LMDS"],
  ["2026-09-17", "Lucas Oil Late Model Nationals | Night 1", "Knoxville Raceway", "Lucas Oil LMDS"],
  ["2026-09-18", "Lucas Oil Late Model Nationals | Night 2", "Knoxville Raceway", "Lucas Oil LMDS"],
  ["2026-09-19", "Lucas Oil Late Model Nationals | Night 3", "Knoxville Raceway", "Lucas Oil LMDS"],
  ["2026-09-25", "5th Annual CJ Rayburn Memorial", "Brownstown Speedway", "Lucas Oil LMDS"],
  ["2026-09-26", "47th Annual Jackson 100", "Brownstown Speedway", "Lucas Oil LMDS"],
  ["2026-10-02", "38th Annual Pittsburgher | Night 1", "Pittsburgh Pennsylvania Motor Speedway", "Lucas Oil LMDS"],
  ["2026-10-03", "38th Annual Pittsburgher | Night 2", "Pittsburgh Pennsylvania Motor Speedway", "Lucas Oil LMDS"],
  ["2026-10-09", "Lucas Oil Late Model Dirt Series", "Eldora Speedway", "Lucas Oil LMDS"],
  ["2026-10-10", "Lucas Oil Late Model Dirt Series", "Eldora Speedway", "Lucas Oil LMDS"],
  ["2026-10-16", "46th Annual Dirt Track World Championship | Night 1", "West Virginia Motor Speedway", "Lucas Oil LMDS"],
  ["2026-10-17", "46th Annual Dirt Track World Championship | Night 2", "West Virginia Motor Speedway", "Lucas Oil LMDS"],
];

const trackIdByName = new Map();

function upsertTrack(name, location) {
  const existing = db.prepare("SELECT id FROM tracks WHERE name = ?").get(name);
  if (existing) {
    db.prepare("UPDATE tracks SET location = COALESCE(location, ?) WHERE id = ?").run(location, existing.id);
    trackIdByName.set(name, existing.id);
    return existing.id;
  }
  const result = db.prepare("INSERT INTO tracks (name, location, surface_type) VALUES (?, ?, 'Clay')").run(name, location);
  const id = Number(result.lastInsertRowid);
  trackIdByName.set(name, id);
  return id;
}

function upsertRace(date, name, trackName, division) {
  const trackId = trackIdByName.get(trackName) ?? upsertTrack(trackName, null);
  const existing = db
    .prepare("SELECT id FROM races WHERE race_date = ? AND name = ? AND division = ?")
    .get(date, name, division);
  if (existing) {
    db.prepare(`
      UPDATE races
      SET track_id = ?, status = 'upcoming', is_live = 0, betting_status = 'open',
          betting_locked_at = NULL, betting_lock_reason = NULL, results_source = NULL,
          results_imported_at = NULL, settled_at = NULL
      WHERE id = ?
    `).run(trackId, existing.id);
    return { updated: 1, inserted: 0 };
  }
  db.prepare(`
    INSERT INTO races (name, track_id, race_date, division, series_mode, status, is_live, betting_status)
    VALUES (?, ?, ?, ?, ?, 'upcoming', 0, 'open')
  `).run(name, trackId, date, division, division);
  return { updated: 0, inserted: 1 };
}

db.exec("BEGIN");
try {
  for (const [name, location] of tracks) upsertTrack(name, location);

  const badPrairieRows = db.prepare(`
    SELECT id FROM races
    WHERE race_date = '2026-05-30'
      AND lower(name) LIKE '%prairie dirt classic%'
      AND status = 'complete'
  `).all();
  for (const row of badPrairieRows) {
    db.prepare("DELETE FROM bets WHERE race_id = ?").run(row.id);
    db.prepare("DELETE FROM sim_bets WHERE race_id = ?").run(row.id);
    db.prepare("DELETE FROM player_bets WHERE race_id = ?").run(row.id);
    db.prepare("DELETE FROM race_entries WHERE race_id = ?").run(row.id);
    db.prepare(`
      UPDATE races
      SET name = 'WORLD OF OUTLAWS PRAIRIE DIRT CLASSIC',
          track_id = ?,
          race_date = '2026-07-25',
          division = 'WoO Late Models',
          series_mode = 'WoO Late Models',
          distance = NULL,
          status = 'upcoming',
          is_live = 0,
          betting_status = 'open',
          betting_locked_at = NULL,
          betting_lock_reason = NULL,
          results_source = NULL,
          results_imported_at = NULL,
          settled_at = NULL
      WHERE id = ?
    `).run(trackIdByName.get("Fairbury Speedway"), row.id);
  }

  let inserted = 0;
  let updated = 0;
  for (const race of races) {
    const result = upsertRace(...race);
    inserted += result.inserted;
    updated += result.updated;
  }

  db.exec("COMMIT");
  db.exec("VACUUM");
  console.log(`Updated ${dbPath}: ${inserted} inserted, ${updated} updated, ${badPrairieRows.length} bad Prairie rows repaired.`);
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
