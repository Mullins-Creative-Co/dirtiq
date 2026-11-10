'use client';

import { useRef, useState } from 'react';
import { SPORT_LABELS, type SportId } from '@/lib/matchups/model';
import { addTicket, journalTotals, readTickets, ticketProfit, TICKET_STORAGE_KEY, type ForecastSnapshot, type Ticket } from '@/lib/matchups/tickets';

const field = 'mt-1 w-full rounded-md border border-border-strong bg-background px-3 py-2.5 text-base text-foreground';
const button = 'rounded-md border border-border-strong px-3 py-2.5 text-sm font-semibold hover:bg-surface-hover';
const empty = { matchup: '', selection: '', spread: '', odds: '', stake: '', book: '', placedAt: '', reasoning: '', review: '', returned: '' };
const money = (n: number) => `$${n.toFixed(2)}`;

export function TicketJournal({ run, sport }: { run: ForecastSnapshot | null; sport: SportId }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [draft, setDraft] = useState(empty);
  const [ticketSport, setTicketSport] = useState<SportId>(sport);
  const [status, setStatus] = useState<Ticket['status']>('open');
  const [timing, setTiming] = useState<Ticket['entryTiming']>('retrospective');
  const [snapshot, setSnapshot] = useState<ForecastSnapshot | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const draftId = useRef('');
  function load() {
    try { const rows = readTickets(localStorage.getItem(TICKET_STORAGE_KEY)); setTickets(rows); return rows; }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Journal cannot be read.'); return null; }
  }
  function start(link: boolean) {
    if (load() === null) return;
    const validRun = link && run && !run.result.errors.length ? structuredClone(run) : null;
    draftId.current = crypto.randomUUID();
    setSnapshot(validRun); setTicketSport(validRun?.input.sport ?? sport);
    setDraft({ ...empty, matchup: validRun ? `${validRun.input.away} at ${validRun.input.home}` : '', book: validRun?.input.book ?? '' });
    setStatus('open'); setTiming('retrospective'); setEditing(true); setNotice('');
  }
  function save() {
    try {
      const ticket: Ticket = { ...draft, id: draftId.current, recordedAt: new Date().toISOString(), sport: ticketSport,
        spread: draft.spread.trim() ? Number(draft.spread) : NaN, odds: draft.odds.trim() ? Number(draft.odds) : NaN,
        stake: draft.stake.trim() ? Number(draft.stake) : NaN, returned: draft.returned.trim() ? Number(draft.returned) : null,
        status, entryTiming: timing, snapshot };
      const next = addTicket(readTickets(localStorage.getItem(TICKET_STORAGE_KEY)), ticket);
      localStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(next)); setTickets(next); setEditing(false); setNotice('Ticket saved on this browser. No bet was placed.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save. Your existing journal is unchanged.'); }
  }
  function settle(id: string, returned: string) {
    const amount = returned.trim() ? Number(returned) : NaN;
    try {
      const current = readTickets(localStorage.getItem(TICKET_STORAGE_KEY));
      const ticket = current.find(t => t.id === id); if (!ticket || ticket.status !== 'open') return;
      if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) throw new Error('Enter the actual total returned, including stake.');
      // Record as cashout/settlement without inferring a sporting win from money alone.
      const next = current.map(t => t.id === id ? { ...t, status: 'cashout' as const, returned: amount } : t);
      localStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(next)); setTickets(next); setNotice('Return recorded. Original reasoning and forecast snapshot are unchanged.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not settle.'); }
  }
  function download() {
    const rows = load(); if (!rows) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, warning: 'Self-reported local journal, not verified model performance.', tickets: rows }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'dirtiq-ticket-journal.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const totals = tickets ? journalTotals(tickets) : null;
  return <section className="panel space-y-4 p-5 sm:p-6" aria-label="Ticket journal">
    <div><h2 className="text-xl font-black">Connect a ticket to your reasoning</h2><p className="mt-2 text-sm text-muted-strong">Record a bet you already placed, its result and what you expected. Link the current run to preserve its inputs and output, even when it says no probability is available.</p></div>
    <p className="text-xs text-muted">Manual, browser-only journal. No sportsbook access, automatic syncing or wagers. Nothing is uploaded. Use the same browser and export a backup; clearing browser data removes this journal. Retrospective entries are not evidence of a pregame edge.</p>
    <div className="flex flex-wrap gap-2"><button className={button} type="button" onClick={() => start(false)}>Record a ticket</button><button className={`${button} disabled:opacity-50`} type="button" disabled={!run || !!run.result.errors.length} onClick={() => start(true)}>Link current run to ticket</button><button className={button} type="button" onClick={load}>View journal</button><button className={button} type="button" onClick={download}>Export journal</button></div>
    {notice && <p role="status" className="text-sm text-amber-100">{notice}</p>}
    {editing && <form className="space-y-4 rounded-lg border border-border p-4" onSubmit={e => { e.preventDefault(); save(); }}>
      <p className="text-xs text-muted">{snapshot ? `Snapshot captured at ${snapshot.at}. Editing the matchup above will not change this ticket’s snapshot. The snapshot describes its original line, not necessarily the ticket line you enter.` : 'No forecast linked. This will not be counted as a model prediction.'}</p>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Sport<select className={field} value={ticketSport} disabled={!!snapshot} onChange={e => setTicketSport(e.target.value as SportId)}>{Object.entries(SPORT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {(['matchup', 'selection', 'spread', 'odds', 'stake', 'book', 'placedAt'] as const).map(key => <label key={key} className="text-sm">{{ matchup: 'Matchup / game date', selection: 'Selected team', spread: 'Selected team spread (signed)', odds: 'American odds', stake: 'Actual stake ($)', book: 'Sportsbook', placedAt: 'Placement time and timezone (if known)' }[key]}<input className={field} value={draft[key]} maxLength={key === 'placedAt' ? 120 : 2000} required={key !== 'placedAt'} readOnly={key === 'matchup' && !!snapshot} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
      <label className="text-sm">Entry timing<select className={field} value={timing} onChange={e => setTiming(e.target.value as Ticket['entryTiming'])}><option value="retrospective">After result / retrospective</option><option value="before-result">Before result (self-reported)</option></select></label>
      <label className="text-sm">Ticket status<select className={field} value={status} onChange={e => { setStatus(e.target.value as Ticket['status']); setDraft({ ...draft, returned: '' }); }}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option><option value="push">Push</option><option value="void">Void</option><option value="cashout">Cashout / other settlement</option></select></label>
      {status !== 'open' && <label className="text-sm">Actual total returned ($, including stake)<input className={field} required value={draft.returned} onChange={e => setDraft({ ...draft, returned: e.target.value })} /></label>}</div>
      <label className="block text-sm">Why I took this side<textarea className={field} required maxLength={2000} value={draft.reasoning} onChange={e => setDraft({ ...draft, reasoning: e.target.value })} placeholder="Your original reasoning. Label anything reconstructed after the game." /></label>
      <label className="block text-sm">After-game review / final score<textarea className={field} maxLength={2000} value={draft.review} onChange={e => setDraft({ ...draft, review: e.target.value })} placeholder="What happened? Separate observed facts from possible explanations." /></label>
      <div className="flex gap-2"><button className={button} type="submit">Save ticket locally</button><button className={button} type="button" onClick={() => { setEditing(false); setNotice('Unsaved ticket discarded. Existing records are unchanged.'); }}>Cancel</button></div>
    </form>}
    {totals && <p className="text-sm">{totals.settled} settled · {totals.open} open · Net {money(totals.profit)} · Return on settled stake {totals.roi === null ? 'unavailable' : `${(100 * totals.roi).toFixed(1)}%`}<span className="mt-1 block text-xs text-muted">All manually logged tickets, including hindsight entries. This is your journal, not a validated model track record.</span></p>}
    {tickets?.length === 0 && <p className="text-sm text-muted">No tickets recorded in this browser yet.</p>}
    <ul className="space-y-3">{tickets?.map(t => <li className="rounded-lg border border-border p-4" key={t.id}>
      <p className="font-bold">{SPORT_LABELS[t.sport]} · {t.selection} {t.spread > 0 ? '+' : ''}{t.spread} · {t.odds > 0 ? '+' : ''}{t.odds}</p><p className="text-sm text-muted-strong">{t.matchup} · {t.book} · {money(t.stake)} staked · {t.status === 'cashout' ? 'cashout / other settlement' : t.status}</p>
      <p className="mt-1 text-sm">Returned {t.returned === null ? 'pending' : money(t.returned)} · Net {ticketProfit(t) === null ? 'pending' : money(ticketProfit(t)!)}</p>
      <p className="mt-2 text-xs text-muted">{t.entryTiming === 'retrospective' ? 'Retrospective entry' : 'Before result, self-reported'} · Recorded {t.recordedAt} · {t.snapshot ? `Linked run: ${t.snapshot.at}` : 'No forecast linked'}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm">Reasoning: {t.reasoning}</p>{t.review && <p className="mt-2 whitespace-pre-wrap text-sm">Review: {t.review}</p>}
      {t.snapshot && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">View linked forecast and limitations</summary><p className="mt-2 text-xs text-muted">Preserved at {t.snapshot.at}. This does not establish that the forecast preceded the game. Ticket prices may differ from the original quote.</p><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(t.snapshot, null, 2)}</pre></details>}
      {t.status === 'open' && <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; settle(t.id, String(new FormData(form).get('returned') ?? '')); }}><label className="text-sm">Total returned ($, includes stake)<input className={field} name="returned" required /></label><button className={button} type="submit">Record settlement</button></form>}
    </li>)}</ul>
  </section>;
}
