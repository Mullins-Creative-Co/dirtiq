import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dirtiq_model.ledger_core import Forecast, Ledger
from dirtiq_model.odds.snapshot import apply_to_ledger, consolidate
from dirtiq_model.odds.teams import TeamMapper


def event(home, away, start, books):
    return {
        "id": "abc", "home_team": home, "away_team": away, "commence_time": start,
        "bookmakers": [
            {"key": key, "last_update": start, "markets": [
                {"key": "spreads", "outcomes": [{"name": home, "point": sp, "price": hp}, {"name": away, "point": -sp, "price": ap}]},
                {"key": "h2h", "outcomes": [{"name": home, "price": hml}, {"name": away, "price": aml}]},
            ]} for key, sp, hp, ap, hml, aml in books
        ],
    }


class TeamMapperTests(unittest.TestCase):
    def test_explicit_and_fallback(self):
        m = TeamMapper("nfl")
        self.assertEqual(m.resolve("Kansas City Chiefs"), "KC")
        self.assertEqual(m.resolve("Los Angeles Rams"), "LA")
        self.assertIsNone(m.resolve("Nowhere Nobodies"))
        self.assertEqual(m.unresolved, {"Nowhere Nobodies": 1})
        n = TeamMapper("nhl", known=["TOR", "BOS", "VGK"])
        self.assertEqual(n.resolve("Toronto Maple Leafs"), "TOR")
        self.assertEqual(n.resolve("Boston Bruins"), "BOS")


class ConsolidateTests(unittest.TestCase):
    def test_median_consensus(self):
        ev = event("Kansas City Chiefs", "Denver Broncos", "2026-11-15T18:00:00Z",
                   [("dk", -3.5, -110, -110, -180, 155), ("fd", -3.0, -105, -115, -175, 150), ("mgm", -3.5, -115, -105, -185, 160)])
        snap = consolidate("nfl", [ev], TeamMapper("nfl"), observed_at="2026-11-14T12:00:00Z")
        self.assertEqual(len(snap), 1)
        s = snap[0]
        self.assertEqual((s["home"], s["away"]), ("KC", "DEN"))
        self.assertEqual(s["homeSpread"], -3.5)
        self.assertEqual(s["homeSpreadPrice"], -110)
        self.assertEqual(s["homeMl"], -180)
        self.assertEqual(s["awayMl"], 155)
        self.assertEqual(s["books"], 3)

    def test_unresolved_event_is_skipped(self):
        ev = event("Mystery Team", "Denver Broncos", "2026-11-15T18:00:00Z", [("dk", -3.5, -110, -110, -180, 155)])
        self.assertEqual(consolidate("nfl", [ev], TeamMapper("nfl")), [])


class ApplyTests(unittest.TestCase):
    def test_fill_and_close(self):
        tmp = tempfile.TemporaryDirectory()
        ledger = Ledger(Path(tmp.name) / "ledger.json")
        start = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat().replace("+00:00", "Z")
        base = dict(sport="nba", event_id="nba:1", event_label="MIL at NY", event_start=start, model_id="m", model_version="1",
                    forecast_at="2026-11-10T00:00:00Z", meta={"home": "NY", "away": "MIL"})
        ledger.record([
            Forecast(market="spread", selection="NY", selection_label="NY", prob=0.6, **base),
            Forecast(market="spread", selection="MIL", selection_label="MIL", prob=0.4, **base),
            Forecast(market="moneyline", selection="NY", selection_label="NY", prob=0.7, **base),
        ])
        snap = [{"home": "NY", "away": "MIL", "startsAt": start, "observedAt": "2026-11-10T01:00:00Z",
                 "homeSpread": -6.5, "homeSpreadPrice": -110, "awaySpreadPrice": -110, "homeMl": -260, "awayMl": 210}]
        result = apply_to_ledger(ledger, "nba", snap)
        self.assertEqual(result["linesFilled"], 3)
        self.assertEqual(result["closesUpdated"], 3)
        rows = {(r["market"], r["selection"]): r for r in ledger.rows(sport="nba")}
        self.assertEqual(rows[("spread", "NY")]["line"], -6.5)
        self.assertEqual(rows[("spread", "MIL")]["line"], 6.5)
        self.assertEqual(rows[("moneyline", "NY")]["price"], -260)
        self.assertEqual(rows[("spread", "NY")]["book"], "odds-api consensus")
        # a later snapshot moves the close but never the recorded line
        snap[0]["homeSpread"] = -7.5
        apply_to_ledger(ledger, "nba", snap)
        rows = {(r["market"], r["selection"]): r for r in ledger.rows(sport="nba")}
        self.assertEqual(rows[("spread", "NY")]["line"], -6.5)
        self.assertEqual(rows[("spread", "NY")]["close_line"], -7.5)
        ledger.close()
        tmp.cleanup()

    def test_started_events_are_left_alone(self):
        tmp = tempfile.TemporaryDirectory()
        ledger = Ledger(Path(tmp.name) / "ledger.json")
        start = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        ledger.record([Forecast(sport="nfl", event_id="nfl:1", event_label="DEN at KC", event_start=start, market="spread",
                                selection="KC", selection_label="KC", model_id="m", model_version="1", prob=0.5,
                                line=-3.0, price=-110, meta={"home": "KC", "away": "DEN"})])
        snap = [{"home": "KC", "away": "DEN", "startsAt": start, "observedAt": "x", "homeSpread": -4.0,
                 "homeSpreadPrice": -110, "awaySpreadPrice": -110, "homeMl": -200, "awayMl": 170}]
        result = apply_to_ledger(ledger, "nfl", snap)
        self.assertEqual(result["closesUpdated"], 0)
        self.assertIsNone(ledger.rows(sport="nfl")[0]["close_line"])
        ledger.close()
        tmp.cleanup()


class HockeyAndBaseballNameTests(unittest.TestCase):
    def test_nhl_and_mlb_names_resolve_to_report_codes(self):
        from dirtiq_model.odds.teams import TeamMapper
        nhl = TeamMapper("nhl", ["TBL", "NJD", "MTL", "VGK"])
        self.assertEqual([nhl.resolve(n) for n in ("Tampa Bay Lightning", "New Jersey Devils", "Montréal Canadiens", "Vegas Golden Knights")], ["TBL", "NJD", "MTL", "VGK"])
        self.assertEqual(nhl.unresolved, {})
        mlb = TeamMapper("mlb", [])
        self.assertEqual([mlb.resolve(n) for n in ("Arizona Diamondbacks", "Chicago White Sox", "Athletics")], ["AZ", "CWS", "ATH"])


class GamesSoonTests(unittest.TestCase):
    def test_counts_only_games_inside_the_window(self):
        import tempfile
        from datetime import datetime, timedelta, timezone
        from pathlib import Path
        from unittest import mock
        from dirtiq_model.odds import snapshot as snap
        now = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)
        rows = [{"startsAt": (now + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")} for h in (-2, 5, 29, 40)]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "public" / "sports").mkdir(parents=True)
            (root / "public" / "sports" / "nba.json").write_text(json.dumps({"upcoming": rows}))
            with mock.patch.object(snap, "ROOT", root):
                self.assertEqual(snap.games_within("nba", now=now), 2)
                self.assertEqual(snap.games_within("nhl", now=now), 0)


if __name__ == "__main__":
    unittest.main()
