"""Live odds snapshots from The Odds API, used to fill lines and closing lines in the ledger.

``python3 -m dirtiq_model odds snapshot --sport nfl`` fetches current spreads and
moneylines for upcoming games, writes a consensus snapshot to
``public/data/odds/<sport>-latest.json``, and updates open ledger rows:

* rows with no line yet (sports whose source file has no market) get the first
  visible consensus line as their ``line``/``price`` with book ``odds-api consensus``;
* every open row gets ``close_line``/``close_price`` refreshed, so the last snapshot
  before the event starts is the closing line used for closing-line value.

Requires ``ODDS_API_KEY`` in the environment. Without it the command writes
``public/data/odds/status.json`` with ``configured: false`` and exits cleanly, so the
UI can say the feed is not configured. Nothing here is a betting recommendation.
"""
from __future__ import annotations
