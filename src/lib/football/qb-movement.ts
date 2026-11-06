/** QB-news event studies. No bookmaker model or causal news effect is assumed. */
export type Quote = {
  snapshotAt: string; updatedAt: string; bookmaker: string;
  homeMargin: number; homeOdds: number; awayOdds: number; source: string;
};
export type QbEvent = {
  id: string; gameId: string; season: number; week: number; kickoff: string;
  homeTeam: string; awayTeam: string; changedSide: 'home' | 'away'; oldQb: string; newQb: string;
  announcedAt: string; observedAt: string; announcementSource: string;
  modelVersion: string; modelFrozenAt: string; baselineAsOf: string; estimateAsOf: string;
  modelBefore: number; qbDeltaHomeMargin: number; otherDeltaHomeMargin: number;
  estimateSource: string; otherNewsReviewed: boolean; otherNewsSource: string;
  before: Quote; after: Quote;
  actualHomeMargin?: number; resultAvailableAt?: string;
};
export type MovementResult = {
  event: QbEvent; decisionAt: string; marketMove: number; modelMove: number;
  qbMovementGap: number; totalMovementGap: number; baselineEdge: number; afterEdge: number;
  selectedSide: 'home' | 'away' | null; selectedTeam: string | null;
  settled: boolean; marketError: number | null; units: number | null;
};

const minute = 60_000;
const stamp = (s: unknown, label: string) => {
  if (typeof s !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(s) || !Number.isFinite(Date.parse(s))) throw new Error(`${label}: use an ISO timestamp with timezone.`);
  return Date.parse(s);
};
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error(`${label}: supply a nonempty source or identifier.`);
}
function number(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}: supply a finite number.`);
  if (Math.abs(value) > 1_000_000) throw new Error(`${label}: value is outside the supported range.`);
}
function odds(value: unknown, label: string) {
  number(value, label);
  if (Math.abs(value as number) < 100) throw new Error(`${label}: use American odds of +100 or greater, or −100 or less.`);
}

export function validateEvent(input: unknown): QbEvent {
  if (!input || typeof input !== 'object') throw new Error('Each event must be an object.');
  const e = input as QbEvent;
  for (const key of ['id', 'gameId', 'homeTeam', 'awayTeam', 'oldQb', 'newQb', 'announcementSource', 'modelVersion', 'estimateSource', 'otherNewsSource'] as const) text(e[key], key);
  if (e.homeTeam === e.awayTeam || e.oldQb === e.newQb || !['home', 'away'].includes(e.changedSide)) throw new Error('Specify distinct teams and a real QB change on home or away.');
  if (!Number.isInteger(e.season) || !Number.isInteger(e.week) || e.week < 1 || e.week > 22) throw new Error('Season and week must be valid integers.');
  // Guard before reading any final-test quote, model feature, or result.
  if (e.season > 2025 || e.season === 2025 && e.week >= 10) throw new Error('This development study excludes 2025 week 10 onward and later seasons.');
  const kickoff = stamp(e.kickoff, 'kickoff');
  const announced = stamp(e.announcedAt, 'announcedAt');
  const observed = stamp(e.observedAt, 'observedAt');
  if (observed < announced) throw new Error('observedAt cannot precede the public announcement.');
  const decision = observed+30*minute;
  if (decision >= kickoff) throw new Error('The fixed 30-minute decision must precede kickoff.');
  if (stamp(e.modelFrozenAt, 'modelFrozenAt') >= announced) throw new Error('Freeze model parameters before the announcement.');
  const baseline = stamp(e.baselineAsOf, 'baselineAsOf');
  const estimate = stamp(e.estimateAsOf, 'estimateAsOf');
  if (baseline >= announced || estimate < observed || estimate > decision) throw new Error('Model baseline must precede news; revised estimate must be available by the decision.');
  for (const key of ['modelBefore', 'qbDeltaHomeMargin', 'otherDeltaHomeMargin'] as const) number(e[key], key);
  if (typeof e.otherNewsReviewed !== 'boolean') throw new Error('Record whether other contemporaneous news was reviewed.');
  for (const key of ['before', 'after'] as const) {
    const q = e[key];
    if (!q || typeof q !== 'object') throw new Error(`Missing ${key} quote.`);
    text(q.bookmaker, `${key}.bookmaker`); text(q.source, `${key}.source`);
    number(q.homeMargin, `${key}.homeMargin`); odds(q.homeOdds, `${key}.homeOdds`); odds(q.awayOdds, `${key}.awayOdds`);
    const snapshot = stamp(q.snapshotAt, `${key}.snapshotAt`);
    const updated = stamp(q.updatedAt, `${key}.updatedAt`);
    if (updated > snapshot || snapshot-updated > 10*minute) throw new Error(`${key}: quote update must be within 10 minutes before its snapshot.`);
    if (key === 'before' && (snapshot >= announced || announced-snapshot > 60*minute || baseline > snapshot)) throw new Error('Use a baseline available by a pre-announcement quote within the prior 60 minutes.');
    if (key === 'after' && (snapshot < observed || snapshot > decision || decision-snapshot > 10*minute || updated < observed)) throw new Error('Use a refreshed post-news quote within 10 minutes before the fixed decision.');
  }
  if (e.before.bookmaker !== e.after.bookmaker) throw new Error('Use the same bookmaker before and after news.');
  if (e.actualHomeMargin !== undefined) {
    number(e.actualHomeMargin, 'actualHomeMargin');
    if (stamp(e.resultAvailableAt, 'resultAvailableAt') <= kickoff) throw new Error('A result must become available after kickoff.');
  } else if (e.resultAvailableAt !== undefined) throw new Error('Result availability requires a result.');
  return e;
}

export function parseEvents(raw: string): QbEvent[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 5000) throw new Error('Import a JSON array of up to 5,000 events.');
  const ids = new Set<string>(); const games = new Set<string>();
  return data.map((value, index) => {
    try {
      const e = validateEvent(value);
      if (e.id.startsWith('SYNTHETIC') || e.gameId.startsWith('SYNTHETIC')) throw new Error('Replace fictional example records with sourced real events before importing.');
      if (ids.has(e.id) || games.has(e.gameId)) throw new Error('Use one event per game to avoid repeated-game counting.');
      ids.add(e.id); games.add(e.gameId); return e;
    } catch (error) { throw new Error(`Event ${index+1}: ${error instanceof Error ? error.message : 'Invalid record'}`); }
  });
}

export function studyEvent(event: QbEvent): MovementResult {
  const e = validateEvent(event);
  const marketMove = e.after.homeMargin-e.before.homeMargin;
  const modelMove = e.qbDeltaHomeMargin+e.otherDeltaHomeMargin;
  const baselineEdge = e.modelBefore-e.before.homeMargin;
  const totalMovementGap = modelMove-marketMove;
  const afterEdge = baselineEdge+totalMovementGap;
  // Fixed research rule. Do not select on the size of movement alone.
  const selectedSide = e.otherNewsReviewed && Math.abs(afterEdge) >= 2 ? afterEdge > 0 ? 'home' : 'away' : null;
  const settled = e.actualHomeMargin !== undefined;
  const marketError = selectedSide && settled ? (selectedSide === 'home' ? 1 : -1)*(e.actualHomeMargin!-e.after.homeMargin) : null;
  const price = selectedSide === 'home' ? e.after.homeOdds : e.after.awayOdds;
  const units = marketError === null ? null : marketError > 0 ? price > 0 ? price/100 : 100/Math.abs(price) : marketError < 0 ? -1 : 0;
  return { event: e, decisionAt: new Date(Date.parse(e.observedAt)+30*minute).toISOString(), marketMove, modelMove, qbMovementGap: e.qbDeltaHomeMargin-marketMove, totalMovementGap, baselineEdge, afterEdge, selectedSide,
    selectedTeam: selectedSide === 'home' ? e.homeTeam : selectedSide === 'away' ? e.awayTeam : null, settled, marketError, units };
}

export function summarizeMovement(results: MovementResult[]) {
  const selected = results.filter(r => r.selectedSide !== null);
  const settled = selected.filter(r => r.marketError !== null);
  const wins = settled.filter(r => r.marketError! > 0).length;
  const losses = settled.filter(r => r.marketError! < 0).length;
  return { events: results.length, selected: selected.length, pending: selected.length-settled.length, settled: settled.length, wins, losses, pushes: settled.length-wins-losses,
    coverRate: wins+losses ? wins/(wins+losses) : null,
    roi: settled.length ? settled.reduce((s, r) => s+r.units!, 0)/settled.length : null };
}

/** Deliberately fictional, unsettled example; never merged into real results. */
export const movementDemo: QbEvent = {
  id: 'SYNTHETIC-example', gameId: 'SYNTHETIC-game', season: 2024, week: 1,
  kickoff: '2024-09-08T17:00:00Z', homeTeam: 'Example home', awayTeam: 'Example away', changedSide: 'home', oldQb: 'Example starter', newQb: 'Example backup',
  announcedAt: '2024-09-06T16:00:00Z', observedAt: '2024-09-06T16:01:00Z', announcementSource: 'Synthetic example — no real announcement',
  modelVersion: 'Synthetic illustration', modelFrozenAt: '2024-09-01T00:00:00Z', baselineAsOf: '2024-09-06T15:45:00Z', estimateAsOf: '2024-09-06T16:10:00Z',
  modelBefore: 3, qbDeltaHomeMargin: -4, otherDeltaHomeMargin: 0, estimateSource: 'Illustrative four-point home QB downgrade', otherNewsReviewed: true, otherNewsSource: 'Synthetic example assumes no other changes',
  before: { snapshotAt: '2024-09-06T15:55:00Z', updatedAt: '2024-09-06T15:54:00Z', bookmaker: 'Example book', homeMargin: 3, homeOdds: -110, awayOdds: -110, source: 'Synthetic quote' },
  after: { snapshotAt: '2024-09-06T16:30:00Z', updatedAt: '2024-09-06T16:29:00Z', bookmaker: 'Example book', homeMargin: -3, homeOdds: -110, awayOdds: -110, source: 'Synthetic quote' },
};
