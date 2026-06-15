import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = join(process.cwd(), "data", "dirtiq.db");

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
      mrp_driver_id INTEGER,
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
    CREATE TABLE IF NOT EXISTS track_similars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      similar_track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      similarity_weight REAL NOT NULL DEFAULT 0.7,
      notes TEXT,
      UNIQUE(track_id, similar_track_id)
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
      mrp_event_id INTEGER,
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
      qualifying_time REAL,
      heat_position INTEGER,
      finishing_position INTEGER,
      laps_led INTEGER NOT NULL DEFAULT 0,
      dnf INTEGER NOT NULL DEFAULT 0,
      dnf_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(race_id, driver_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entries_race ON race_entries(race_id);
    CREATE INDEX IF NOT EXISTS idx_entries_driver ON race_entries(driver_id);
    CREATE TABLE IF NOT EXISTS driver_season_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      season INTEGER NOT NULL,
      series TEXT NOT NULL DEFAULT 'WoO Late Models',
      starts INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      quick_times INTEGER NOT NULL DEFAULT 0,
      heat_wins INTEGER NOT NULL DEFAULT 0,
      top5 INTEGER NOT NULL DEFAULT 0,
      top10 INTEGER NOT NULL DEFAULT 0,
      laps_led INTEGER NOT NULL DEFAULT 0,
      dnfs INTEGER NOT NULL DEFAULT 0,
      avg_finish REAL,
      last5_avg_finish REAL,
      points_pos INTEGER,
      UNIQUE(driver_id, season, series)
    );
    CREATE INDEX IF NOT EXISTS idx_season_stats_driver ON driver_season_stats(driver_id);
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
      bettor_name TEXT,
      amount REAL NOT NULL,
      american_odds TEXT NOT NULL,
      payout_if_win REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','void')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bets_race ON bets(race_id);
    CREATE INDEX IF NOT EXISTS idx_bets_driver ON bets(driver_id);
    CREATE TABLE IF NOT EXISTS race_risk_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL UNIQUE REFERENCES races(id) ON DELETE CASCADE,
      max_payout_per_driver REAL,
      max_bet_size REAL,
      alert_handle_pct REAL NOT NULL DEFAULT 0.30
    );
    CREATE TABLE IF NOT EXISTS bettors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      persona TEXT NOT NULL DEFAULT 'square',
      bankroll REAL NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS sim_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      bettor_id INTEGER NOT NULL REFERENCES bettors(id),
      driver_id INTEGER NOT NULL REFERENCES drivers(id),
      amount REAL NOT NULL,
      american_odds TEXT NOT NULL,
      payout_if_win REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','void','blocked')),
      blocked_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sim_bets_race ON sim_bets(race_id);
    CREATE INDEX IF NOT EXISTS idx_sim_bets_bettor ON sim_bets(bettor_id);
    CREATE TABLE IF NOT EXISTS player_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      balance REAL NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS player_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      prop_type TEXT NOT NULL DEFAULT 'win',
      description TEXT NOT NULL,
      driver_id INTEGER REFERENCES drivers(id),
      driver_b_id INTEGER REFERENCES drivers(id),
      american_odds TEXT NOT NULL,
      stake REAL NOT NULL,
      payout_if_win REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','void')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_player_bets_account ON player_bets(account_id);
    CREATE INDEX IF NOT EXISTS idx_player_bets_race ON player_bets(race_id);
  `);
  db.exec(`
    INSERT OR IGNORE INTO bettors (id, name, persona, bankroll) VALUES
      (1, 'The Square',      'square',       500),
      (2, 'Chalk Charlie',   'chalk_chaser', 1000),
      (3, 'The Contrarian',  'contrarian',   300),
      (4, 'The Sharp',       'sharp',        1500),
      (5, 'Tommy Two-Dollar','small_stakes', 200),
      (6, 'Big Money Bob',   'high_roller',  2000)
  `);
  try { db.exec(`ALTER TABLE drivers ADD COLUMN mrp_driver_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN mrp_event_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN qualifying_time REAL`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN heat_position INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN is_live INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE tracks ADD COLUMN track_family TEXT`); } catch {}
  // Part 1 data inputs — track characterization
  try { db.exec(`ALTER TABLE tracks ADD COLUMN banking_angle REAL`); } catch {}
  try { db.exec(`ALTER TABLE tracks ADD COLUMN clay_type TEXT`); } catch {}
  try { db.exec(`ALTER TABLE tracks ADD COLUMN avg_caution_rate REAL`); } catch {}
  // Part 1 data inputs — environmental & prep
  try { db.exec(`ALTER TABLE races ADD COLUMN time_of_day TEXT NOT NULL DEFAULT 'night'`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN temperature_f REAL`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN humidity_pct REAL`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN precip_48h_in REAL`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN water_truck_runs INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN groove_stage TEXT`); } catch {}
  // Part 1 data inputs — car & equipment
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN engine_builder TEXT`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN tire_compound TEXT`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN crew_chief TEXT`); } catch {}
  // Part 1 data inputs — rolling laps led momentum
  try { db.exec(`ALTER TABLE driver_season_stats ADD COLUMN last5_laps_led_pct REAL`); } catch {}
  // Post-race scorecard fields
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN margin TEXT`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN money INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN purse_to_win INTEGER`); } catch {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS driver_specialties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      track_family TEXT,
      track_id INTEGER REFERENCES tracks(id) ON DELETE CASCADE,
      bonus_score REAL NOT NULL DEFAULT 0.10,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_specialties_driver ON driver_specialties(driver_id);
    CREATE TABLE IF NOT EXISTS race_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
      predicted_rank INTEGER NOT NULL,
      implied_probability REAL NOT NULL,
      american_odds TEXT NOT NULL,
      raw_score REAL NOT NULL,
      elo_rating REAL NOT NULL,
      track_win_rate REAL,
      track_starts INTEGER,
      similar_track_win_rate REAL,
      season_win_rate REAL,
      last5_avg_finish REAL,
      streak INTEGER,
      tonight_heat_pos INTEGER,
      tonight_qt_rank INTEGER,
      starting_position INTEGER,
      starting_pos_win_rate REAL,
      feature_plus_minus REAL,
      condition_win_rate REAL,
      specialty_bonus REAL,
      locked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(race_id, driver_id)
    );
    CREATE INDEX IF NOT EXISTS idx_predictions_race ON race_predictions(race_id);
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
