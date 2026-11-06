import { defaults, modelSpecs, runBacktest, type Evaluation, type Game, type HistoryMetadata, type ModelName, type Prediction, type Settings, type Summary } from './model.ts';

export const development: Evaluation = { fromSeason: 2023, throughSeason: 2025, throughWeek: 9 };
const parents: Partial<Record<ModelName, ModelName>> = {
  'Team EPA + manual QB': 'Team EPA', 'Joint fit': 'Team EPA', 'Opponent adjusted': 'Joint fit',
  'Adjusted + rest': 'Opponent adjusted', 'Adjusted + protection': 'Opponent adjusted',
  'Adjusted + turnovers': 'Opponent adjusted', 'Adjusted + matchups': 'Opponent adjusted', 'Full context': 'Opponent adjusted',
  'Market anchored': 'Market baseline',
};
export type ResearchRow = Summary & { parent: ModelName | null; description: string; delta: number | null; low: number | null; high: number | null; consistentValidation: boolean; status: string };
export type InputReadiness = { checkedAt: string; enabled: string[]; excluded: string[]; nextRequirement: string; injuries: { season: number; rows: number; timestamped: number; status: string }[] };
export type Segment = { label: string; sides: number; wins: number; losses: number; pushes: number; coverRate: number | null; meanMarketError: number | null; periods: { label: string; sides: number; meanMarketError: number | null }[] };
export type ResearchReport = {
  version: number; generatedAt: string; settings: Settings; evaluation: Evaluation; sourceSha256: string;
  games: number; intervalConfidence: number; bootstrapSamples: number; comparisons: number;
  rows: ResearchRow[]; byPeriod: { period: string; rows: Summary[] }[];
  segments: Segment[];
  holdout: { season: number; fromWeek: number; evaluated: false; method: string };
  limits: string[]; source: { provider: string; builtAt: string };
};

export function qbSegments(games: Game[]): Segment[] {
  const labels = ['Stronger team / QB at or below prior median', 'Stronger team / QB above prior median', 'Other team / QB at or below prior median', 'Other team / QB above prior median'];
  const groups = labels.map(() => [] as { season: number; error: number }[]);
  for (const g of games) {
    if ((g.season ?? 0) < 2023 || (g.season ?? 9999) > 2025 || g.season === 2025 && (g.week ?? 99) >= 10) continue;
    if (![g.home_qb_epa, g.away_qb_epa, g.home_adj_net, g.away_adj_net].every(Number.isFinite)) continue;
    const cutoff = Date.parse(g.feature_asof), oldest = new Date(cutoff); oldest.setUTCFullYear(oldest.getUTCFullYear()-2);
    const past = games.filter(p => Date.parse(p.completed_at) < cutoff && Date.parse(p.kickoff) >= oldest.getTime());
    const qbs = past.flatMap(p => [p.home_qb_epa, p.away_qb_epa]).filter(Number.isFinite).sort((a, b) => a-b);
    if (qbs.length < 40) continue;
    const median = (qbs[Math.floor((qbs.length-1)/2)]+qbs[Math.floor(qbs.length/2)])/2;
    for (const home of [true, false]) {
      const strong = (home ? g.home_adj_net : g.away_adj_net) > 0;
      const below = (home ? g.home_qb_epa : g.away_qb_epa) <= median;
      const index = (strong ? 0 : 2)+(below ? 0 : 1);
      groups[index].push({ season: g.season, error: (g.home_margin-g.market_home_margin)*(home ? 1 : -1) });
    }
  }
  return labels.map((label, i) => {
    const rows = groups[i], wins = rows.filter(r => r.error > 0).length, losses = rows.filter(r => r.error < 0).length;
    return { label, sides: rows.length, wins, losses, pushes: rows.length-wins-losses, coverRate: wins+losses ? wins/(wins+losses) : null,
      meanMarketError: rows.length ? rows.reduce((s, r) => s+r.error, 0)/rows.length : null,
      periods: [2023, 2024, 2025].map(season => { const subset = rows.filter(r => r.season === season); return { label: season === 2025 ? '2025 weeks 1–9' : String(season), sides: subset.length, meanMarketError: subset.length ? subset.reduce((s, r) => s+r.error, 0)/subset.length : null }; }) };
  });
}

export function pairedInterval(rows: Prediction[], reference: Prediction[], comparisons = 8, samples = 4000) {
  const lookup = new Map(reference.map(r => [r.gameId, r]));
  const groups = new Map<string, { total: number; n: number }>();
  for (const r of rows) {
    const base = lookup.get(r.gameId);
    if (!base) throw new Error('Paired comparison requires identical test games.');
    const group = groups.get(r.cutoff) ?? { total: 0, n: 0 };
    group.total += Math.abs(r.predicted-r.actual)-Math.abs(base.predicted-base.actual); group.n++;
    groups.set(r.cutoff, group);
  }
  const blocks = [...groups.values()];
  if (blocks.length < 2) return { low: null, high: null };
  let seed = 7703;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const draws = Array.from({ length: samples }, () => {
    let total = 0, count = 0;
    for (let i = 0; i < blocks.length; i++) { const block = blocks[Math.floor(random()*blocks.length)]; total += block.total; count += block.n; }
    return total/count;
  }).sort((a, b) => a-b);
  const tail = .05/(2*comparisons);
  return { low: draws[Math.floor(samples*tail)], high: draws[Math.min(samples-1, Math.ceil(samples*(1-tail)))] };
}

export function buildResearch(games: Game[], metadata: HistoryMetadata, sourceSha256: string): ResearchReport {
  // Parameters and comparisons were set before running this report. No grid search,
  // betting-filter mining, or second-half 2025 evaluation occurs in this function.
  const result = runBacktest(games, defaults, development);
  if (result.predictions.some(r => r.season === 2025 && (games.find(g => g.game_id === r.gameId)?.week ?? 99) >= 10)) throw new Error('Final holdout entered development.');
  const comparisons = Math.max(1, result.summary.length-1);
  const rows = result.summary.map(summary => {
    const parent = parents[summary.model] ?? null;
    const base = parent === 'Market baseline' ? { ...summary, model: parent, mae: summary.marketMae } : result.summary.find(s => s.model === parent);
    const delta = base ? summary.mae-base.mae : null;
    const reference = parent === 'Market baseline' ? result.predictions.filter(r => r.model === summary.model).map(r => ({ ...r, predicted: r.market })) : result.predictions.filter(r => r.model === parent);
    const interval = base ? pairedInterval(result.predictions.filter(r => r.model === summary.model), reference, comparisons) : { low: null, high: null };
    const consistentValidation = !!base && [2024, 2025].every(year => {
      const current = result.bySeason.find(s => s.season === year && s.model === summary.model);
      const prior = parent === 'Market baseline' && current ? { mae: current.marketMae } : result.bySeason.find(s => s.season === year && s.model === parent);
      return current && prior && current.mae < prior.mae;
    });
    const status = !parent ? 'Reference' : interval.high !== null && interval.high < 0 && consistentValidation ? 'Candidate increment' : 'Improvement not established';
    return { ...summary, parent, delta, ...interval, consistentValidation, status, description: modelSpecs.find(s => s.name === summary.model)!.description };
  });
  return {
    version: 1, generatedAt: new Date().toISOString(), settings: { ...defaults }, evaluation: { ...development }, sourceSha256,
    games: result.summary[0].games, comparisons, intervalConfidence: 1-.05/comparisons, bootstrapSamples: 4000,
    rows, segments: qbSegments(games), byPeriod: [2023, 2024, 2025].map(year => ({ period: year === 2025 ? '2025 weeks 1–9 · confirmation' : `${year} · ${year === 2023 ? 'discovery' : 'validation'}`, rows: result.bySeason.filter(s => s.season === year) })),
    holdout: { season: 2025, fromWeek: 10, evaluated: false, method: 'Freeze fitted coefficients and training weights before week 10. Subsequent pregame features may update from already completed games; no holdout outcomes enter fitting.' },
    limits: [
      'This is a retrospective research benchmark, not a reconstruction of sportsbook algorithms or executable betting prices.',
      'Historical EPA is from current source vintages; contemporaneous revisions and model-vintage effects remain unresolved.',
      'QB identity is the previous eligible game’s dominant passer, not a verified announced starter. New injuries or QB replacements may be missed.',
      'Injury publication times, pregame weather forecasts, and timestamped odds movement are not sufficiently verified and are excluded.',
      'Sack/QB-hit statistics reflect quarterback, line, receivers, and scheme together; they do not isolate offensive-line ability.',
      'Intervals resample weekly blocks and adjust conservatively for the listed comparisons. They cannot eliminate all time dependence or future selection bias.',
      'A candidate increment is an improvement against its model parent, not proof of a betting edge. No cover probabilities or expected-value estimates are claimed.',
    ], source: { provider: metadata.provider, builtAt: metadata.builtAt },
  };
}
