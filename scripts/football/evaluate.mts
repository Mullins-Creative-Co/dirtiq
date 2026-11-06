import fs from 'node:fs';
import { defaults, runBacktest, type Game } from '../../src/lib/football/model.ts';

// Deliberately do not inspect 2025. Fix settings before an explicit final check.
const dataset = JSON.parse(fs.readFileSync('public/football/history.json', 'utf8')) as { games: Game[]; metadata: unknown };
const evaluation = { fromSeason: 2023, throughSeason: 2024 };
const result = runBacktest(dataset.games, defaults, evaluation);
console.log(JSON.stringify({ settings: defaults, evaluation, summary: result.summary, bySeason: result.bySeason }, null, 2));
