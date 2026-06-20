#!/usr/bin/env python3
"""Patch the local macOS XGBoost wheel to find scikit-learn's libomp.

This is a no-sudo fallback for Macs where Homebrew's /opt/homebrew libomp path
is unavailable. It adds sklearn/.dylibs as an LC_RPATH on libxgboost.dylib.
"""

import importlib.util
import subprocess
from pathlib import Path


def package_dir(name: str) -> Path:
    spec = importlib.util.find_spec(name)
    if spec is None or spec.origin is None:
        raise SystemExit(f"{name} is not installed for this Python.")
    return Path(spec.origin).parent


def rpaths(dylib: Path) -> list[str]:
    output = subprocess.check_output(["otool", "-l", str(dylib)], text=True)
    paths: list[str] = []
    lines = iter(output.splitlines())
    for line in lines:
      if "cmd LC_RPATH" not in line:
          continue
      for subline in lines:
          stripped = subline.strip()
          if stripped.startswith("path "):
              paths.append(stripped.split(" (offset", 1)[0].replace("path ", "", 1))
              break
    return paths


def main() -> None:
    xgboost_lib = package_dir("xgboost") / "lib" / "libxgboost.dylib"
    sklearn_libomp_dir = package_dir("sklearn") / ".dylibs"
    sklearn_libomp = sklearn_libomp_dir / "libomp.dylib"

    if not xgboost_lib.exists():
        raise SystemExit(f"Missing XGBoost dylib: {xgboost_lib}")
    if not sklearn_libomp.exists():
        raise SystemExit(f"Missing sklearn OpenMP runtime: {sklearn_libomp}")

    existing = rpaths(xgboost_lib)
    target = str(sklearn_libomp_dir)
    if target not in existing:
        subprocess.check_call(["install_name_tool", "-add_rpath", target, str(xgboost_lib)])
        print(f"Added XGBoost rpath -> {target}")
    else:
        print(f"XGBoost rpath already present -> {target}")

    import xgboost as xgb

    print(f"XGBoost import OK: {xgb.__version__}")


if __name__ == "__main__":
    main()
