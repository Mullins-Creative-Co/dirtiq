import type { MatchupInput, RunResult, SportId } from './model.ts';

export type ForecastSnapshot = { input: MatchupInput; result: RunResult; at: string };
export type Ticket = {
  id: string; recordedAt: string; sport: SportId; matchup: string;
  selection: string; spread: number; odds: number; stake: number; book: string;
  placedAt: string; reasoning: string; review: string;
  status: 'open' | 'won' | 'lost' | 'push' | 'void' | 'cashout';
  returned: number | null;
  // Local journal timestamps are not independently verified prospective evidence.
  entryTiming: 'before-result' | 'retrospective';
  snapshot: ForecastSnapshot | null;
};
export const TICKET_STORAGE_KEY = 'dirtiq.matchups.tickets.v1';
export function ticketErrors(t: Ticket): string[] {
  const errors: string[] = [];
  for (const key of ['id', 'recordedAt', 'matchup', 'selection', 'book', 'reasoning'] as const) {
    if (typeof t[key] !== 'string' || !t[key].trim() || t[key].length > 2000) errors.push(`${key} is required (up to 2,000 characters).`);
  }
  if (!['nfl', 'nba', 'ncaaf', 'ncaab'].includes(t.sport)) errors.push('Choose a supported sport.');
  if (!Number.isFinite(t.spread) || Math.abs(t.spread) > 150) errors.push('Enter the selected team’s spread within ±150.');
  if (!Number.isSafeInteger(t.odds) || Math.abs(t.odds) < 100) errors.push('Enter valid American odds, such as -105.');
  if (!Number.isFinite(t.stake) || t.stake <= 0 || t.stake > 1000000) errors.push('Stake must be greater than zero and at most 1,000,000.');
  if (!['open', 'won', 'lost', 'push', 'void', 'cashout'].includes(t.status)) errors.push('Choose a settlement status.');
  if (!['before-result', 'retrospective'].includes(t.entryTiming)) errors.push('Choose entry timing.');
  if (t.status === 'open' ? t.returned !== null : t.returned === null || !Number.isFinite(t.returned) || t.returned < 0 || t.returned > 100000000) errors.push('Settled tickets need the actual total returned, including stake; open tickets must leave it blank.');
  if (t.status === 'lost' && t.returned !== 0) errors.push('A lost ticket must have zero returned. Use cashout for partial returns.');
  if ((t.status === 'push' || t.status === 'void') && t.returned !== t.stake) errors.push('A push or void must return the stake.');
  if (t.status === 'won' && t.returned !== null && t.returned <= t.stake) errors.push('A won ticket must return more than the stake.');
  if (typeof t.review !== 'string' || t.review.length > 2000 || typeof t.placedAt !== 'string' || t.placedAt.length > 120) errors.push('Review or placement time is invalid.');
  if (t.snapshot !== null && (!t.snapshot || typeof t.snapshot.at !== 'string' || !t.snapshot.input || !t.snapshot.result || !Array.isArray(t.snapshot.result.errors) || t.snapshot.result.errors.length)) errors.push('Linked forecast snapshot is invalid.');
  return errors;
}
export function ticketProfit(t: Ticket): number | null {
  return t.returned === null ? null : Math.round((t.returned - t.stake) * 100) / 100;
}
export function readTickets(raw: string | null): Ticket[] {
  if (!raw) return [];
  if (raw.length > 5000000) throw new Error('Journal is too large. Export before adding more tickets.');
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 1000 || data.some(t => !t || typeof t !== 'object' || ticketErrors(t as Ticket).length)) throw new Error('Journal could not be read. Existing records have not been overwritten.');
  return data as Ticket[];
}
export function addTicket(existing: Ticket[], ticket: Ticket): Ticket[] {
  const errors = ticketErrors(ticket);
  if (errors.length) throw new Error(errors.join(' '));
  if (existing.length >= 1000) throw new Error('Journal is full. Export your records.');
  if (existing.some(t => t.id === ticket.id)) return existing;
  // Deep copy the forecast so later input changes cannot rewrite the saved evidence.
  const next = [structuredClone(ticket), ...existing];
  if (JSON.stringify(next).length > 5000000) throw new Error('Journal is full. Export your records.');
  return next;
}
export function journalTotals(tickets: Ticket[]) {
  const settled = tickets.filter(t => t.status !== 'open');
  const stake = settled.reduce((sum, t) => sum + t.stake, 0);
  const profit = settled.reduce((sum, t) => sum + (ticketProfit(t) ?? 0), 0);
  return { settled: settled.length, open: tickets.length - settled.length, stake, profit: Math.round(profit * 100) / 100, roi: stake ? profit / stake : null };
}
