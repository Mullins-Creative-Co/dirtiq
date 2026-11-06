import fs from 'node:fs';
import crypto from 'node:crypto';
import { type Game, type HistoryMetadata } from '../../src/lib/football/model.ts';
import { buildResearch } from '../../src/lib/football/research.ts';

// Never evaluates 2025 week 10 onward. Includes first-half 2025 for development.
const source = fs.readFileSync('public/football/history.json', 'utf8');
const dataset = JSON.parse(source) as { games: Game[]; metadata: HistoryMetadata };
const report = buildResearch(dataset.games, dataset.metadata, crypto.createHash('sha256').update(source).digest('hex'));
fs.writeFileSync('public/football/research.json', JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify({ games: report.games, models: report.rows.map(r => ({ model: r.model, mae: r.mae, marketMae: r.marketMae, delta: r.delta, interval: [r.low, r.high], status: r.status })), holdout: report.holdout }, null, 2));
