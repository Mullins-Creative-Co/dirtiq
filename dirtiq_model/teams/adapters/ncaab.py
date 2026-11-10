"""NCAAB adapter (sportsdataverse mbb schedules).

Not implemented yet. The schedule release exists under the tag
``espn_mens_college_basketball_schedules`` (not ``espn_mbb_schedules``) and has no
betting lines; wiring it needs the same ESPN-schema conversion as the NBA adapter
plus a 360-team pooled-minor-team rule, and the backtest cost (about 5,500 games
and 360 states per season) needs a reduced optimizer budget. Until then this raises.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import pandas as pd

LABEL = "NCAAB"
BOOK = None


def load_games(cache_dir: Optional[Path] = None, refresh: bool = False) -> pd.DataFrame:
    raise NotImplementedError("ncaab adapter is not implemented: espn_mens_college_basketball_schedules release is not wired yet")
