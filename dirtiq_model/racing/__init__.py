"""Conditional-logit (Plackett-Luce) race model for dirt late models.

Modules:
  data       load races/entries/tracks/similars through scripts/model_runtime.py
  features   one vectorized as-of-date feature builder (training and scoring)
  model      conditional logit, boosted-softmax, legacy-method and baselines
  backtest   rolling-origin by season, report JSON
  train      production artifacts per series and stage
  score      prediction JSON + ledger forecasts for one race or all upcoming
  settle     grade open ledger rows from completed races
  cli        ``python3 -m dirtiq_model racing train|backtest|score|settle``
"""
from __future__ import annotations

MODEL_ID = "racing-cl"
MODEL_VERSION = "1.0"
