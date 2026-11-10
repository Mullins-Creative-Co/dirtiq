"""Shared download/cache helpers and the adapter frame contract."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]


def cache_root() -> Path:
    """``$DIRTIQ_SPORTS_CACHE`` when set, else ``../sports-cache`` next to the repo (never inside it)."""
    env = os.environ.get("DIRTIQ_SPORTS_CACHE")
    return Path(env).expanduser() if env else ROOT.parent / "sports-cache"


CACHE_ROOT = cache_root()

CONTRACT_COLUMNS = [
    "game_id", "season", "week", "start", "home", "away", "neutral",
    "home_score", "away_score", "spread_line", "spread_home_price", "spread_away_price",
    "home_ml", "away_ml", "total_line", "completed",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cache_dir_for(sport: str, cache_dir: Optional[Path] = None) -> Path:
    path = Path(cache_dir) if cache_dir is not None else cache_root() / sport
    path.mkdir(parents=True, exist_ok=True)
    return path


def download(url: str, dest: Path, refresh: bool = False, timeout: int = 120) -> Dict[str, Any]:
    """Fetch ``url`` into ``dest`` unless cached. Returns ``{url, path, sha256, retrievedAt, bytes}``.

    A sidecar ``<dest>.meta.json`` records the SHA256 and retrieval time so later
    runs without ``refresh`` still report when the bytes were fetched.
    """
    dest = Path(dest)
    meta_path = dest.with_name(dest.name + ".meta.json")
    if dest.exists() and not refresh:
        if meta_path.exists():
            meta = json.loads(meta_path.read_text())
            if meta.get("sha256") == sha256_of(dest):
                return meta
        meta = {
            "url": url, "path": str(dest), "sha256": sha256_of(dest),
            "retrievedAt": datetime.fromtimestamp(dest.stat().st_mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "bytes": dest.stat().st_size,
        }
        meta_path.write_text(json.dumps(meta, indent=1))
        return meta
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "dirtiq-model/1.0"})
    fd, tmp_name = tempfile.mkstemp(prefix=dest.name, dir=str(dest.parent))
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(tmp, "wb") as out:
            shutil.copyfileobj(resp, out)
        tmp.replace(dest)
    finally:
        if tmp.exists():
            tmp.unlink()
    meta = {"url": url, "path": str(dest), "sha256": sha256_of(dest), "retrievedAt": now_iso(), "bytes": dest.stat().st_size}
    meta_path.write_text(json.dumps(meta, indent=1))
    return meta


def finalize(frame: pd.DataFrame, sources: List[Dict[str, Any]], book: Optional[str], label: str) -> pd.DataFrame:
    """Coerce to the contract dtypes, sort by start, and attach provenance in ``attrs``."""
    out = frame.copy()
    for col in CONTRACT_COLUMNS:
        if col not in out.columns:
            out[col] = None
    out["game_id"] = out["game_id"].astype(str)
    out["season"] = out["season"].astype(int)
    out["week"] = pd.to_numeric(out["week"], errors="coerce").astype("Int64")
    out["start"] = pd.to_datetime(out["start"], utc=True)
    out["home"] = out["home"].astype(str)
    out["away"] = out["away"].astype(str)
    out["neutral"] = out["neutral"].fillna(0).astype(int)
    for col in ("home_score", "away_score", "spread_line", "spread_home_price", "spread_away_price", "home_ml", "away_ml", "total_line"):
        out[col] = pd.to_numeric(out[col], errors="coerce").astype(float)
    out["completed"] = out["completed"].fillna(False).astype(bool)
    extra = [c for c in out.columns if c not in CONTRACT_COLUMNS]
    out = out[CONTRACT_COLUMNS + extra].sort_values(["start", "game_id"]).reset_index(drop=True)
    out.attrs["sources"] = [{"url": s["url"], "sha256": s["sha256"], "retrievedAt": s["retrievedAt"]} for s in sources]
    out.attrs["book"] = book
    out.attrs["label"] = label
    return out
