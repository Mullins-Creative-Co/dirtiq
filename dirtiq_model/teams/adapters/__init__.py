"""Per-sport game loaders. Each exposes ``load_games(cache_dir, refresh=False)``."""
from __future__ import annotations

import importlib
from types import ModuleType

SPORTS = ("nfl", "nba", "ncaaf", "ncaab")


def get_adapter(sport: str) -> ModuleType:
    if sport not in SPORTS:
        raise ValueError(f"unknown sport {sport!r}; expected one of {SPORTS}")
    return importlib.import_module(f"dirtiq_model.teams.adapters.{sport}")
