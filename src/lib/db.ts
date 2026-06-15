import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databaseDirectory =
  process.env.DIRTIQ_DATABASE_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? join(process.cwd(), "data");
const databasePath = join(
  isAbsolute(databaseDirectory) ? databaseDirectory : join(/* turbopackIgnore: true */ process.cwd(), databaseDirectory),
  "dirtiq.db",
);

export function getDatabasePath() {
  return databasePath;
}

declare global { var sqliteDatabase: DatabaseSync | undefined; }

let migrated = false;

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      car_number TEXT,
      hometown TEXT,
      division TEXT NOT NULL DEFAULT 'Open',
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT,
      surface_type TEXT NOT NULL DEFAULT 'Clay',
      track_length REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS races (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
      race_date TEXT NOT NULL,
      division TEXT NOT NULL DEFAULT 'Open',
      distance INTEGER,
      track_condition TEXT NOT NULL DEFAULT 'Tacky' CHECK (track_condition IN ('Dry Slick','Tacky','Heavy','Muddy','Cushion','Groomed')),
      weather_notes TEXT,
      status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','complete','cancelled')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_races_track ON races(track_id);
    CREATE INDEX IF NOT EXISTS idx_races_date ON races(race_date);
    CREATE TABLE IF NOT EXISTS race_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
      car_number TEXT,
      starting_position INTEGER,
      finishing_position INTEGER,
      laps_led INTEGER NOT NULL DEFAULT 0,
      dnf INTEGER NOT NULL DEFAULT 0,
      dnf_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(race_id, driver_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entries_race ON race_entries(race_id);
    CREATE INDEX IF NOT EXISTS idx_entries_driver ON race_entries(driver_id);
  `);
}

export function getDb() {
  if (!globalThis.sqliteDatabase) {
    mkdirSync(dirname(databasePath), { recursive: true });
    globalThis.sqliteDatabase = new DatabaseSync(databasePath);
  }
  if (!migrated) {
    migrate(globalThis.sqliteDatabase);
    migrated = true;
  }
  return globalThis.sqliteDatabase;
}
