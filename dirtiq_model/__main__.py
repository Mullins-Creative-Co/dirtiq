"""Command line entry: ``python3 -m dirtiq_model <sport> <command> [options]``.

Sports register themselves by exposing ``main(argv)`` in
``dirtiq_model.<sport>.cli``. ``ledger`` is the shared ledger tool.
"""
from __future__ import annotations

import importlib
import sys
from typing import List


USAGE = """usage: python3 -m dirtiq_model <target> <command> [options]

targets:
  racing   conditional-logit race model      (train | backtest | score | settle)
  teams    two-team margin model             (backtest | forecast | settle; --sport nfl|nba|...)
  ledger   forecast ledger                   (summary | export | settle)
  odds     live odds snapshots               (snapshot --sport nfl; needs ODDS_API_KEY)
  card     today's ranked, staked shortlist  (build)
"""


def main(argv: List[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(USAGE)
        return 0
    target = argv[0]
    try:
        module = importlib.import_module(f"dirtiq_model.{target}.cli")
    except ModuleNotFoundError as exc:
        if exc.name and exc.name.startswith(f"dirtiq_model.{target}"):
            print(f"unknown target {target!r}\n{USAGE}", file=sys.stderr)
            return 2
        raise
    return int(module.main(argv[1:]) or 0)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
