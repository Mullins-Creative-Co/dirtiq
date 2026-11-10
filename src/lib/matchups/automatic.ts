import type { MatchupGame } from './catalog.ts';
/** A margin regression is not a calibrated cover probability. Never inherit prices. */
export function attachAutomaticForecasts(games: MatchupGame[], artifact: unknown, now: string): MatchupGame[] {
  const a = artifact as { version?: number; generatedAt?: string; expiresAt?: string; forecasts?: unknown[] } | null;
  const clock = Date.parse(now), generated = Date.parse(a?.generatedAt ?? ''), expires = Date.parse(a?.expiresAt ?? '');
  const usable = a?.version === 1 && Number.isFinite(clock) && generated <= clock && expires > clock && expires-generated <= 6*3600000 && Array.isArray(a.forecasts);
  return games.map(game => {
    if (game.sport !== 'nfl') return { ...game, warnings: [`Automatic ${game.sport.toUpperCase()} model inputs are not connected; schedule data is not a forecast.`, ...game.warnings] };
    const matching = usable ? a.forecasts!.filter(raw => raw && typeof raw === 'object' && (raw as { id?: string }).id === game.id) : [];
    const row = (matching.length === 1 ? matching[0] : null) as { predicted?: number; startsAt?: string; featureAsOf?: string; generatedAt?: string; modelVersion?: string; trainCount?: number; homeLatestGame?: string; awayLatestGame?: string } | null;
    const start = Date.parse(game.startsAt ?? '');
    const valid = row && Date.parse(row.startsAt ?? '') === start && start > clock && Date.parse(row.featureAsOf ?? '') <= generated && Date.parse(row.generatedAt ?? '') === generated
      && typeof row.predicted === 'number' && Number.isFinite(row.predicted) && Math.abs(row.predicted) <= 100
      && row.modelVersion === 'nfl-team-epa-development-v1' && Number.isInteger(row.trainCount) && row.trainCount! >= 80;
    if (!valid) return { ...game, warnings: ['No fresh automatic pregame NFL forecast matched this game. Run a manual scenario only with an independent sourced baseline.', ...game.warnings] };
    return { ...game, sourceLabel: 'ESPN schedule + automatic NFL Team EPA', baselineHomeMargin: row.predicted!, baselineSource: `Automatic NFL Team EPA regression (${row.modelVersion}); ${row.trainCount} development games; inputs as of ${row.featureAsOf}; generated ${row.generatedAt}`,
      baselineKind: 'automatic' as const, automaticExpiresAt: a!.expiresAt, homeSpread: null, homeOdds: null, awayOdds: null, book: '', quoteObservedAt: '', homeCoverProbability: null,
      probabilitySource: 'No calibrated live cover-probability model', distribution: undefined,
      warnings: [`Automatic experimental point projection. Refreshed ${row.generatedAt}; expires ${a!.expiresAt}.`, `Latest eligible games: ${row.homeLatestGame ?? 'unknown'} / ${row.awayLatestGame ?? 'unknown'}.`,
        'Team offense/defense EPA and home field only. No current starter, injury, weather or sportsbook feed. Do not add defense/turnover points already reflected in EPA without an independently tested residual feature.',
        'Frozen development fit, not a validated profitable edge. No cover probability or price edge is inferred from a point margin.',
        'NBA and college forecasts and outside-model comparisons require separate authorized data feeds. Betting splits are not cover probabilities.', ...game.warnings.filter(w => !w.startsWith('Schedule only.'))] };
  });
}
export function automaticBaselineIsCurrent(game: MatchupGame, now: string): boolean {
  const clock = Date.parse(now);
  return game.baselineKind === 'automatic' && Number.isFinite(clock) && Date.parse(game.automaticExpiresAt ?? '') > clock && Date.parse(game.startsAt ?? '') > clock;
}
