"""dirtiq_model: one forecasting engine for every sport dirtIQ covers.

Layout
------
scoring.py   Shared proper-scoring rules, calibration bins, closing-line value.
ledger.py    The forecast ledger: every forecast, the market at that moment,
             the eventual result, and the scores. SQLite table ``forecast_ledger``
             in the dirtIQ database, exported to ``public/data/model-health.json``.
racing/      Pick-one-of-N racing model (conditional logit / Plackett-Luce).
teams/       Two-team margin model (state-space ratings) with per-sport adapters.

Run ``python3 -m dirtiq_model --help``.
Python 3.9 compatible: keep ``from __future__ import annotations`` in every module
and avoid runtime ``X | Y`` unions and ``match`` statements.
"""
from __future__ import annotations

__version__ = "1.0.0"
