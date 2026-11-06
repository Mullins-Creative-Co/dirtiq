// Football-only research. No dependencies on racing data, odds, or model artifacts.
export const columns = ['game_id', 'kickoff', 'feature_asof', 'completed_at', 'home_team', 'away_team', 'home_margin', 'market_home_margin', 'home_odds', 'away_odds', 'off_epa_diff', 'def_epa_allowed_diff', 'home_field', 'qb_epa_diff'] as const;
export type Game = {
  game_id: string; kickoff: string; feature_asof: string; completed_at: string;
  home_team: string; away_team: string; home_margin: number; market_home_margin: number;
  home_odds: number; away_odds: number; off_epa_diff: number; def_epa_allowed_diff: number;
  home_field: number; qb_epa_diff: number;
};
export type Settings = { minTrain: number; alpha: number; threshold: number; qbWeight: number };
export const defaults: Settings = { minTrain: 80, alpha: 20, threshold: 2, qbWeight: 35 };
export type ModelName = 'Team EPA' | 'Team EPA + manual QB' | 'Joint fit';
export type Prediction = { gameId: string; kickoff: string; model: ModelName; predicted: number; market: number; actual: number; edge: number; side: 'home' | 'away' | 'pass'; profit: number; cover: number; trainCount: number; cutoff: string };
export type Summary = { model: ModelName; games: number; mae: number; marketMae: number; bets: number; wins: number; losses: number; pushes: number; units: number; roi: number | null; winRate: number | null; winLow: number | null; winHigh: number | null };
export type Backtest = { predictions: Prediction[]; summary: Summary[]; synthetic: boolean };

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

type Feature = 'off_epa_diff' | 'def_epa_allowed_diff' | 'home_field' | 'qb_epa_diff';
const teamFeatures: Feature[] = ['off_epa_diff', 'def_epa_allowed_diff', 'home_field'];
function mean(values: number[]) { return values.reduce((a, b) => a + b, 0) / values.length; }

// Small positive-definite ridge system with unpenalized intercept. All scaling is training-only.
function fit(train: Game[], features: Feature[], alpha: number) {
  const means = features.map(f => mean(train.map(r => r[f])));
  const scales = features.map((f, j) => Math.sqrt(mean(train.map(r => (r[f] - means[j]) ** 2))) || 1);
  const yMean = mean(train.map(r => r.home_margin));
  const x = train.map(r => features.map((f, j) => (r[f] - means[j]) / scales[j]));
  const n = features.length;
  const matrix = Array.from({ length: n }, (_, j) => [
    ...Array.from({ length: n }, (_, k) => x.reduce((s, v) => s + v[j] * v[k], 0) + (j === k ? alpha : 0)),
    x.reduce((s, v, i) => s + v[j] * (train[i].home_margin - yMean), 0),
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

export function runBacktest(input: Game[], settings: Settings): Backtest {
  if (!Object.values(settings).every(Number.isFinite) || settings.alpha <= 0 || settings.threshold < 0 || !Number.isInteger(settings.minTrain) || settings.minTrain < 20) throw new Error('Use at least 20 training games, positive regularization, and a nonnegative threshold.');
  // Revalidate even programmatically supplied data.
  const games = readGames(csv(input, [...columns]));
  const blocks = new Map<string, Game[]>();
  for (const row of games) { const key = weekStart(row.kickoff); blocks.set(key, [...(blocks.get(key) ?? []), row]); }
  const predictions: Prediction[] = [];
  for (const test of blocks.values()) {
    const cutoffMs = Math.min(...test.map(r => Date.parse(r.feature_asof)));
    const train = games.filter(r => Date.parse(r.completed_at) < cutoffMs);
    if (train.length < settings.minTrain) continue;
    const team = fit(train, teamFeatures, settings.alpha);
    const joint = fit(train, [...teamFeatures, 'qb_epa_diff'], settings.alpha);
    for (const row of test) {
      const base = team(row);
      const models: [ModelName, number][] = [['Team EPA', base], ['Team EPA + manual QB', base + settings.qbWeight * row.qb_epa_diff], ['Joint fit', joint(row)]];
      for (const [model, predicted] of models) {
        const edge = predicted - row.market_home_margin;
        const side = edge > settings.threshold ? 'home' : edge < -settings.threshold ? 'away' : 'pass';
        const cover = (row.home_margin - row.market_home_margin) * (side === 'away' ? -1 : 1);
        predictions.push({ gameId: row.game_id, kickoff: row.kickoff, model, predicted, market: row.market_home_margin,
          actual: row.home_margin, edge, side, cover, profit: side === 'pass' ? 0 : netProfit(cover, side === 'home' ? row.home_odds : row.away_odds),
          trainCount: train.length, cutoff: new Date(cutoffMs).toISOString() });
      }
    }
  }
  if (!predictions.length) throw new Error('Not enough earlier completed games. Add history or lower the training minimum.');
  const names: ModelName[] = ['Team EPA', 'Team EPA + manual QB', 'Joint fit'];
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
  return { predictions, summary, synthetic: games.some(r => r.game_id.startsWith('SYNTHETIC-')) };
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
