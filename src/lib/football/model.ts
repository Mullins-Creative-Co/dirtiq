// Football-only research. No dependencies on racing data, odds, or model artifacts.
export const columns = ['game_id', 'kickoff', 'feature_asof', 'completed_at', 'home_team', 'away_team', 'home_margin', 'market_home_margin', 'home_odds', 'away_odds', 'off_epa_diff', 'def_epa_allowed_diff', 'home_field', 'qb_epa_diff'] as const;
export type Game = {
  game_id: string; kickoff: string; feature_asof: string; completed_at: string;
  home_team: string; away_team: string; home_margin: number; market_home_margin: number;
  home_odds: number; away_odds: number; off_epa_diff: number; def_epa_allowed_diff: number;
  home_field: number; qb_epa_diff: number;
  season?: number; week?: number;
  adj_off_epa_diff?: number; adj_def_epa_allowed_diff?: number; rest_diff?: number;
  pressure_allowed_diff?: number; pressure_forced_diff?: number; turnover_margin_diff?: number;
  pass_matchup?: number; rush_matchup?: number;
  home_qb_epa?: number; away_qb_epa?: number; home_adj_net?: number; away_adj_net?: number;
};
export type Settings = { minTrain: number; alpha: number; threshold: number; qbWeight: number; trainingYears: number; halfLifeDays: number };
export type Evaluation = { fromSeason?: number; throughSeason?: number; fromWeek?: number; throughWeek?: number; trainingCutoff?: string };
export const defaults: Settings = { minTrain: 80, alpha: 20, threshold: 2, qbWeight: 35, trainingYears: 2, halfLifeDays: 365 };
export type ModelName = 'Team EPA' | 'Team EPA + manual QB' | 'Joint fit' | 'Opponent adjusted' | 'Adjusted + rest' | 'Adjusted + protection' | 'Adjusted + turnovers' | 'Adjusted + matchups' | 'Full context' | 'Market anchored' | 'Market baseline';
export type Prediction = { gameId: string; kickoff: string; season: number; model: ModelName; predicted: number; market: number; actual: number; edge: number; side: 'home' | 'away' | 'pass'; profit: number; cover: number; trainCount: number; cutoff: string; trainingFrom: string; trainingThrough: string };
export type Summary = { model: ModelName; games: number; mae: number; marketMae: number; bets: number; wins: number; losses: number; pushes: number; units: number; roi: number | null; winRate: number | null; winLow: number | null; winHigh: number | null };
export type Backtest = { predictions: Prediction[]; summary: Summary[]; bySeason: (Summary & { season: number })[]; synthetic: boolean };
export type HistoryMetadata = { provider: string; builtAt: string; seasons: number[]; games: number; seasonCounts: Record<string, number>; excluded: Record<string, number>; featurePolicy: string; qbPolicy: string; availabilityPolicy: string; marketPolicy: string; vintagePolicy: string; attribution: string; evaluationPolicy: string; contextPolicy?: string; sources: { url: string; sha256: string; bytes: number }[] };
export const contextFeatures = ['adj_off_epa_diff', 'adj_def_epa_allowed_diff', 'rest_diff', 'pressure_allowed_diff', 'pressure_forced_diff', 'turnover_margin_diff', 'pass_matchup', 'rush_matchup'] as const;
type Feature = 'off_epa_diff' | 'def_epa_allowed_diff' | 'home_field' | 'qb_epa_diff' | typeof contextFeatures[number];
const teamFeatures: Feature[] = ['off_epa_diff', 'def_epa_allowed_diff', 'home_field'];
const adjustedFeatures: Feature[] = ['adj_off_epa_diff', 'adj_def_epa_allowed_diff', 'home_field', 'qb_epa_diff'];
export const modelSpecs: { name: ModelName; features: Feature[]; description: string; manual?: boolean; residual?: boolean }[] = [
  { name: 'Team EPA', features: teamFeatures, description: 'Baseline: offensive/defensive EPA and home field.' },
  { name: 'Team EPA + manual QB', features: teamFeatures, manual: true, description: 'Diagnostic: adds the full assumed QB value on top of team EPA.' },
  { name: 'Joint fit', features: [...teamFeatures, 'qb_epa_diff'], description: 'Learns team and QB weights together.' },
  { name: 'Opponent adjusted', features: adjustedFeatures, description: 'Replaces raw team EPA with jointly estimated offense/opposing-defense effects.' },
  { name: 'Adjusted + rest', features: [...adjustedFeatures, 'rest_diff'], description: 'Adds rest/bye-day differences, capped at 14 days per team.' },
  { name: 'Adjusted + protection', features: [...adjustedFeatures, 'pressure_allowed_diff', 'pressure_forced_diff'], description: 'Adds sack-or-QB-hit rates on offense/defense. These are proxies, not line grades.' },
  { name: 'Adjusted + turnovers', features: [...adjustedFeatures, 'turnover_margin_diff'], description: 'Tests whether recent forced-minus-committed turnover rates add information already reflected in EPA.' },
  { name: 'Adjusted + matchups', features: [...adjustedFeatures, 'pass_matchup', 'rush_matchup'], description: 'Adds passing/rushing efficiency matchups weighted by prior dropback tendencies.' },
  { name: 'Full context', features: [...adjustedFeatures, 'rest_diff', 'pressure_allowed_diff', 'pressure_forced_diff', 'turnover_margin_diff', 'pass_matchup', 'rush_matchup'], description: 'Fits all implemented context variables jointly with regularization.' },
  { name: 'Market anchored', residual: true, features: [...adjustedFeatures, 'rest_diff', 'pressure_allowed_diff', 'pressure_forced_diff', 'turnover_margin_diff', 'pass_matchup', 'rush_matchup'], description: 'Starts from the quoted line and learns past market errors from context. Research only: historical line timestamps are unknown.' },
];

export function finalCheck(games: Game[]): Evaluation {
  const rows = games.filter(g => g.season === 2025 && g.week >= 10);
  if (!rows.length) throw new Error('The final check requires season/week metadata for 2025 week 10 onward.');
  return { fromSeason: 2025, fromWeek: 10, throughSeason: 2025, trainingCutoff: new Date(Math.min(...rows.map(g => Date.parse(g.feature_asof)))).toISOString() };
}

export function netProfit(cover: number, odds: number) {
  return cover === 0 ? 0 : cover < 0 ? -1 : odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

export function matchup(homeRating: number, awayRating: number, homeField: number, embeddedQbDiff: number, currentQbDiff: number, market: number) {
  const baseline = homeRating - awayRating + homeField;
  const naive = baseline + currentQbDiff;
  const adjusted = baseline + currentQbDiff - embeddedQbDiff;
  return { baseline, naive, adjusted, change: currentQbDiff - embeddedQbDiff, edge: adjusted - market };
}

// RFC-style quoted fields, CRLF and embedded newlines. Reject ambiguous malformed files.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error('Unexpected quote in CSV.');
      quoted = true;
    } else if (c === ',') { row.push(cell); cell = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row);
      row = []; cell = ''; closed = false;
    } else {
      if (closed && c.trim()) throw new Error('Unexpected text after quoted CSV field.');
      if (!closed) cell += c;
    }
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

export function readGames(text: string): Game[] {
  const [header, ...rows] = parseCsv(text);
  if (!header || !rows.length) throw new Error('Add a header and at least one game.');
  const names = header.map(v => v.trim());
  if (new Set(names).size !== names.length) throw new Error('Duplicate column names.');
  const missing = columns.filter(c => !names.includes(c));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
  if (rows.length > 10000) throw new Error('Import at most 10,000 games per experiment.');
  const seen = new Set<string>();
  const numeric = columns.filter(c => !['game_id', 'kickoff', 'feature_asof', 'completed_at', 'home_team', 'away_team'].includes(c));
  return rows.map((values, i) => {
    if (values.length !== names.length) throw new Error(`Row ${i + 2}: column count does not match header.`);
    const raw = Object.fromEntries(names.map((key, j) => [key, values[j].trim()]));
    for (const key of columns) if (!raw[key]) throw new Error(`Row ${i + 2}: ${key} is empty.`);
    if (seen.has(raw.game_id)) throw new Error(`Duplicate game: ${raw.game_id}`);
    seen.add(raw.game_id);
    const result: Record<string, string | number> = { ...raw };
    for (const key of numeric) {
      const n = Number(raw[key]);
      if (!Number.isFinite(n)) throw new Error(`Row ${i + 2}: invalid ${key}.`);
      result[key] = n;
    }
    for (const key of [...contextFeatures, 'home_qb_epa', 'away_qb_epa', 'home_adj_net', 'away_adj_net']) if (raw[key] !== undefined) {
      const n = Number(raw[key]);
      if (!raw[key] || !Number.isFinite(n)) throw new Error(`Row ${i + 2}: invalid ${key}.`);
      result[key] = n;
    }
    for (const key of ['season', 'week']) if (raw[key] !== undefined) {
      const n = Number(raw[key]);
      if (!raw[key] || !Number.isInteger(n) || n < 1) throw new Error(`Row ${i + 2}: invalid ${key}.`);
      result[key] = n;
    }
    for (const key of ['kickoff', 'feature_asof', 'completed_at']) {
      if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw[key]) || !Number.isFinite(Date.parse(raw[key]))) throw new Error(`Row ${i + 2}: ${key} needs an ISO timestamp with timezone.`);
      result[key] = new Date(raw[key]).toISOString();
    }
    if (Date.parse(raw.feature_asof) >= Date.parse(raw.kickoff)) throw new Error(`Row ${i + 2}: features must predate kickoff.`);
    if (Date.parse(raw.completed_at) <= Date.parse(raw.kickoff)) throw new Error(`Row ${i + 2}: completed_at must follow kickoff.`);
    if (Math.abs(Number(result.home_odds)) < 100 || Math.abs(Number(result.away_odds)) < 100) throw new Error(`Row ${i + 2}: use American odds such as -110 or +120.`);
    return result as Game;
  }).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
}

export function csv(rows: Record<string, unknown>[], header = Object.keys(rows[0] ?? {})) {
  const escape = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [header, ...rows.map(row => header.map(c => row[c]))].map(row => row.map(escape).join(',')).join('\r\n');
}

function mean(values: number[]) { return values.reduce((a, b) => a + b, 0) / values.length; }

// Small positive-definite ridge system with unpenalized intercept. All scaling is training-only.
function fit(train: Game[], features: Feature[], alpha: number, cutoffMs: number, halfLifeDays: number) {
  const rawWeights = train.map(r => 2 ** (-(cutoffMs - Date.parse(r.kickoff)) / 86400000 / halfLifeDays));
  // Normalize to mean one so alpha has a comparable scale across windows.
  const weightMean = mean(rawWeights);
  const weights = rawWeights.map(w => w / weightMean);
  const weightedMean = (values: number[]) => values.reduce((s, v, i) => s + v * weights[i], 0) / train.length;
  const means = features.map(f => weightedMean(train.map(r => r[f])));
  const scales = features.map((f, j) => Math.sqrt(weightedMean(train.map(r => (r[f] - means[j]) ** 2))) || 1);
  const yMean = weightedMean(train.map(r => r.home_margin));
  const x = train.map(r => features.map((f, j) => (r[f] - means[j]) / scales[j]));
  const n = features.length;
  const matrix = Array.from({ length: n }, (_, j) => [
    ...Array.from({ length: n }, (_, k) => x.reduce((s, v, i) => s + weights[i] * v[j] * v[k], 0) + (j === k ? alpha : 0)),
    x.reduce((s, v, i) => s + weights[i] * v[j] * (train[i].home_margin - yMean), 0),
  ]);
  for (let j = 0; j < n; j++) {
    const pivot = matrix[j][j];
    for (let k = j; k <= n; k++) matrix[j][k] /= pivot;
    for (let i = 0; i < n; i++) if (i !== j) {
      const factor = matrix[i][j];
      for (let k = j; k <= n; k++) matrix[i][k] -= factor * matrix[j][k];
    }
  }
  return (row: Game) => yMean + features.reduce((s, f, j) => s + matrix[j][n] * (row[f] - means[j]) / scales[j], 0);
}

function weekStart(iso: string) {
  const d = new Date(iso); d.setUTCHours(0, 0, 0, 0);
  // NFL week bucket: Wednesday through Tuesday. Explicit timestamps control training eligibility.
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 4) % 7);
  return d.toISOString();
}

export function runBacktest(input: Game[], settings: Settings, evaluation: Evaluation = {}): Backtest {
  if (!Object.values(settings).every(Number.isFinite) || settings.alpha <= 0 || settings.threshold < 0 || !Number.isInteger(settings.minTrain) || settings.minTrain < 20 || !Number.isInteger(settings.trainingYears) || settings.trainingYears < 1 || settings.trainingYears > 5 || settings.halfLifeDays < 30) throw new Error('Use at least 20 training games, positive alpha, a nonnegative threshold, 1–5 training years, and a half-life of at least 30 days.');
  if (Object.entries(evaluation).some(([k, v]) => k === 'trainingCutoff' ? typeof v !== 'string' || !Number.isFinite(Date.parse(v)) : !Number.isInteger(v)) || (evaluation.fromSeason !== undefined && evaluation.throughSeason !== undefined && evaluation.fromSeason > evaluation.throughSeason) || (evaluation.fromWeek !== undefined && (evaluation.fromWeek < 1 || evaluation.fromSeason === undefined)) || (evaluation.throughWeek !== undefined && (evaluation.throughWeek < 1 || evaluation.throughSeason === undefined))) throw new Error('Choose a valid evaluation season/week range and training cutoff.');
  // Revalidate even programmatically supplied data.
  const games = readGames(csv(input));
  const specs = modelSpecs.filter(spec => [...spec.features, ...(spec.manual ? ['qb_epa_diff' as Feature] : [])].every(f => games.every(g => Number.isFinite(g[f]))));
  const blocks = new Map<string, Game[]>();
  for (const row of games) { const key = weekStart(row.kickoff); blocks.set(key, [...(blocks.get(key) ?? []), row]); }
  const predictions: Prediction[] = [];
  const seasonOf = (r: Game) => r.season ?? Number(r.game_id.match(/^\d{4}/)?.[0] ?? new Date(r.kickoff).getUTCFullYear());
  const lower = (evaluation.fromSeason ?? 0)*100 + (evaluation.fromWeek ?? 0);
  const upper = (evaluation.throughSeason ?? 9999)*100 + (evaluation.throughWeek ?? 99);
  if ((evaluation.fromWeek !== undefined || evaluation.throughWeek !== undefined) && games.some(g => !Number.isFinite(g.week))) throw new Error('Week-based evaluation requires a week on every game.');
  for (const block of blocks.values()) {
    const test = block.filter(r => { const order = seasonOf(r)*100+(r.week ?? 0); return order >= lower && order <= upper; });
    if (!test.length) continue;
    const cutoffMs = Math.min(...block.map(r => Date.parse(r.feature_asof)), evaluation.trainingCutoff ? Date.parse(evaluation.trainingCutoff) : Infinity);
    const oldest = new Date(cutoffMs); oldest.setUTCFullYear(oldest.getUTCFullYear() - settings.trainingYears);
    const train = games.filter(r => Date.parse(r.completed_at) < cutoffMs && Date.parse(r.kickoff) >= oldest.getTime());
    if (train.length < settings.minTrain) continue;
    const fitted = specs.map(spec => ({ ...spec, predict: fit(spec.residual ? train.map(r => ({ ...r, home_margin: r.home_margin-r.market_home_margin })) : train, spec.features, settings.alpha, cutoffMs, settings.halfLifeDays) }));
    for (const row of test) {
      const models: [ModelName, number][] = fitted.map(spec => [spec.name, spec.predict(row) + (spec.manual ? settings.qbWeight * row.qb_epa_diff : 0) + (spec.residual ? row.market_home_margin : 0)]);
      for (const [model, predicted] of models) {
        const edge = predicted - row.market_home_margin;
        const side = edge > settings.threshold ? 'home' : edge < -settings.threshold ? 'away' : 'pass';
        const cover = (row.home_margin - row.market_home_margin) * (side === 'away' ? -1 : 1);
        predictions.push({ gameId: row.game_id, kickoff: row.kickoff, season: seasonOf(row), model, predicted, market: row.market_home_margin,
          actual: row.home_margin, edge, side, cover, profit: side === 'pass' ? 0 : netProfit(cover, side === 'home' ? row.home_odds : row.away_odds),
          trainCount: train.length, cutoff: new Date(cutoffMs).toISOString(), trainingFrom: train[0].kickoff, trainingThrough: train[train.length - 1].kickoff });
      }
    }
  }
  if (!predictions.length) throw new Error('Not enough earlier completed games. Add history or lower the training minimum.');
  const seasons = [...new Set(predictions.map(r => r.season))].sort();
  return { predictions, summary: summarize(predictions), bySeason: seasons.flatMap(season => summarize(predictions.filter(r => r.season === season)).map(s => ({ ...s, season }))), synthetic: games.some(r => r.game_id.startsWith('SYNTHETIC-')) };
}

function summarize(predictions: Prediction[]): Summary[] {
  const names = modelSpecs.map(s => s.name).filter(name => predictions.some(p => p.model === name));
  const summary = names.map(model => {
    const rows = predictions.filter(r => r.model === model);
    const bets = rows.filter(r => r.side !== 'pass');
    const wins = bets.filter(r => r.cover > 0).length;
    const losses = bets.filter(r => r.cover < 0).length;
    const n = wins + losses; const p = n ? wins / n : 0; const z = 1.96;
    const center = n ? (p + z * z / (2 * n)) / (1 + z * z / n) : 0;
    const radius = n ? z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n) : 0;
    const units = bets.reduce((s, r) => s + r.profit, 0);
    return { model, games: rows.length, mae: mean(rows.map(r => Math.abs(r.predicted - r.actual))), marketMae: mean(rows.map(r => Math.abs(r.market - r.actual))),
      bets: bets.length, wins, losses, pushes: bets.length - n, units, roi: bets.length ? units / bets.length : null,
      winRate: n ? p : null, winLow: n ? center - radius : null, winHigh: n ? center + radius : null };
  });
  return summary;
}

export function demoGames(): Game[] {
  let seed = 42;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 1) / 4294967297; };
  const normal = () => Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
  return Array.from({ length: 320 }, (_, i) => {
    const off = normal() * .12, def = normal() * .12, qb = .75 * off + normal() * .04;
    const kickoff = Date.parse('2020-09-13T17:00:00Z') + Math.floor(i / 8) * 7 * 86400000 + i % 8 * 3600000;
    const strength = 35 * off - 30 * def + 1.5;
    return { game_id: `SYNTHETIC-${i}`, kickoff: new Date(kickoff).toISOString(), feature_asof: new Date(kickoff - 2 * 86400000).toISOString(),
      completed_at: new Date(kickoff + 5 * 3600000).toISOString(), home_team: `DEMO HOME ${i % 8}`, away_team: `DEMO AWAY ${i % 8}`,
      off_epa_diff: off, def_epa_allowed_diff: def, qb_epa_diff: qb, home_field: 1,
      home_margin: Math.round(strength + normal() * 13), market_home_margin: Math.round((strength + normal() * 2) * 2) / 2, home_odds: -110, away_odds: -110 };
  });
}

/** Frozen development-only Team EPA fit. No market/target result/assumed QB inputs.
 * Point regression does NOT establish calibrated cover probabilities. */
export function forecastPregameTeamEpa(history: Game[], target: Pick<Game, 'off_epa_diff' | 'def_epa_allowed_diff' | 'home_field'>) {
  if (teamFeatures.some(f => !Number.isFinite(target[f as keyof typeof target]))) throw new Error('Missing finite team-EPA features.');
  const cutoff = Date.parse('2025-11-05T18:00:00Z');
  const train = history.filter(g => (g.season === 2023 || g.season === 2024 || (g.season === 2025 && (g.week ?? 99) <= 9)) && Date.parse(g.completed_at) < cutoff);
  if (train.length < defaults.minTrain || train.some(g => !Number.isFinite(g.home_margin) || teamFeatures.some(f => !Number.isFinite(g[f])))) throw new Error('Insufficient or invalid development-only training history.');
  const predicted = fit(train, teamFeatures, defaults.alpha, cutoff, defaults.halfLifeDays)(target as Game);
  if (!Number.isFinite(predicted) || Math.abs(predicted) > 100) throw new Error('Invalid model projection.');
  return { predicted, trainCount: train.length, trainingCutoff: new Date(cutoff).toISOString(), modelVersion: 'nfl-team-epa-development-v1' };
}
