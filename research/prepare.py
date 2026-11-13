"""Freeze research inputs without modifying model, source cache or published artifacts."""
from __future__ import annotations
import argparse
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

SPORTS = ("nfl", "ncaaf", "nba", "ncaab")
ROOT = Path(__file__).resolve().parents[1]

def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--predictions", type=Path, required=True)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--output", type=Path, default=ROOT / "research/output")
    args = p.parse_args()
    dest = args.output / "inputs"
    if dest.exists():
        raise SystemExit("Inputs already frozen; use a new output directory, not an overwrite")
    dest.mkdir(parents=True)
    for sport in SPORTS:
        shutil.copytree(args.cache / sport, dest / "cache" / sport)
        (dest / "predictions").mkdir(exist_ok=True)
        shutil.copy2(args.predictions / (sport + "-backtest-predictions.csv"), dest / "predictions" / (sport + ".csv"))
        (dest / "reports").mkdir(exist_ok=True)
        shutil.copy2(ROOT / "public/sports" / (sport + ".json"), dest / "reports" / (sport + ".json"))
    # Static city coordinates, not team locations or postgame information.
    urls = ["https://download.geonames.org/export/dump/cities15000.zip"]
    sources = []
    for url in urls:
        path = dest / url.rsplit("/", 1)[-1]
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dirtiq-research/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                path.write_bytes(r.read())
            sources.append({"url": url, "status": "downloaded", "sha256": sha(path)})
        except Exception as exc:
            sources.append({"url": url, "status": "unavailable", "error": str(exc)})
    manifest = {str(f.relative_to(dest)): sha(f) for f in sorted(dest.rglob("*")) if f.is_file()}
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (args.output / "sources.json").write_text(json.dumps(sources, indent=2) + "\n")
    print("Frozen %d files in %s" % (len(manifest), dest), flush=True)

if __name__ == "__main__":
    main()
