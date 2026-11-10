"""The forecast ledger: one row per forecast, per selection, per market.

This is the system of record for "is the model any good". Every engine writes
here at forecast time with whatever market was visible, and ``settle`` fills in
the outcome later. ``summarize`` turns the table into the health report the UI
reads from ``public/data/model-health.json``.

The ledger is persisted as JSON at ``public/data/forecast-ledger.json`` (small,
diff-friendly, deployed with the site, committable from CI) and worked on in an
in-memory SQLite table. Pass a ``.db`` path to use a plain SQLite file instead.
Override the default location with ``DIRTIQ_LEDGER_PATH``. Rows are append-only
except for settlement columns.
"""
from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from . import scoring

ROOT = Path(__file__).resolve().parent.parent
LEDGER_PATH = Path(os.environ.get("DIRTIQ_LEDGER_PATH") or ROOT / "public" / "data" / "forecast-ledger.json")
DEFAULT_DB = LEDGER_PATH  # backwards-compatible name
HEALTH_PATH = ROOT / "public" / "data" / "model-health.json"
COLUMNS = (
    "id", "sport", "event_id", "event_label", "event_start", "market", "selection", "selection_label",
    "model_id", "model_version", "forecast_at", "prob", "value", "value_sd", "line", "price", "book",
    "line_observed_at", "close_line", "close_price", "outcome", "result_value", "settled_at", "meta",
)

SPORTS = ("racing", "nfl", "nba", "ncaaf", "ncaab", "mlb", "nhl")
MARKETS = ("win", "top3", "top5", "h2h", "spread", "moneyline", "total")
OUTCOMES = ("win", "loss", "push", "void")

SCHEMA = """
CREATE TABLE IF NOT EXISTS forecast_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sport TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_label TEXT NOT NULL,
  event_start TEXT,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  selection_label TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  forecast_at TEXT NOT NULL,
  prob REAL NOT NULL,
  value REAL,
  value_sd REAL,
  line REAL,
  price INTEGER,
  book TEXT,
  line_observed_at TEXT,
  close_line REAL,
  close_price INTEGER,
  outcome TEXT,
  result_value REAL,
  settled_at TEXT,
  meta TEXT,
  UNIQUE(sport, event_id, market, selection, model_id, forecast_at)
);
CREATE INDEX IF NOT EXISTS idx_forecast_ledger_sport ON forecast_ledger(sport, model_id);
CREATE INDEX IF NOT EXISTS idx_forecast_ledger_event ON forecast_ledger(sport, event_id);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass
class Forecast:
    sport: str
    event_id: str
    event_label: str
    market: str
    selection: str
    selection_label: str
    model_id: str
    model_version: str
    prob: float
    forecast_at: str = field(default_factory=now_iso)
    event_start: Optional[str] = None
    value: Optional[float] = None
    value_sd: Optional[float] = None
    line: Optional[float] = None
    price: Optional[int] = None
    book: Optional[str] = None
    line_observed_at: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None

    def validate(self) -> None:
        if self.sport not in SPORTS:
            raise ValueError(f"unknown sport {self.sport!r}")
        if self.market not in MARKETS:
            raise ValueError(f"unknown market {self.market!r}")
        if not (0.0 <= float(self.prob) <= 1.0):
            raise ValueError("prob must be within [0, 1]")
        if self.price is not None and abs(int(self.price)) < 100:
            raise ValueError("American price must have absolute value >= 100")
        for name in ("event_id", "event_label", "selection", "selection_label", "model_id", "model_version"):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"{name} is required")


class Ledger:
    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path is not None else LEDGER_PATH
        self.json_mode = self.path.suffix.lower() == ".json"
        self.con = sqlite3.connect(":memory:" if self.json_mode else self.path)
        self.con.row_factory = sqlite3.Row
        self.con.executescript(SCHEMA)
        if self.json_mode and self.path.exists():
            self._load_json()

    # Backwards-compatible alias used by early callers.
    @property
    def db_path(self) -> Path:
        return self.path

    def _load_json(self) -> None:
        payload = json.loads(self.path.read_text())
        rows = payload.get("rows", []) if isinstance(payload, dict) else payload
        for row in rows:
            cols = [c for c in COLUMNS if c in row]
            self.con.execute(
                f"INSERT OR REPLACE INTO forecast_ledger ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})",
                tuple(row[c] for c in cols),
            )
        self.con.commit()

    def _commit(self) -> None:
        self.con.commit()
        if not self.json_mode:
            return
        rows = [dict(r) for r in self.con.execute("SELECT * FROM forecast_ledger ORDER BY id")]
        payload = {"version": 1, "updatedAt": now_iso(), "rows": rows}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
        tmp.replace(self.path)

    def close(self) -> None:
        self.con.close()

    def __enter__(self) -> "Ledger":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ── writes ──────────────────────────────────────────────────────────
    def record(self, forecasts: Iterable[Forecast], replace_open: bool = True) -> int:
        """Insert forecasts. With ``replace_open`` an unsettled row for the same
        (sport, event, market, selection, model) is replaced so re-scoring an
        upcoming event keeps one live forecast; settled rows are never touched."""
        n = 0
        for f in forecasts:
            f.validate()
            if replace_open:
                self.con.execute(
                    "DELETE FROM forecast_ledger WHERE sport=? AND event_id=? AND market=? AND selection=? AND model_id=? AND outcome IS NULL",
                    (f.sport, f.event_id, f.market, f.selection, f.model_id),
                )
            row = asdict(f)
            row["meta"] = json.dumps(f.meta, separators=(",", ":")) if f.meta is not None else None
            cols = ",".join(row.keys())
            marks = ",".join("?" for _ in row)
            self.con.execute(f"INSERT OR IGNORE INTO forecast_ledger ({cols}) VALUES ({marks})", tuple(row.values()))
            n += 1
        self._commit()
        return n

    def settle(self, sport: str, event_id: str, market: str, selection: str, outcome: str,
               result_value: Optional[float] = None, close_line: Optional[float] = None,
               close_price: Optional[int] = None, settled_at: Optional[str] = None) -> int:
        if outcome not in OUTCOMES:
            raise ValueError(f"unknown outcome {outcome!r}")
        cur = self.con.execute(
            """UPDATE forecast_ledger
               SET outcome=?, result_value=?, settled_at=?,
                   close_line=COALESCE(?, close_line), close_price=COALESCE(?, close_price)
               WHERE sport=? AND event_id=? AND market=? AND selection=? AND outcome IS NULL""",
            (outcome, result_value, settled_at or now_iso(), close_line, close_price, sport, event_id, market, selection),
        )
        self._commit()
        return cur.rowcount

    def set_line(self, sport: str, event_id: str, market: str, selection: str,
                 line: Optional[float], price: Optional[int], book: str, observed_at: str) -> int:
        """Fill the forecast-time line on open rows that were recorded without one."""
        cur = self.con.execute(
            """UPDATE forecast_ledger SET line=?, price=?, book=?, line_observed_at=?
               WHERE sport=? AND event_id=? AND market=? AND selection=? AND outcome IS NULL AND price IS NULL""",
            (line, price, book, observed_at, sport, event_id, market, selection),
        )
        self._commit()
        return cur.rowcount

    def set_close(self, sport: str, event_id: str, market: str, selection: str,
                  close_line: Optional[float], close_price: Optional[int]) -> int:
        cur = self.con.execute(
            "UPDATE forecast_ledger SET close_line=?, close_price=? WHERE sport=? AND event_id=? AND market=? AND selection=?",
            (close_line, close_price, sport, event_id, market, selection),
        )
        self._commit()
        return cur.rowcount

    # ── reads ───────────────────────────────────────────────────────────
    def rows(self, sport: Optional[str] = None, model_id: Optional[str] = None, settled: Optional[bool] = None) -> List[sqlite3.Row]:
        sql = "SELECT * FROM forecast_ledger WHERE 1=1"
        args: List[Any] = []
        if sport:
            sql += " AND sport=?"
            args.append(sport)
        if model_id:
            sql += " AND model_id=?"
            args.append(model_id)
        if settled is True:
            sql += " AND outcome IS NOT NULL"
        elif settled is False:
            sql += " AND outcome IS NULL"
        sql += " ORDER BY forecast_at, event_id, selection"
        return self.con.execute(sql, args).fetchall()

    def open_events(self, sport: str) -> List[str]:
        return [r[0] for r in self.con.execute(
            "SELECT DISTINCT event_id FROM forecast_ledger WHERE sport=? AND outcome IS NULL", (sport,))]

    # ── scoring ─────────────────────────────────────────────────────────
    def summarize(self) -> Dict[str, Any]:
        """Per sport and model: counts, Brier, log loss, calibration, CLV, units."""
        groups: Dict[tuple, List[sqlite3.Row]] = {}
        for r in self.con.execute("SELECT * FROM forecast_ledger ORDER BY forecast_at"):
            groups.setdefault((r["sport"], r["model_id"], r["market"]), []).append(r)

        models: List[Dict[str, Any]] = []
        for (sport, model_id, market), rows in sorted(groups.items()):
            settled = [r for r in rows if r["outcome"] in ("win", "loss")]
            pairs = [(r["prob"], 1 if r["outcome"] == "win" else 0) for r in settled]
            bins = scoring.calibration_bins(pairs)
            units = [scoring.settle_units(r["outcome"], r["price"]) for r in rows if r["outcome"] and r["price"] is not None]
            units = [u for u in units if u is not None]
            clvs = []
            for r in settled + [r for r in rows if r["outcome"] == "push"]:
                if r["price"] is None or r["close_price"] is None:
                    continue
                taken = scoring.american_to_prob(r["price"])
                close = scoring.american_to_prob(r["close_price"])
                if taken is not None and close is not None:
                    clvs.append(close - taken)
            value_rows = [r for r in rows if r["value"] is not None and r["result_value"] is not None]
            mae = (sum(abs(r["value"] - r["result_value"]) for r in value_rows) / len(value_rows)) if value_rows else None
            models.append({
                "sport": sport,
                "modelId": model_id,
                "market": market,
                "modelVersion": rows[-1]["model_version"],
                "forecasts": len(rows),
                "open": sum(1 for r in rows if r["outcome"] is None),
                "settled": len(settled),
                "wins": sum(1 for r in settled if r["outcome"] == "win"),
                "losses": sum(1 for r in settled if r["outcome"] == "loss"),
                "pushes": sum(1 for r in rows if r["outcome"] == "push"),
                "brier": round(sum(scoring.brier(p, y) for p, y in pairs) / len(pairs), 4) if pairs else None,
                "logLoss": round(sum(scoring.log_loss(p, y) for p, y in pairs) / len(pairs), 4) if pairs else None,
                "ece": (round(scoring.expected_calibration_error(bins), 4) if pairs else None),
                "calibration": bins if pairs else [],
                "mae": round(mae, 3) if mae is not None else None,
                "pricedForecasts": len(units),
                "units": round(sum(units), 3) if units else None,
                "roi": round(sum(units) / len(units), 4) if units else None,
                "clvCount": len(clvs),
                "clvAvg": round(sum(clvs) / len(clvs), 4) if clvs else None,
                "firstForecastAt": rows[0]["forecast_at"],
                "lastForecastAt": rows[-1]["forecast_at"],
            })
        return {"generatedAt": now_iso(), "models": models}

    def export_health(self, path: Path = HEALTH_PATH, extra: Optional[Dict[str, Any]] = None) -> Path:
        payload = self.summarize()
        if extra:
            payload.update(extra)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=1))
        tmp.replace(path)
        return path


def recent_forecasts(ledger: Ledger, sport: str, limit: int = 200) -> List[Dict[str, Any]]:
    """Latest open forecasts per event for UI feeds."""
    rows = ledger.con.execute(
        """SELECT * FROM forecast_ledger WHERE sport=? AND outcome IS NULL
           ORDER BY event_start, event_id, prob DESC LIMIT ?""", (sport, limit)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["meta"] = json.loads(d["meta"]) if d.get("meta") else None
        out.append(d)
    return out
