<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Models live in `dirtiq_model/`

All forecasting (racing and team sports) is the Python package `dirtiq_model/`;
read `docs/model-architecture.md` before touching it. The Next.js app only reads the
JSON artifacts it writes (`public/data/*.json`, `public/sports/*.json`,
`data/ml-predictions/*.json`) through `src/lib/model-reports.ts`. Python is 3.9 in
production: `from __future__ import annotations`, no runtime `X | Y`, no `match`.

# Roadmap lives in `BUILD_PLANS.md`

Ranked build plans with context, acceptance criteria and what has shipped. Read it
before proposing work; update it when a plan ships or priorities change.
