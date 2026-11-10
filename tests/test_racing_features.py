"""Feature-builder tests on a synthetic SQLite database (no dependency on data/dirtiq.db)."""
from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from dirtiq_model.racing import data as racing_data
from dirtiq_model.racing import features as F

SCHEMA = """
CREATE TABLE drivers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, division TEXT DEFAULT 'Open');
CREATE TABLE tracks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, track_length REAL);
CREATE TABLE track_similars (id INTEGER PRIMARY KEY, track_id INTEGER, similar_track_id INTEGER, similarity_weight REAL);
CREATE TABLE races (id INTEGER PRIMARY KEY, name TEXT NOT NULL, track_id INTEGER NOT NULL, race_date TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT 'Open', distance INTEGER, status TEXT NOT NULL DEFAULT 'upcoming', series_mode TEXT);
CREATE TABLE race_entries (id INTEGER PRIMARY KEY, race_id INTEGER NOT NULL, driver_id INTEGER NOT NULL,
  starting_position INTEGER, qualifying_time REAL, heat_position INTEGER, finishing_position INTEGER,
  dnf INTEGER NOT NULL DEFAULT 0, entry_status TEXT NOT NULL DEFAULT 'expected', entry_series TEXT, bmain_position INTEGER,
  UNIQUE(race_id, driver_id));
CREATE TABLE market_lines (race_id INTEGER, driver_id INTEGER, market_odds TEXT, source TEXT, updated_at TEXT, PRIMARY KEY (race_id, driver_id));
"""


def build_synthetic_db(path: Path, n_races: int = 40, n_drivers: int = 12, seed: int = 3,
                       upcoming: int = 2, start: date = date(2023, 4, 1), gap: tuple = (2, 6)) -> sqlite3.Connection:
    """Drivers have latent strength; finishing order is a noisy ranking of strength.

    Races alternate between two tracks, with a two-night event every fifth race
    (same track, consecutive days) and a same-day double header at race 10.
    """
    rng = np.random.default_rng(seed)
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    strength = rng.normal(size=n_drivers)
    for i in range(n_drivers):
        con.execute("INSERT INTO drivers (id, name) VALUES (?, ?)", (i + 1, f"Driver {i + 1}"))
    con.execute("INSERT INTO tracks VALUES (1, 'Eldora Speedway', 0.5)")
    con.execute("INSERT INTO tracks VALUES (2, 'Farmer City', 0.25)")
    con.execute("INSERT INTO tracks VALUES (3, 'Fairbury', 0.25)")
    con.execute("INSERT INTO track_similars VALUES (1, 2, 3, 0.8)")
    day = start
    rid = 0
    divisions = ["WoO Late Models", "Lucas Oil LMDS"]
    for k in range(n_races + upcoming):
        rid += 1
        if k % 5 == 4:
            day = day + timedelta(days=1)       # second night of a multi-night event, same track
            track = prev_track
        elif k == 10:
            track = 3                           # same-day double header
        else:
            day = day + timedelta(days=int(rng.integers(gap[0], gap[1])))
            track = 1 + (k % 3)
        prev_track = track
        status = "complete" if k < n_races else "upcoming"
        name = "Dream at Eldora" if track == 1 and k % 7 == 0 else f"Race {rid}"
        con.execute("INSERT INTO races (id, name, track_id, race_date, division, distance, status, series_mode) VALUES (?,?,?,?,?,?,?,?)",
                    (rid, name, track, day.isoformat(), divisions[k % 2], 50, status, divisions[k % 2]))
        field = rng.choice(n_drivers, size=rng.integers(8, n_drivers + 1), replace=False)
        noise = rng.normal(scale=1.2, size=len(field))
        order = field[np.argsort(-(strength[field] + noise))]
        for pos, d in enumerate(order, start=1):
            qt = 15.0 + rng.normal(scale=0.3) - 0.1 * strength[d]
            fp = pos if status == "complete" else None
            dnf = 1 if (status == "complete" and pos == len(order) and rng.random() < 0.5) else 0
            con.execute("INSERT INTO race_entries (race_id, driver_id, starting_position, qualifying_time, heat_position, finishing_position, dnf) VALUES (?,?,?,?,?,?,?)",
                        (rid, int(d) + 1, int(rng.integers(1, len(order) + 1)), qt, int(rng.integers(1, 7)), fp, dnf))
    con.commit()
    return con


class FeatureBuilderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "synthetic.db"
        self.con = build_synthetic_db(self.path)
        self.con.row_factory = sqlite3.Row
        self.data = racing_data.load_dataset(self.con)
        self.feat = F.build_features(self.data)

    def tearDown(self):
        self.con.close()
        self.tmp.cleanup()

    def test_shape_and_columns(self):
        for name in F.FEATURE_NAMES:
            self.assertIn(name, self.feat.columns)
        self.assertEqual(len(F.FEATURE_NAMES), len(set(F.FEATURE_NAMES)))
        self.assertTrue(set(F.EARLY_FEATURES) < set(F.RACE_NIGHT_FEATURES))
        complete = self.feat[self.feat["status"] == "complete"]
        self.assertEqual(int(complete.groupby("race_id")["won"].sum().max()), 1)
        # upcoming races get rows too
        self.assertGreater((self.feat["status"] == "upcoming").sum(), 0)

    def test_no_leak_from_same_or_later_dates(self):
        races = self.data.races.sort_values("race_date")
        target = races.iloc[len(races) // 2]
        D = target["race_date"]
        before = self.feat[self.feat["race_id"] == target["race_id"]].set_index("driver_id")[F.FEATURE_NAMES]
        # alter every race on date >= D (other than the target itself): shuffle finishing positions,
        # flip DNFs and move winners around; also mutate a same-day race if one exists
        later_ids = races.loc[races["race_date"] >= D, "race_id"].tolist()
        later_ids = [int(r) for r in later_ids if int(r) != int(target["race_id"])]
        self.assertGreater(len(later_ids), 3)
        for rid in later_ids:
            rows = self.con.execute("SELECT id, finishing_position FROM race_entries WHERE race_id=? AND finishing_position IS NOT NULL", (rid,)).fetchall()
            if not rows:
                continue
            ids = [r["id"] for r in rows]
            positions = [r["finishing_position"] for r in rows]
            positions = positions[1:] + positions[:1]
            for eid, pos in zip(ids, positions):
                self.con.execute("UPDATE race_entries SET finishing_position=?, dnf=? WHERE id=?", (pos, 1 if pos == len(ids) else 0, eid))
        self.con.commit()
        altered = F.build_features(racing_data.load_dataset(self.con))
        after = altered[altered["race_id"] == target["race_id"]].set_index("driver_id")[F.FEATURE_NAMES]
        pd.testing.assert_frame_equal(before.sort_index(), after.sort_index())

    def test_earlier_race_does_change_features(self):
        races = self.data.races.sort_values("race_date")
        target = races.iloc[-3]
        before = self.feat[self.feat["race_id"] == target["race_id"]].set_index("driver_id")["elo"]
        earlier = int(races.iloc[0]["race_id"])
        rows = self.con.execute("SELECT id, finishing_position FROM race_entries WHERE race_id=?", (earlier,)).fetchall()
        n = len(rows)
        for r in rows:
            self.con.execute("UPDATE race_entries SET finishing_position=? WHERE id=?", (n + 1 - r["finishing_position"], r["id"]))
        self.con.commit()
        altered = F.build_features(racing_data.load_dataset(self.con))
        after = altered[altered["race_id"] == target["race_id"]].set_index("driver_id")["elo"]
        self.assertFalse(np.allclose(before.sort_index().to_numpy(), after.sort_index().to_numpy()))

    def test_multi_night_and_race_night_inputs(self):
        races = self.data.races.sort_values(["race_date", "race_id"]).reset_index(drop=True)
        # the synthetic builder makes every 5th race the second night at the same track
        second_nights = [int(r["race_id"]) for i, r in races.iterrows() if i % 5 == 4 and r["status"] == "complete"]
        rows = self.feat[self.feat["race_id"].isin(second_nights)]
        self.assertGreater(rows["prev_same_track_3d"].sum(), 0)
        self.assertTrue((rows.loc[rows["prev_same_track_3d"] == 1, "prev_same_track_finish_3d"].notna()).all())
        first = self.feat[self.feat["race_id"] == int(races.iloc[0]["race_id"])]
        self.assertTrue((first["elo"] == F.ELO_START).all())
        self.assertTrue(first["last10_avg_finish"].isna().all())
        self.assertTrue(((self.feat["start_pos_norm"] >= 0) & (self.feat["start_pos_norm"] <= 1)).all())
        self.assertAlmostEqual(float(self.feat.groupby("race_id")["qt_rank_norm"].min().max()), 0.0)
        self.assertTrue((self.feat["field_size"] == self.feat.groupby("race_id")["driver_id"].transform("size")).all())

    def test_elo_rewards_strength(self):
        last = self.feat[self.feat["status"] == "upcoming"]
        # drivers with better career average finish should carry higher Elo on balance
        corr = np.corrcoef(last["career_avg_finish"], last["elo"])[0, 1]
        self.assertLess(corr, -0.5)

    def test_scratched_entries_are_not_scored(self):
        upcoming = int(self.data.races[self.data.races["status"] == "upcoming"].iloc[0]["race_id"])
        entry = self.con.execute("SELECT driver_id FROM race_entries WHERE race_id=? LIMIT 1", (upcoming,)).fetchone()
        self.con.execute("UPDATE race_entries SET entry_status='scratched' WHERE race_id=? AND driver_id=?", (upcoming, entry["driver_id"]))
        self.con.commit()
        feat = F.build_features(racing_data.load_dataset(self.con))
        rows = feat[feat["race_id"] == upcoming]
        self.assertNotIn(entry["driver_id"], rows["driver_id"].tolist())


if __name__ == "__main__":
    unittest.main()
