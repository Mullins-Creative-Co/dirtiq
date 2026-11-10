'use client';

import Link from 'next/link';
import { automaticBaselineIsCurrent } from '@/lib/matchups/automatic';
import { MatchupBreakdown } from './breakdown';
import { TicketJournal } from './ticket-journal';
import { useEffect, useRef, useState } from 'react';
import type { MatchupGame } from '@/lib/matchups/catalog';
import { runMatchup, SPORT_LABELS, type Adjustment, type MatchupInput, type SportId } from '@/lib/matchups/model';

type Fields = {
  home: string; away: string; baseline: string; baselineSource: string;
  spread: string; homeOdds: string; awayOdds: string; book: string;
  quoteTime: string; probability: string; probabilitySource: string;
};
type Draft = { fields: Fields; adjustments: Adjustment[]; game: MatchupGame | null; modified?: boolean };
type SavedRun = { key: string; savedAt: string; sport: SportId; draft: Draft };
type Run = { input: MatchupInput; result: ReturnType<typeof runMatchup>; at: string };
const STORAGE_KEY = 'dirtiq.matchups.runs.v1';
const blank: Fields = { home: '', away: '', baseline: '', baselineSource: '', spread: '', homeOdds: '', awayOdds: '', book: '', quoteTime: '', probability: '', probabilitySource: '' };
const inputClass = 'mt-1 w-full rounded-md border border-border-strong bg-background px-3 py-2.5 text-base text-foreground focus:outline-2 focus:outline-accent sm:text-sm';
const buttonClass = 'rounded-md border border-border-strong px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-surface-hover focus:outline-2 focus:outline-accent disabled:opacity-50';
const string = (v: number | null) => v === null ? '' : String(v);
const number = (v: string) => v.trim() === '' ? null : Number(v);
const signed = (v: number | null) => v === null ? 'Unavailable' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
const pct = (v: number | null) => v === null ? 'Unavailable' : `${(v * 100).toFixed(1)}%`;
const price = (v: number | null) => v === null ? 'No price' : `${v > 0 ? '+' : ''}${v}`;
const dateLabel = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Date not supplied';

function factors(sport: SportId): Adjustment[] {
  const football = sport === 'nfl' || sport === 'ncaaf';
  return [
    ['lineup', football ? 'QB, blockers and supporting lineup' : 'Player availability and replacement minutes'],
    ['efficiency', 'Team efficiency and opponent strength'],
    ['matchup', football ? 'Protection, pressure and style matchup' : 'Pace, shot profile and style matchup'],
    ['context', football ? 'Venue, rest, travel and weather' : 'Home court, rest and travel'],
  ].map(([id, label]) => ({ id, label, status: 'unknown', points: null, reason: '' }));
}

function safeSavedRuns(): SavedRun[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  if (raw.length > 250000) throw new Error('Saved runs are too large to load.');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Saved runs could not be read.');
  return parsed.slice(0, 20).filter((v): v is SavedRun => {
    if (!v || typeof v !== 'object') return false;
    const r = v as SavedRun;
    return typeof r.key === 'string' && typeof r.savedAt === 'string' && Object.hasOwn(SPORT_LABELS, r.sport)
      && r.draft && Object.keys(blank).every(key => typeof r.draft.fields?.[key] === 'string')
      && Array.isArray(r.draft.adjustments) && r.draft.adjustments.length === 4
      && r.draft.adjustments.every(a => a && typeof a.id === 'string' && typeof a.label === 'string' && typeof a.reason === 'string' && ['unknown', 'included', 'new'].includes(a.status) && (a.points === null || Number.isFinite(a.points)))
      && (r.draft.game === null || (typeof r.draft.game?.id === 'string' && ['sourceLabel', 'status', 'home', 'away'].every(key => typeof r.draft.game?.[key] === 'string') && (r.draft.game.startsAt === null || typeof r.draft.game.startsAt === 'string') && Array.isArray(r.draft.game?.warnings) && r.draft.game.warnings.every(w => typeof w === 'string')));
  });
}

export function MatchupWorkbench({ archivedGames, today }: { archivedGames: MatchupGame[]; today: string }) {
  const [sport, setSport] = useState<SportId>('nfl');
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<'schedule' | 'archive'>('schedule');
  const [query, setQuery] = useState('');
  const [games, setGames] = useState<MatchupGame[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [draft, setDraft] = useState<Draft>({ fields: blank, adjustments: factors('nfl'), game: null });
  const [run, setRun] = useState<Run | null>(null);
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<SavedRun[] | null>(null);
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  const resultRef = useRef<HTMLElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function cancelLookup() {
    request.current += 1;
    controller.current?.abort();
    setLoading(false);
  }
  function clearRun() { setRun(null); setNotice('Inputs changed. Run the matchup to update the result.'); }
  function changeSport(next: SportId) {
    cancelLookup(); setSport(next); setGames([]); setLoaded(false); setLookupError(''); setQuery('');
    setDraft({ fields: blank, adjustments: factors(next), game: null }); setRun(null); setNotice('');
  }
  function newMatchup() {
    setDraft({ fields: blank, adjustments: factors(sport), game: null }); setRun(null); setNotice('Enter teams and a sourced baseline to run a manual scenario.');
  }
  function selectGame(game: MatchupGame) {
    setDraft({ game, fields: {
      home: game.home, away: game.away, baseline: string(game.baselineHomeMargin), baselineSource: game.baselineSource,
      spread: string(game.homeSpread), homeOdds: string(game.homeOdds), awayOdds: string(game.awayOdds), book: game.book,
      quoteTime: game.quoteObservedAt, probability: game.homeCoverProbability === null ? '' : String(game.homeCoverProbability * 100), probabilitySource: game.probabilitySource,
    }, adjustments: factors(sport).map(factor => game.baselineKind === 'automatic' && factor.id === 'efficiency' ? { ...factor, label: 'Team offense/defense EPA (not opponent-adjusted)', status: 'included', reason: 'Already included in the automatic Team EPA baseline.' } : factor) }); setRun(null); setNotice('Game loaded. Review the inputs, then run the matchup.');
  }
  function edit(key: keyof Fields, value: string) {
    clearRun();
    setDraft(current => {
      if (key === 'home' || key === 'away') {
        // Forecasts and book quotes belong to a specific pair of teams.
        return { game: null, adjustments: factors(sport), fields: { ...blank, home: current.fields.home, away: current.fields.away, [key]: value } };
      }
      const changedModel = ['baseline', 'baselineSource'].includes(key);
      const changedProbability = changedModel || key === 'spread';
      return { ...current,
        game: changedModel && current.game ? { ...current.game, distribution: undefined } : current.game,
        modified: current.modified || changedModel,
        fields: { ...current.fields, ...(key === 'baseline' ? { baselineSource: '' } : {}), ...(changedProbability ? { probability: '', probabilitySource: '' } : {}), [key]: value },
      };
    });
  }
  function adjust(index: number, patch: Partial<Adjustment>) {
    clearRun();
    setDraft(current => ({ ...current, modified: true, fields: { ...current.fields, probability: '', probabilitySource: '' }, adjustments: current.adjustments.map((a, i) => i === index ? { ...a, ...patch } : a) }));
  }
  async function findGames() {
    cancelLookup();
    const sequence = request.current;
    const abort = new AbortController(); controller.current = abort;
    setLoading(true); setLookupError(''); setGames([]); setLoaded(false); setMode('schedule');
    try {
      const response = await fetch(`/api/matchups?sport=${sport}&date=${date}`, { signal: abort.signal });
      const payload = await response.json();
      if (sequence !== request.current) return;
      if (!response.ok || payload.error || !Array.isArray(payload.games)) throw new Error(payload.error || 'The schedule could not be loaded.');
      setGames(payload.games); setLoaded(true);
    } catch (error) {
      if (sequence === request.current && !abort.signal.aborted) setLookupError(error instanceof Error ? error.message : 'The schedule could not be loaded.');
    } finally { if (sequence === request.current) setLoading(false); }
  }
  function execute() {
    if (!draft.modified && draft.game?.baselineKind === 'automatic' && !automaticBaselineIsCurrent(draft.game, new Date().toISOString())) {
      setRun(null); setNotice('This automatic forecast expired or the game started. Find games again to refresh; no current projection was produced.'); return;
    }
    const f = draft.fields;
    const input: MatchupInput = {
      sport, home: f.home, away: f.away, baselineKind: !draft.modified ? draft.game?.baselineKind : undefined, baselineHomeMargin: number(f.baseline), baselineSource: f.baselineSource,
      adjustments: draft.adjustments, homeSpread: number(f.spread), homeOdds: number(f.homeOdds), awayOdds: number(f.awayOdds),
      book: f.book, quoteObservedAt: f.quoteTime, homeCoverProbability: f.probability.trim() ? Number(f.probability) / 100 : null,
      probabilitySource: f.probabilitySource, distribution: draft.game?.distribution,
    };
    setRun({ input, result: runMatchup(input), at: new Date().toISOString() });
    setNotice('');
    requestAnimationFrame(() => resultRef.current?.focus());
  }
  function saveRun() {
    if (!run || run.result.errors.length) return;
    try {
      const key = `${sport}:${draft.game?.id ?? `${draft.fields.away.toLowerCase()}@${draft.fields.home.toLowerCase()}`}`;
      const next = [{ key, savedAt: run.at, sport, draft }, ...safeSavedRuns().filter(item => item.key !== key)].slice(0, 20);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaved(next); setNotice('Saved on this browser. Saving the same matchup replaces its previous saved scenario.');
    } catch { setNotice('This browser could not save the run. You can still download it.'); }
  }
  function downloadRun() {
    if (!run) return;
    const blob = new Blob([JSON.stringify({ version: 1, ...run, originalSource: draft.game, modified: draft.modified ?? false, warning: 'Research scenario, not a validated betting recommendation.' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `dirtiq-${sport}-matchup.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const f = draft.fields;
  const visibleGames = (mode === 'archive' ? archivedGames.filter(game => game.sport === sport) : games).filter(game => `${game.home} ${game.away} ${game.id}`.toLowerCase().includes(query.toLowerCase().trim()));
  const result = run?.result;
  const home = f.home.trim() || 'Home'; const away = f.away.trim() || 'Away';

  return <div className="space-y-6">
    <header className="border-b border-border pb-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div>
        <p className="text-xs font-black uppercase tracking-[.2em] text-accent">One workspace · every matchup</p>
        <h1 className="mt-3 font-display text-4xl font-black sm:text-5xl">Find a game. Run the matchup.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-strong">Review a matchup before the game: a sourced projection, the exact line and price, what supports the lean, and what could change it.</p>
      </div><Link href="/bet" className={buttonClass}>Dirt racing ↗</Link></div>
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Choose a sport">{(Object.entries(SPORT_LABELS) as [SportId, string][]).map(([id, label]) => <button type="button" key={id} aria-pressed={sport === id} onClick={() => changeSport(id)} className={`${buttonClass} ${sport === id ? 'border-accent bg-accent text-white' : 'text-muted-strong'}`}>{label}</button>)}</div>
      <p className="mt-4 rounded-lg border border-amber-400/25 p-3 text-sm leading-relaxed text-muted-strong"><strong>Automatic NFL baseline when fresh inputs are available.</strong> Find games to load a pregame team-efficiency projection. This is experimental, not a validated edge: current book quotes, confirmed lineups and calibrated cover probabilities are not connected. NBA and college still need a sourced manual baseline. Outside models are manual comparisons, not an automated consensus.</p>
      <p className="mt-4 text-xs leading-relaxed text-muted">Shared workflow, sport-specific evidence. NFL frozen trial forecasts and NBA research examples are connected. Fresh NFL Team EPA inputs can load automatically. Confirmed lineups, live sportsbook prices and other-sport current model inputs are not connected. Nothing here establishes a validated edge.</p>
    </header>

    <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <section className="panel p-4">
          <h2 className="text-lg font-bold">Find a game</h2>
          <div className="mt-3 flex gap-2">{(['schedule', 'archive'] as const).map(value => <button type="button" key={value} className={`${buttonClass} flex-1 px-2 ${mode === value ? 'border-accent text-white' : 'text-muted'}`} aria-pressed={mode === value} onClick={() => { cancelLookup(); setMode(value); setQuery(''); }}>{value === 'schedule' ? 'Schedule' : 'Saved forecasts'}</button>)}</div>
          {mode === 'schedule' ? <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void findGames(); }}>
            <label className="block text-sm font-medium">Schedule date (ESPN)<input type="date" required className={inputClass} value={date} onChange={event => { cancelLookup(); setDate(event.target.value); setGames([]); setLoaded(false); setLookupError(''); }} /></label>
            <button type="submit" disabled={loading} className={`${buttonClass} w-full bg-surface-raised`}>{loading ? 'Finding games…' : 'Find games'}</button>
            {loading && <button type="button" className={`${buttonClass} w-full`} onClick={cancelLookup}>Cancel lookup</button>}
            <p className="text-xs leading-relaxed text-muted">Public ESPN schedule day. Start times below are UTC. A listed game does not imply available model inputs or a verified book offer.</p>
          </form> : <p className="mt-4 text-xs leading-relaxed text-muted">Limited archived forecasts, not today’s picks. NFL quotes are frozen at their recorded times. NBA includes five early primary-model examples only.</p>}
          <label className="mt-4 block text-sm font-medium">Search teams or game ID<input type="search" value={query} placeholder="Team or abbreviation" className={inputClass} onChange={event => setQuery(event.target.value)} /></label>
          <div aria-live="polite" className="mt-3 space-y-2">
            {lookupError && mode === 'schedule' && <p role="alert" className="rounded border border-amber-400/30 p-3 text-sm text-amber-100">{lookupError} Try again, use a saved forecast, or enter a matchup manually.</p>}
            {mode === 'schedule' && !loaded && !loading && !lookupError && <p className="py-3 text-sm text-muted">Choose a date and select Find games.</p>}
            {(loaded || mode === 'archive') && !visibleGames.length && <p className="py-3 text-sm text-muted">{query ? 'No matching teams. Try a different search.' : mode === 'archive' ? 'No bundled forecasts for this sport yet. Use the schedule or a manual scenario.' : 'No games returned for this date. Try another date or enter a matchup.'}</p>}
            <ul className="max-h-[480px] space-y-2 overflow-y-auto">{visibleGames.map(game => <li key={game.id}><button type="button" onClick={() => selectGame(game)} className={`w-full rounded-md border p-3 text-left hover:bg-surface-hover ${draft.game?.id === game.id ? 'border-accent bg-surface-raised' : 'border-border'}`} aria-pressed={draft.game?.id === game.id}>
              <span className="block text-sm font-bold">{game.away} <span className="font-normal text-muted">at</span> {game.home}</span>
              <span className="mt-1 block text-xs text-muted">{dateLabel(game.startsAt)}</span>
              <span className="mt-2 block text-[11px] text-muted-strong">{game.baselineHomeMargin === null ? 'Model inputs needed' : 'Research forecast'} · {game.status}</span>
            </button></li>)}</ul>
          </div>
          <button type="button" onClick={newMatchup} className={`${buttonClass} mt-4 w-full`}>Enter a matchup manually</button>
        </section>
        <section className="panel p-4"><button type="button" className="w-full text-left text-sm font-bold" onClick={() => { if (saved !== null) { setSaved(null); return; } try { setSaved(safeSavedRuns()); } catch { setNotice('Saved runs could not be read in this browser.'); } }} aria-expanded={saved !== null}>Your saved runs <span className="float-right">{saved === null ? '+' : '−'}</span></button>
          {saved !== null && <><p className="mt-2 text-xs text-muted">Up to 20 scenarios, only on this browser. Loading a run does not refresh its data.</p>{!saved.length && <p className="mt-3 text-sm text-muted">No saved runs yet.</p>}<ul className="mt-3 space-y-2">{saved.map(item => <li key={item.key}><button type="button" className={`${buttonClass} w-full text-left`} onClick={() => { cancelLookup(); setSport(item.sport); setDraft(item.draft); setGames([]); setLoaded(false); setQuery(''); setLookupError(''); setRun(null); setNotice('Saved scenario restored. Check the timestamps and run it again.'); }}><span className="block text-xs text-accent">{SPORT_LABELS[item.sport]}</span>{item.draft.fields.away} at {item.draft.fields.home}<span className="mt-1 block text-xs font-normal text-muted">Saved {dateLabel(item.savedAt)}</span></button></li>)}</ul></>}
        </section>
        <nav aria-label="Research details" className="flex flex-wrap gap-4 px-1 text-xs text-muted"><Link className="underline" href="/football">Football research</Link><Link className="underline" href="/nba">NBA research</Link><Link className="underline" href="/football/nfl-trial">NFL trial ledger</Link></nav>
      </aside>

      <div className="min-w-0 space-y-4">
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-accent">{SPORT_LABELS[sport]} · {draft.modified ? 'Modified research scenario' : draft.game ? draft.game.sourceLabel : 'Manual scenario'}</p><h2 className="mt-2 text-2xl font-black">{f.home || f.away ? `${away} at ${home}` : 'Build your matchup'}</h2></div><span className="rounded border border-amber-400/30 px-2.5 py-1 text-xs text-amber-100">Experimental</span></div>
          {draft.game && <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted"><p>{dateLabel(draft.game.startsAt)} · {draft.modified ? `Original source: ${draft.game.sourceLabel}` : draft.game.status}</p>{draft.game.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
          <form className="mt-5 space-y-5" onSubmit={event => { event.preventDefault(); execute(); }}>
            <div className="grid gap-3 sm:grid-cols-2">{([['away', 'Away team'], ['home', 'Home team']] as const).map(([key, label]) => <label key={key} className="text-sm font-medium">{label}<input className={inputClass} value={f[key]} maxLength={100} onChange={e => edit(key, e.target.value)} required /></label>)}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">Baseline home margin<input className={inputClass} type="number" step="any" placeholder="e.g. 4.5" value={f.baseline} onChange={e => edit('baseline', e.target.value)} /><span className="mt-1 block text-xs font-normal text-muted">Home score minus away score. Positive favors home. No model baseline? Leave blank.</span></label>
              <label className="text-sm font-medium">Baseline source / model version<input className={inputClass} value={f.baselineSource} placeholder="Where this projection comes from" onChange={e => edit('baselineSource', e.target.value)} /></label>
            </div>
            <fieldset className="rounded-lg border border-border p-4"><legend className="px-2 text-sm font-bold">Compare the sportsbook quote</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{([['spread', 'Home spread', '-3.5'], ['homeOdds', 'Home American odds', '-110'], ['awayOdds', 'Away American odds', '-110']] as const).map(([key, label, placeholder]) => <label key={key} className="text-sm font-medium">{label}<input type="number" step={key === 'spread' ? '0.5' : '1'} value={f[key]} placeholder={placeholder} className={inputClass} onChange={e => edit(key, e.target.value)} /></label>)}</div>
              <p className="mt-2 text-xs text-muted">Enter the home spread as the book shows it: −3.5 means home is favored. Both prices must be from this book, time and opposite sides of this same spread.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Sportsbook<input className={inputClass} value={f.book} placeholder="Book name" onChange={e => edit('book', e.target.value)} /></label><label className="text-sm font-medium">Quote observed at (with timezone)<input className={inputClass} value={f.quoteTime} placeholder="2026-11-09T17:00:00Z" onChange={e => edit('quoteTime', e.target.value)} /></label></div>
            </fieldset>
            <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-bold">Review matchup inputs and avoid overlap</summary><p className="mt-3 text-xs leading-relaxed text-muted">The baseline already contains team and roster information. Add only a change beyond it, once, in one row. These are your sourced point assumptions, not learned player effects. Unknown never means healthy or no effect.</p>
              <div className="mt-4 space-y-4">{draft.adjustments.map((a, index) => <fieldset key={a.id} className="border-t border-border pt-3"><legend className="pr-2 text-sm font-semibold">{a.label}</legend><div className="grid gap-3 sm:grid-cols-[1.3fr_.7fr]"><label className="text-xs">Baseline treatment<select className={inputClass} value={a.status} onChange={e => adjust(index, { status: e.target.value as Adjustment['status'] })}><option value="unknown">Not reviewed / missing</option><option value="included">Already included / no change</option><option value="new">New incremental change</option></select></label><label className="text-xs">Home-margin change<input type="number" step="any" disabled={a.status !== 'new'} className={inputClass} value={a.points ?? ''} onChange={e => adjust(index, { points: number(e.target.value) })} /></label></div><label className="mt-2 block text-xs">Reason and source<input className={inputClass} value={a.reason} onChange={e => adjust(index, { reason: e.target.value })} placeholder="What changed relative to the baseline?" /></label></fieldset>)}</div>
            </details>
            <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-bold">Cover probability input, if available</summary><p className="mt-3 text-xs leading-relaxed text-muted">Frozen NFL distributions calculate the probability for the exact spread. Otherwise supply an independently supported estimate for this final scenario, excluding pushes. A points gap alone does not provide a probability. Changing teams, baseline, spread or adjustments clears your prior estimate.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Home cover probability (%)<input className={inputClass} type="number" min="0" max="100" step="any" value={f.probability} onChange={e => edit('probability', e.target.value)} /></label><label className="text-sm">Probability source / calibration<input className={inputClass} value={f.probabilitySource} onChange={e => edit('probabilitySource', e.target.value)} placeholder="Model, version and evidence" /></label></div></details>
            <button className="w-full rounded-md bg-accent px-5 py-3.5 text-base font-black text-white hover:bg-accent-hi focus:outline-2 focus:outline-offset-2 focus:outline-accent" type="submit">Run matchup</button>
          </form>
        </section>
        {notice && <p role="status" className="px-1 text-sm text-muted-strong">{notice}</p>}
        <section ref={resultRef} tabIndex={-1} aria-label="Matchup result" aria-live="polite" className="panel scroll-mt-6 p-5 focus:outline-none sm:p-6">
          <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">One matchup result</h2>{run && <span className="text-xs text-muted">Research only</span>}</div>
          {!result ? <p className="mt-3 text-sm text-muted">Choose a game or enter your inputs, then Run matchup. Missing probabilities stay blank.</p> : result.errors.length ? <div role="alert" className="mt-4 rounded border border-red-400/40 p-4"><h3 className="font-bold">Check the inputs</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{result.errors.map(error => <li key={error}>{error}</li>)}</ul></div> : <>
            <div className="mt-4 rounded-lg border border-border bg-background p-4"><p className="text-xs uppercase tracking-wider text-muted">Projected home spread</p><p className="mt-2 font-display text-3xl font-black">{result.projectedHomeSpread === null ? 'Model inputs needed' : `${home} ${signed(result.projectedHomeSpread)}`}</p><p className="mt-2 text-sm text-muted-strong">{result.gap === null ? 'A baseline and quoted spread are needed for a line comparison.' : result.lean === 'even' ? 'Model and book are on the same line.' : `${result.lean === 'home' ? home : away} lean by ${Math.abs(result.gap).toFixed(2)} points versus the quoted spread.`}</p><p className="mt-2 text-xs text-muted">A model lean is not a bet recommendation.</p></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">{(['home', 'away'] as const).map(side => <div key={side} className="rounded-lg border border-border p-4"><h3 className="font-bold">{side === 'home' ? home : away}</h3><p className="mt-3 text-xs text-muted">Estimated cover · excluding pushes</p><p className="mt-1 text-2xl font-black">{pct(side === 'home' ? result.homeCoverProbability : result.awayCoverProbability)}</p><p className="mt-3 text-sm">Book {signed(run!.input.homeSpread === null ? null : (side === 'home' ? 1 : -1) * run!.input.homeSpread)} · {price(side === 'home' ? run!.input.homeOdds : run!.input.awayOdds)}</p><p className="mt-1 text-xs text-muted">Break-even: {pct(side === 'home' ? result.homeBreakEven : result.awayBreakEven)}</p></div>)}</div>
            <div className="mt-3 space-y-1 text-xs text-muted"><p>Push probability: {pct(result.pushProbability)}. No-vig home reference: {pct(result.marketHomeProbability)}.</p><p>Quote: {f.book || 'Book not supplied'} · {f.quoteTime ? dateLabel(f.quoteTime) : 'Timestamp not supplied'}. Manually entered quotes are not independently verified.</p></div>
            <MatchupBreakdown key={run!.at} input={run!.input} result={result} at={run!.at} />
            <h3 className="mt-5 text-sm font-bold">Why this result</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-strong">{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            {!!result.warnings.length && <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/5 p-4"><h3 className="text-sm font-bold text-amber-100">Data and model limits</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-xs leading-relaxed text-amber-100/90">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
            <div className="mt-5 flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={saveRun}>Save run</button><button type="button" className={buttonClass} onClick={downloadRun}>Download result</button></div><p className="mt-2 text-xs text-muted">No wager is placed. Saved runs remain on this browser, separate from the frozen trial ledger.</p>
          </>}
        </section>
      </div>
    </div>
    <TicketJournal run={run} sport={sport} />
  </div>;
}
