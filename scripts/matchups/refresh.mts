/** No keys, prices, bets or external-model copying. Run before games. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { forecastPregameTeamEpa, type Game } from '../../src/lib/football/model.ts';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dirtiq-pregame-'));
try {
  const file = path.join(scratch, 'features.json');
  const result = spawnSync('python3', ['scripts/football/pregame_features.py', '--output', file, '--cache', process.env.MATCHUPS_CACHE || '/tmp/dirtiq-pregame-cache'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('NFL feature refresh failed. Existing artifact retained; UI freshness gate will expire it.');
  const inputs = JSON.parse(fs.readFileSync(file, 'utf8'));
  const historyText = fs.readFileSync('public/football/history.json', 'utf8');
  const history = JSON.parse(historyText) as { games: Game[] };
  const generatedAt = new Date().toISOString();
  const forecasts = inputs.games.map((game: { id: string; gameId: string; home: string; away: string; startsAt: string; featureAsOf: string; off_epa_diff: number; def_epa_allowed_diff: number; home_field: number }) => {
    if (!(Date.parse(game.featureAsOf) <= Date.parse(generatedAt) && Date.parse(generatedAt) < Date.parse(game.startsAt))) throw new Error('Forecast is not pregame.');
    return { ...game, ...forecastPregameTeamEpa(history.games, game), generatedAt };
  });
  const artifact = { version: 1, generatedAt, expiresAt: new Date(Date.parse(inputs.generatedAt) + 6*3600000).toISOString(), status: 'experimental-point-forecasts', forecasts, blocked: inputs.blocked, sources: inputs.sources,
    historySha256: crypto.createHash('sha256').update(historyText).digest('hex'),
    attribution: 'Derived from nflverse / nflfastR play-by-play, CC BY 4.0: https://creativecommons.org/licenses/by/4.0/. No endorsement. Schedule: nflverse/nfldata.',
    limitations: ['Team-EPA baseline only, not the full-context model.', 'Development-only fit: 2023–2024 and 2025 weeks 1–9. Late-2025 reserved data excluded; coefficients have not been validated on 2026.', 'No confirmed starters, injuries, weather, current book quotes or external-model feed.', 'No calibrated cover probabilities, verified betting edge, or guaranteed profit.', 'Current revised source data, not historical as-published vintages. Previous games become eligible 24 hours after kickoff.'],
  };
  fs.mkdirSync('public/matchups', { recursive: true });
  const target = 'public/matchups/pregame.json';
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(artifact, null, 2)+'\n'); fs.renameSync(`${target}.tmp`, target);
  console.log(JSON.stringify({ forecasts: forecasts.length, blocked: artifact.blocked, generatedAt }));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
