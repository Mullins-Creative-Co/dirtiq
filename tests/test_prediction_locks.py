import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from lock_prediction_snapshots import canonical, lock_available


class PredictionLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.cache = self.base / "cache"
        self.output = self.base / "locks"
        self.cache.mkdir()
        self.db = self.base / "dirtiq.db"
        con = sqlite3.connect(self.db)
        con.executescript("""
          CREATE TABLE races(id INTEGER PRIMARY KEY,name TEXT,race_date TEXT,status TEXT,track_id INTEGER);
          CREATE TABLE race_entries(race_id INTEGER,driver_id INTEGER,entry_status TEXT,starting_position INTEGER,heat_position INTEGER,qualifying_time REAL,finishing_position INTEGER);
          INSERT INTO races VALUES(1,'Future feature','2026-09-20','upcoming',4);
          INSERT INTO race_entries VALUES(1,10,'confirmed',2,1,14.2,NULL);
          INSERT INTO race_entries VALUES(1,11,'confirmed',1,2,14.3,NULL);
        """)
        con.close()
        self.cache_file = self.cache / "race_1.json"
        self.cache_file.write_text(json.dumps({
            "raceId": 1, "modelStage": "race-night", "modelSeries": "Crown Jewel / Combined",
            "modelSlug": "crown_jewel_combined", "raceNightCoverage": {"start": 1},
            "predictions": [
                {"driverId": 10, "driverName": "One", "probability": .6, "rawProbability": .7, "trainedOn": "through 2026-09-15"},
                {"driverId": 11, "driverName": "Two", "probability": .4, "rawProbability": .3, "trainedOn": "through 2026-09-15"},
            ]
        }))

    def tearDown(self):
        self.tmp.cleanup()

    def test_lock_is_hashed_and_never_overwritten(self):
        first = lock_available(self.db, self.cache, self.output, "2026-09-15")
        self.assertEqual(len(first["created"]), 1)
        path = self.output / "race_1_race-night.json"
        original = path.read_bytes()
        document = json.loads(original)
        claimed = document.pop("snapshotSha256")
        self.assertEqual(claimed, hashlib.sha256(canonical(document)).hexdigest())
        self.cache_file.write_text(self.cache_file.read_text().replace('"probability": 0.6', '"probability": 0.1'))
        lock_available(self.db, self.cache, self.output, "2026-09-15")
        self.assertEqual(path.read_bytes(), original)

    def test_results_block_a_late_lock(self):
        con = sqlite3.connect(self.db)
        con.execute("UPDATE race_entries SET finishing_position=1 WHERE race_id=1 AND driver_id=10")
        con.commit(); con.close()
        result = lock_available(self.db, self.cache, self.output, "2026-09-15")
        self.assertFalse(result["created"])
        self.assertEqual(result["skipped"][0]["reason"], "results already present")


if __name__ == "__main__":
    unittest.main()
