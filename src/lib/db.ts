import "server-only";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const seedDatabasePath = join(process.cwd(), "public/data/dirtiq.seed.db");
const databaseDirectory =
  process.env.DIRTIQ_DATABASE_DIR ??
  process.env.RAILWAY_VOLUME_MOUNT_PATH ??
  (process.env.VERCEL ? "/tmp/dirtiq" : join(process.cwd(), "data"));
const databasePath = join(
  isAbsolute(databaseDirectory) ? databaseDirectory : join(/* turbopackIgnore: true */ process.cwd(), databaseDirectory),
  "dirtiq.db",
);

export function getDatabasePath() {
  return databasePath;
}

function seedVercelDatabaseIfNeeded() {
  if (existsSync(databasePath) || !existsSync(seedDatabasePath)) return;
  copyFileSync(seedDatabasePath, databasePath);
}

declare global { var sqliteDatabase: DatabaseSync | undefined; }

let migrated = false;
let seedDataMerged = false;

function mergeVercelSeedData(db: DatabaseSync) {
  if (!process.env.VERCEL || seedDataMerged || !existsSync(seedDatabasePath)) return;
  seedDataMerged = true;

  try {
    db.prepare("ATTACH DATABASE ? AS seed").run(seedDatabasePath);
    db.exec(`
      UPDATE races
      SET mrp_event_id = (
        SELECT seed.races.mrp_event_id
        FROM seed.races
        WHERE seed.races.id = races.id
      )
      WHERE EXISTS (
        SELECT 1
        FROM seed.races
        WHERE seed.races.id = races.id
          AND seed.races.mrp_event_id IS NOT NULL
      );

      UPDATE races
      SET status = (
            SELECT seed.races.status FROM seed.races WHERE seed.races.id = races.id
          ),
          is_live = COALESCE((
            SELECT seed.races.is_live FROM seed.races WHERE seed.races.id = races.id
          ), is_live),
          betting_status = COALESCE((
            SELECT seed.races.betting_status FROM seed.races WHERE seed.races.id = races.id
          ), betting_status),
          betting_locked_at = (
            SELECT seed.races.betting_locked_at FROM seed.races WHERE seed.races.id = races.id
          ),
          betting_lock_reason = (
            SELECT seed.races.betting_lock_reason FROM seed.races WHERE seed.races.id = races.id
          ),
          results_source = (
            SELECT seed.races.results_source FROM seed.races WHERE seed.races.id = races.id
          ),
          results_imported_at = (
            SELECT seed.races.results_imported_at FROM seed.races WHERE seed.races.id = races.id
          ),
          settled_at = (
            SELECT seed.races.settled_at FROM seed.races WHERE seed.races.id = races.id
          ),
          weather_notes = COALESCE((
            SELECT seed.races.weather_notes FROM seed.races WHERE seed.races.id = races.id
          ), weather_notes)
      WHERE EXISTS (
        SELECT 1
        FROM seed.races
        WHERE seed.races.id = races.id
          AND seed.races.status IN ('complete', 'cancelled')
      );

      INSERT OR REPLACE INTO market_lines
        (race_id, driver_id, market_odds, source, updated_at, rationale)
      SELECT seed.market_lines.race_id,
             seed.market_lines.driver_id,
             seed.market_lines.market_odds,
             seed.market_lines.source,
             seed.market_lines.updated_at,
             seed.market_lines.rationale
      FROM seed.market_lines
      JOIN seed.races ON seed.races.id = seed.market_lines.race_id
      WHERE seed.races.status = 'upcoming';

      INSERT OR REPLACE INTO race_entries
        (id, race_id, driver_id, car_number, starting_position, qualifying_time, heat_position,
         bmain_position,
         finishing_position, laps_led, dnf, dnf_reason, created_at, engine_builder,
         tire_compound, crew_chief, entry_series, entry_status, entry_status_updated_at,
         margin, money)
      SELECT seed.race_entries.id,
             seed.race_entries.race_id,
             seed.race_entries.driver_id,
             seed.race_entries.car_number,
             seed.race_entries.starting_position,
             seed.race_entries.qualifying_time,
             seed.race_entries.heat_position,
             seed.race_entries.bmain_position,
             seed.race_entries.finishing_position,
             seed.race_entries.laps_led,
             seed.race_entries.dnf,
             seed.race_entries.dnf_reason,
             seed.race_entries.created_at,
             seed.race_entries.engine_builder,
             seed.race_entries.tire_compound,
             seed.race_entries.crew_chief,
             seed.race_entries.entry_series,
             COALESCE(seed.race_entries.entry_status, 'expected'),
             seed.race_entries.entry_status_updated_at,
             seed.race_entries.margin,
             seed.race_entries.money
      FROM seed.race_entries
      JOIN seed.races ON seed.races.id = seed.race_entries.race_id;

      INSERT OR REPLACE INTO model_race_reviews
        (race_id, miss_reason, quick_time_mattered, starting_position_mattered,
         local_track_history_mattered, should_be_feature, confidence, notes, updated_at)
      SELECT seed.model_race_reviews.race_id,
             seed.model_race_reviews.miss_reason,
             seed.model_race_reviews.quick_time_mattered,
             seed.model_race_reviews.starting_position_mattered,
             seed.model_race_reviews.local_track_history_mattered,
             seed.model_race_reviews.should_be_feature,
             seed.model_race_reviews.confidence,
             seed.model_race_reviews.notes,
             seed.model_race_reviews.updated_at
      FROM seed.model_race_reviews;
    `);
  } catch {
    // Keep the app available even if a deployed seed is missing a newer table.
  } finally {
    try { db.exec("DETACH DATABASE seed"); } catch {}
  }
}

function migrateDriverModelMetrics(db: DatabaseSync) {
  type TableColumn = { name: string; pk: number };
  try {
    const columns = db.prepare("PRAGMA table_info(driver_model_metrics)").all() as TableColumn[];
    if (columns.length === 0) return;

    const primaryKeys = columns.filter((column) => column.pk > 0).map((column) => column.name);
    const needsCompositeKey = primaryKeys.length !== 2 || !primaryKeys.includes("driver_id") || !primaryKeys.includes("series");
    const existingColumns = new Set(columns.map((column) => column.name));

    if (needsCompositeKey) {
      db.exec(`
        ALTER TABLE driver_model_metrics RENAME TO driver_model_metrics_legacy;
        CREATE TABLE driver_model_metrics (
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
        INSERT OR REPLACE INTO driver_model_metrics
          (driver_id, series, last5_avg_finish, feature_wins, laps_led_per_win, top5s,
           top10s, laps_led, hard_charger_count, heat_wins, updated_at)
        SELECT driver_id, series, last5_avg_finish, feature_wins, laps_led_per_win, top5s,
               top10s, laps_led, hard_charger_count, heat_wins, updated_at
        FROM driver_model_metrics_legacy;
        DROP TABLE driver_model_metrics_legacy;
        CREATE INDEX IF NOT EXISTS idx_driver_model_metrics_series ON driver_model_metrics(series);
      `);
      return;
    }

    if (!existingColumns.has("avg_finish")) db.exec("ALTER TABLE driver_model_metrics ADD COLUMN avg_finish REAL");
    if (!existingColumns.has("avg_start")) db.exec("ALTER TABLE driver_model_metrics ADD COLUMN avg_start REAL");
    if (!existingColumns.has("avg_qual_position")) db.exec("ALTER TABLE driver_model_metrics ADD COLUMN avg_qual_position REAL");
    if (!existingColumns.has("quick_times")) db.exec("ALTER TABLE driver_model_metrics ADD COLUMN quick_times INTEGER NOT NULL DEFAULT 0");
    if (!existingColumns.has("qual_attempts")) db.exec("ALTER TABLE driver_model_metrics ADD COLUMN qual_attempts INTEGER NOT NULL DEFAULT 0");
  } catch {}
}

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
    CREATE INDEX IF NOT EXISTS idx_driver_model_metrics_series ON driver_model_metrics(series);
    CREATE TABLE IF NOT EXISTS driver_track_size_wins (
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      series TEXT NOT NULL DEFAULT 'WoO Late Models',
      track_size TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (driver_id, series, track_size)
    );
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
    CREATE INDEX IF NOT EXISTS idx_driver_equipment_series ON driver_equipment_profiles(series);
    CREATE INDEX IF NOT EXISTS idx_driver_equipment_chassis ON driver_equipment_profiles(chassis_family);
    CREATE INDEX IF NOT EXISTS idx_driver_equipment_engine ON driver_equipment_profiles(engine_family);
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
    CREATE TABLE IF NOT EXISTS featured_board_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
      race_key TEXT NOT NULL,
      race_name TEXT NOT NULL,
      series TEXT NOT NULL,
      track TEXT NOT NULL,
      market TEXT NOT NULL,
      selection TEXT NOT NULL,
      description TEXT NOT NULL,
      american_odds TEXT NOT NULL,
      stake REAL NOT NULL,
      payout_if_win REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','void')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_featured_board_bets_account ON featured_board_bets(account_id);
    CREATE INDEX IF NOT EXISTS idx_featured_board_bets_race ON featured_board_bets(race_key);
  `);
  migrateDriverModelMetrics(db);
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
  try { db.exec(`ALTER TABLE races ADD COLUMN betting_status TEXT NOT NULL DEFAULT 'open'`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN betting_locked_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN betting_lock_reason TEXT`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN results_source TEXT`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN results_imported_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE races ADD COLUMN settled_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN qualifying_time REAL`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN heat_position INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN bmain_position INTEGER`); } catch {}
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
  try { db.exec(`ALTER TABLE races ADD COLUMN series_mode TEXT`); } catch {}
  // Part 1 data inputs — car & equipment
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN engine_builder TEXT`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN tire_compound TEXT`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN crew_chief TEXT`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN entry_series TEXT`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN entry_status TEXT NOT NULL DEFAULT 'expected'`); } catch {}
  try { db.exec(`ALTER TABLE race_entries ADD COLUMN entry_status_updated_at TEXT`); } catch {}
  // Part 1 data inputs — rolling laps led momentum
  try { db.exec(`ALTER TABLE driver_season_stats ADD COLUMN last5_laps_led_pct REAL`); } catch {}
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
    CREATE INDEX IF NOT EXISTS idx_driver_model_metrics_series ON driver_model_metrics(series);
    CREATE TABLE IF NOT EXISTS driver_track_size_wins (
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      series TEXT NOT NULL DEFAULT 'WoO Late Models',
      track_size TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (driver_id, series, track_size)
    );
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
    CREATE INDEX IF NOT EXISTS idx_driver_equipment_series ON driver_equipment_profiles(series);
    CREATE INDEX IF NOT EXISTS idx_driver_equipment_chassis ON driver_equipment_profiles(chassis_family);
    CREATE INDEX IF NOT EXISTS idx_driver_equipment_engine ON driver_equipment_profiles(engine_family);
  `);
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
    CREATE TABLE IF NOT EXISTS market_lines (
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      market_odds TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      rationale TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (race_id, driver_id)
    );
    CREATE INDEX IF NOT EXISTS idx_market_lines_race ON market_lines(race_id);
    CREATE TABLE IF NOT EXISTS line_caveats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
      caveat_type TEXT NOT NULL DEFAULT 'note',
      severity TEXT NOT NULL DEFAULT 'watch' CHECK (severity IN ('watch','caution','hold','scratch')),
      probability_multiplier REAL NOT NULL DEFAULT 1.0,
      note TEXT NOT NULL,
      source_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_line_caveats_race ON line_caveats(race_id, active);
    CREATE INDEX IF NOT EXISTS idx_line_caveats_driver ON line_caveats(driver_id, active);
    CREATE TABLE IF NOT EXISTS track_driver_trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
      trend_type TEXT NOT NULL DEFAULT 'track_history',
      label TEXT NOT NULL,
      score_delta REAL NOT NULL DEFAULT 0,
      note TEXT,
      source_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_track_driver_trends_track ON track_driver_trends(track_id, active);
    CREATE INDEX IF NOT EXISTS idx_track_driver_trends_driver ON track_driver_trends(driver_id, active);
    CREATE TABLE IF NOT EXISTS underwriting_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER REFERENCES races(id) ON DELETE CASCADE,
      track_id INTEGER REFERENCES tracks(id) ON DELETE CASCADE,
      driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
      note_type TEXT NOT NULL DEFAULT 'underwriting',
      title TEXT NOT NULL,
      note TEXT NOT NULL,
      source_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_underwriting_notes_race ON underwriting_notes(race_id, active);
    CREATE INDEX IF NOT EXISTS idx_underwriting_notes_track ON underwriting_notes(track_id, active);
    CREATE INDEX IF NOT EXISTS idx_underwriting_notes_driver ON underwriting_notes(driver_id, active);
    CREATE TABLE IF NOT EXISTS race_context_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
      context_type TEXT NOT NULL DEFAULT 'driving_style',
      label TEXT NOT NULL,
      score_delta REAL NOT NULL DEFAULT 0,
      note TEXT,
      source_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_race_context_adjustments_race ON race_context_adjustments(race_id, active);
    CREATE INDEX IF NOT EXISTS idx_race_context_adjustments_driver ON race_context_adjustments(driver_id, active);
    CREATE TABLE IF NOT EXISTS driver_series_commitments (
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      series TEXT NOT NULL,
      commitment_type TEXT NOT NULL DEFAULT 'full_time',
      source_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (driver_id, series)
    );
    CREATE INDEX IF NOT EXISTS idx_driver_series_commitments_series ON driver_series_commitments(series, active);
    CREATE TABLE IF NOT EXISTS model_race_reviews (
      race_id INTEGER PRIMARY KEY REFERENCES races(id) ON DELETE CASCADE,
      miss_reason TEXT NOT NULL DEFAULT 'needs_feature_review',
      quick_time_mattered INTEGER NOT NULL DEFAULT 0,
      starting_position_mattered INTEGER NOT NULL DEFAULT 0,
      local_track_history_mattered INTEGER NOT NULL DEFAULT 0,
      should_be_feature INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.5,
      notes TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  try { db.exec(`ALTER TABLE market_lines ADD COLUMN rationale TEXT`); } catch {}
}

export function getDb() {
  if (!globalThis.sqliteDatabase) {
    mkdirSync(dirname(databasePath), { recursive: true });
    seedVercelDatabaseIfNeeded();
    globalThis.sqliteDatabase = new DatabaseSync(databasePath);
  }
  if (!migrated) {
    migrate(globalThis.sqliteDatabase);
    mergeVercelSeedData(globalThis.sqliteDatabase);
    migrated = true;
  }
  return globalThis.sqliteDatabase;
}
