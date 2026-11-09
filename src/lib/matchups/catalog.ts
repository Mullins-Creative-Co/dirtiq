import nflTrial from '../../../public/football/nfl-trial.json' with { type: 'json' };
import nbaResearch from '../../../public/nba/research.json' with { type: 'json' };
import type { SportId } from './model.ts';

export type MatchupGame = {
  id: string; sport: SportId; home: string; away: string; startsAt: string | null;
  status: string; sourceLabel: string; sourceUrl: string;
  baselineHomeMargin: number | null; baselineSource: string;
  homeSpread: number | null; homeOdds: number | null; awayOdds: number | null;
  book: string; quoteObservedAt: string; homeCoverProbability: number | null;
  probabilitySource: string; distribution?: Record<string, number>; warnings: string[];
};

type NflTrial = typeof nflTrial;
type NbaResearch = typeof nbaResearch;
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

// Accept fixtures for tests, but production callers use only the two bundled artifacts.
export function adaptNflTrial(data: NflTrial): MatchupGame[] {
  const latest = new Map<string, NflTrial['forecasts'][number]>();
  for (const row of data.forecasts) {
    const previous = latest.get(row.game);
    if (!previous || Date.parse(row.recordedAt) > Date.parse(previous.recordedAt)) latest.set(row.game, row);
  }
  return [...latest.values()].map(row => {
    const quote = row.request.target;
    const distribution = { ...row.prediction.marginDistribution };
    const entries = Object.entries(distribution);
    const valid = entries.length > 0 && entries.every(([margin, mass]) => Number.isFinite(Number(margin)) && Number.isFinite(mass) && mass >= 0);
    const total = entries.reduce((sum, [, mass]) => sum + mass, 0);
    const usable = valid && Math.abs(total - 1) < 1e-6;
    return {
      id: `nfl:${row.id}`, sport: 'nfl', home: row.home, away: row.away,
      startsAt: row.kickoff || null, status: 'Frozen trial example',
      sourceLabel: 'NFL frozen trial', sourceUrl: '/football/nfl-trial.json',
      baselineHomeMargin: usable ? entries.reduce((sum, [margin, mass]) => sum + Number(margin) * mass, 0) : null,
      baselineSource: 'Mean of frozen NFL trial margin distribution',
      homeSpread: finite(quote.homeSpread), homeOdds: finite(quote.homeOdds), awayOdds: finite(quote.awayOdds),
      book: quote.book, quoteObservedAt: quote.observedAt,
      homeCoverProbability: usable ? finite(row.prediction.model.home.coverGivenNoPush) : null,
      probabilitySource: 'Frozen trial probability at the recorded spread, conditional on no push',
      ...(usable ? { distribution } : {}),
      warnings: [
        'Historical/frozen trial snapshot with limited game coverage, not a live forecast feed.',
        'Recorded prices are stale and are not current executable offers; refresh the book, prices and quote time before considering a bet.',
        'Quote time was approximate. The frozen forecast and distribution have not been updated for current team news.',
        ...(!usable ? ['Invalid frozen distribution; no baseline or probability is available.'] : []),
      ],
    };
  });
}

export function adaptNbaResearch(data: NbaResearch): MatchupGame[] {
  // The export preserves chronological development order; never read other reports or final holdout data.
  const examples = data.reports.find(report => report.id === 'efficiency')?.examples.slice(0, 5) ?? [];
  return examples.map(row => ({
    id: `nba:${row.gameId}`, sport: 'nba', home: row.home, away: row.away,
    startsAt: null, status: 'Historical development example',
    sourceLabel: `NBA efficiency research · ${data.developmentSeason}`, sourceUrl: '/nba/research.json',
    baselineHomeMargin: finite(row.prediction), baselineSource: 'Pregame efficiency development-model prediction',
    // Research market is the expected home margin, not the signed home handicap.
    homeSpread: finite(row.market) === null ? null : -row.market,
    homeOdds: null, awayOdds: null, book: '', quoteObservedAt: '',
    homeCoverProbability: null, probabilitySource: 'No validated live cover probability',
    warnings: [
      'Only the first five chronological efficiency-model development examples are available; no current-season or final-holdout predictions.',
      'Historical processed spreads are not executable single-book quotes. Side prices, quote timestamps and kickoff timestamps are unavailable.',
      'Development probabilities are not validated live probabilities and are intentionally not loaded.',
    ],
  }));
}

export function getBundledMatchups(): MatchupGame[] {
  return [...adaptNflTrial(nflTrial), ...adaptNbaResearch(nbaResearch)];
}
