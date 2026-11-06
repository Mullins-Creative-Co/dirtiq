'use client';

import { useState } from 'react';
import { columns, csv, defaults, demoGames, finalCheck, matchup, readGames, runBacktest, type Backtest, type Evaluation, type Game, type HistoryMetadata, type Settings } from '@/lib/football/model';
import type { InputReadiness, ResearchReport } from '@/lib/football/research';
import { ResearchPanel } from './research-panel';
import { OverlapPanel } from './overlap-panel';
import type { OverlapAudit } from '@/lib/football/overlap-types';
import { DecompositionPanel } from './decomposition-panel';
import type { CastReport } from '@/lib/football/decomposition-types';
import { QbMovementPanel } from './qb-movement-panel';
import { CollegePanel } from './college-panel';
import type { CollegeReport } from '@/lib/football/college-types';

const STORAGE = 'dirtiq.football.scenarios.v1';
const inputClass = 'mt-2 w-full rounded border border-border-strong bg-background px-3 py-2.5 text-sm text-foreground focus:outline-2 focus:outline-accent';
const buttonClass = 'rounded border border-border-strong bg-surface-raised px-4 py-2.5 text-sm font-semibold hover:bg-surface-hover disabled:opacity-40';
const initial = { home: 'Home team', away: 'Away team', homeRating: 3, awayRating: 0, homeField: 1.5, embeddedQbDiff: -2, currentQbDiff: -2, market: 3.5 };
type Scenario = typeof initial;
type Saved = { id: string; name: string; createdAt: string; scenario: Scenario };
const hypotheses = [
  ['Quarterback overlap', 'Team EPA already reflects the quarterback. Compare a separate manual QB adjustment with a model that estimates their weights jointly.', 'EPA-only vs manual QB vs joint fit'],
  ['Injuries already reflected', 'Recent team performance may already include an absent player. Compare the expected lineup with the lineup represented in the baseline.', 'Unchanged lineup vs actual lineup change'],
  ['Protection and QB efficiency', 'Historical sacks and QB hits reflect protection, quarterback, and scheme together. Test whether they add information beyond opponent-adjusted EPA and QB ratings.', 'Opponent-adjusted baseline vs protection proxies'],
  ['Opponent strength', 'Efficiency against weak opponents may not transfer to a stronger matchup. Estimate opponent adjustments using earlier games only.', 'Raw efficiency vs schedule-adjusted efficiency'],
  ['Turnovers already reflected in EPA', 'EPA already reflects turnover outcomes. Test whether earlier turnover rates add predictive information without a second manual penalty.', 'Opponent-adjusted baseline vs turnover rates'],
  ['Home field and conditions', 'Home splits or a weather-adjusted forecast may already contain the adjustment. Record what each baseline includes before adding more.', 'Documented baseline vs incremental conditions'],
] as const;

function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function signed(n: number) { return `${n > 0 ? '+' : ''}${n.toFixed(1)}`; }
function marginText(margin: number, home: string, away: string) { return Math.abs(margin) < .05 ? 'Pick’em' : `${margin > 0 ? home : away} −${Math.abs(margin).toFixed(1)}`; }
function pct(n: number | null) { return n === null ? '—' : `${(n * 100).toFixed(1)}%`; }

function NumberField({ label, value, onChange, help, step = .5 }: { label: string; value: number; onChange: (n: number) => void; help?: string; step?: number }) {
  return <label className="block text-sm font-semibold">{label}<input type="number" step={step} value={value} className={inputClass} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber); }} />{help && <span className="mt-1.5 block text-xs font-normal leading-relaxed text-muted">{help}</span>}</label>;
}

export function FootballWorkbench({ research, readiness, overlap, decomposition, college }: { research: ResearchReport; readiness: InputReadiness; overlap: OverlapAudit; decomposition: CastReport; college: CollegeReport }) {
  const [tab, setTab] = useState<'college' | 'movement' | 'decomposition' | 'overlap' | 'research' | 'matchup' | 'backtest' | 'experiments'>('college');
  const [scenario, setScenario] = useState<Scenario>(initial);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveName, setSaveName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [games, setGames] = useState<Game[]>([]);
  const [source, setSource] = useState('No dataset loaded');
  const [history, setHistory] = useState<HistoryMetadata | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation>({});
  const [settings, setSettings] = useState<Settings>(defaults);
  const [result, setResult] = useState<Backtest | null>(null);
  const [runSettings, setRunSettings] = useState<Settings | null>(null);
  const [runEvaluation, setRunEvaluation] = useState<Evaluation>({});
  const [busy, setBusy] = useState(false);
  const output = matchup(scenario.homeRating, scenario.awayRating, scenario.homeField, scenario.embeddedQbDiff, scenario.currentQbDiff, scenario.market);
  function change(key: keyof Scenario, value: string | number) { setScenario(s => ({ ...s, [key]: value })); }
  function changeSetting(key: keyof Settings, value: number) { setSettings(s => ({ ...s, [key]: value })); setResult(null); }

  function loadSaved() {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]');
      if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.createdAt !== 'string' || !item.scenario || Object.entries(initial).some(([key, value]) => typeof item.scenario[key] !== typeof value || (typeof value === 'number' && !Number.isFinite(item.scenario[key]))))) throw new Error('Saved scenarios are not valid.');
      setSaved(parsed as Saved[]); return parsed as Saved[];
    } catch { setNotice('Saved scenarios could not be read. Browser storage may be unavailable.'); return null; }
  }
  function saveScenario() {
    const previous = loadSaved(); if (previous === null) return;
    const item = { id: crypto.randomUUID(), name: saveName.trim() || `${scenario.away} at ${scenario.home}`, createdAt: new Date().toISOString(), scenario: { ...scenario } };
    const next = [item, ...previous].slice(0, 100);
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); setSaved(next); setNotice('Scenario saved on this browser.'); setSaveName(''); }
    catch { setNotice('Could not save. Download the scenario instead.'); }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setError(''); setResult(null);
    if (file.size > 8_000_000) { setError('Choose a CSV smaller than 8 MB.'); return; }
    try { const next = readGames(await file.text()); setGames(next); setSource(file.name); setHistory(null); setEvaluation({}); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not import CSV.'); }
  }
  async function loadHistory() {
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/football/history.json');
      if (!response.ok) throw new Error('NFL history could not be loaded. Try again.');
      const data = await response.json() as { metadata: HistoryMetadata; games: Game[] };
      if (!Array.isArray(data.games) || !data.metadata?.provider) throw new Error('The NFL history file is invalid.');
      const next = readGames(csv(data.games));
      setGames(next); setHistory(data.metadata); setSource(`${data.metadata.provider} · ${data.metadata.seasons[0]}–${data.metadata.seasons.at(-1)}`);
      setEvaluation({ fromSeason: 2023, throughSeason: 2025, throughWeek: 9 });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load NFL history.'); }
    finally { setBusy(false); }
  }
  function run() {
    setBusy(true); setError(''); setResult(null);
    setTimeout(() => {
      try { setResult(runBacktest(games, settings, evaluation)); setRunSettings({ ...settings }); setRunEvaluation({ ...evaluation }); }
      catch (e) { setError(e instanceof Error ? e.message : 'Backtest failed.'); }
      finally { setBusy(false); }
    }, 30);
  }

  return <div className="space-y-7">
    <header className="border-b border-border pb-7">
      <div className="flex flex-wrap items-center gap-3"><span className="text-xs font-black uppercase tracking-[.2em] text-accent">NFL & college research workspace</span><span className="rounded-full border border-border-strong px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-strong">Independent football models</span></div>
      <h1 className="mt-4 font-display text-4xl font-black sm:text-5xl">Football Lab</h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-strong">Find out whether an adjustment improves the prediction—or counts the same information twice.</p>
      <p className="mt-3 text-xs text-muted">Real NFL history is ready to load. Default training: the preceding two years, weighted toward recent games. Racing models stay separate.</p>
    </header>
    <nav aria-label="Football workspace" className="flex gap-2 overflow-x-auto pb-1">
      {([['college', 'College turnover test'], ['decomposition', 'QB & supporting team'], ['movement', 'QB news & line movement'], ['overlap', 'Overlap audit'], ['research', 'Research results'], ['matchup', 'Matchup sandbox'], ['backtest', 'Historical backtest'], ['experiments', 'Experiment notebook']] as const).map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => { setTab(key); setNotice(''); }} className={`${buttonClass} shrink-0 ${tab === key ? 'border-accent text-accent' : 'text-muted-strong'}`}>{label}</button>)}
    </nav>

    {tab === 'research' && <ResearchPanel report={research} readiness={readiness} />}
    {tab === 'decomposition' && <DecompositionPanel report={decomposition} />}
    {tab === 'movement' && <QbMovementPanel />}
    {tab === 'college' && <CollegePanel report={college} />}
    {tab === 'overlap' && <OverlapPanel audit={overlap} />}

    {tab === 'matchup' && <>
      <div className="rounded border border-amber-400/25 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-100">Illustrative inputs, not a trained prediction. Enter team ratings that already include the expected lineup, then adjust only for what changed.</div>
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <section className="panel p-5 sm:p-6"><h2 className="text-xl font-bold">Build a matchup</h2><p className="mt-2 text-sm text-muted">All ratings below are in points relative to an average team.</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-semibold">Home team<input className={inputClass} maxLength={60} value={scenario.home} onChange={e => change('home', e.target.value)} /></label>
            <label className="text-sm font-semibold">Away team<input className={inputClass} maxLength={60} value={scenario.away} onChange={e => change('away', e.target.value)} /></label>
            <NumberField label="Home team rating" value={scenario.homeRating} onChange={n => change('homeRating', n)} />
            <NumberField label="Away team rating" value={scenario.awayRating} onChange={n => change('awayRating', n)} />
            <NumberField label="Home-field advantage" value={scenario.homeField} onChange={n => change('homeField', n)} help="Enter 0 for a neutral site." />
            <NumberField label="Market home margin" value={scenario.market} onChange={n => change('market', n)} help="Home −3.5 means enter +3.5. Home +3.5 means enter −3.5." />
            <NumberField label="QB difference already included" value={scenario.embeddedQbDiff} onChange={n => change('embeddedQbDiff', n)} help="Home QB value minus away QB value represented in the team ratings." />
            <NumberField label="QB difference for this game" value={scenario.currentQbDiff} onChange={n => change('currentQbDiff', n)} help="Same starters? Keep this equal to the included difference." />
          </div>
        </section>
        <section className="space-y-4" aria-live="polite">
          <article className="panel-raised p-6"><p className="text-xs font-bold uppercase tracking-widest text-muted">Change-only projection</p><p className="mt-3 break-words font-display text-3xl font-black">{marginText(output.adjusted, scenario.home, scenario.away)}</p><p className="mt-3 text-sm text-muted-strong">{signed(output.edge)} points versus the market’s home margin.</p><p className="mt-2 text-xs text-muted">A model difference is a hypothesis to test, not a demonstrated betting edge.</p></article>
          <article className="panel p-5"><h2 className="font-bold">Where the overlap appears</h2><dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-strong">Team-rating baseline</dt><dd>{signed(output.baseline)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-strong">Add the full QB difference again</dt><dd>{signed(output.naive)}</dd></div>
            <div className="flex justify-between gap-3 border-t border-border pt-3"><dt className="text-muted-strong">Actual change in QB difference</dt><dd>{signed(output.change)}</dd></div>
            <div className="flex justify-between gap-3 font-bold"><dt>Baseline + actual change</dt><dd>{signed(output.adjusted)}</dd></div>
          </dl><p className="mt-5 text-xs leading-relaxed text-muted">With the same quarterbacks, the change is zero. Adding their full values again can duplicate an effect already present in the baseline. This comparison assumes the baseline truly includes those QB values.</p></article>
          <button className={`${buttonClass} w-full`} onClick={() => setScenario(initial)}>Reset example</button>
        </section>
      </div>
      <section className="panel p-5"><h2 className="text-lg font-bold">Save an experiment</h2><p className="mt-2 text-sm text-muted">Scenarios stay in this browser under football-only storage. Download a copy to use elsewhere.</p><div className="mt-4 flex flex-wrap gap-3"><input aria-label="Scenario name" placeholder="e.g. Same QB, strong supporting team" maxLength={100} className={`${inputClass} mt-0 min-w-48 flex-1`} value={saveName} onChange={e => setSaveName(e.target.value)} /><button className={buttonClass} onClick={saveScenario}>Save scenario</button><button className={buttonClass} onClick={() => { loadSaved(); }}>Load saved</button><button className={buttonClass} onClick={() => download('football-scenario.json', JSON.stringify({ version: 1, scenario, output }, null, 2), 'application/json')}>Download JSON</button></div>
        {notice && <p role="status" className="mt-3 text-sm text-muted-strong">{notice}</p>}
        {saved.length > 0 && <ul className="mt-5 divide-y divide-border">{saved.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="min-w-0 break-words text-sm">{item.name}<span className="ml-2 text-xs text-muted">{item.createdAt.slice(0, 10)}</span></span><button className={buttonClass} onClick={() => { setScenario(item.scenario); setNotice(`Loaded ${item.name}.`); }}>Open</button></li>)}</ul>}
      </section>
    </>}

    {tab === 'backtest' && <>
      <section className="panel p-5 sm:p-6"><h2 className="text-xl font-bold">Which information improves the forecast?</h2><p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-strong">Fit models on earlier completed games, then predict the next weekly block. The real dataset includes opponent-adjusted ratings, rest, protection proxies, turnovers, passing/rushing matchups, and a market-anchored error model. CSVs without these columns run only the original comparisons.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className="btn-accent rounded px-5 py-2.5 text-sm font-bold disabled:opacity-40" disabled={busy} onClick={() => { void loadHistory(); }}>{busy && !result ? 'Working…' : 'Load real NFL history'}</button>
          <label className={`${buttonClass} cursor-pointer`}>Import game CSV<input aria-label="Import historical game CSV" type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button className={buttonClass} disabled={busy} onClick={() => { setGames(demoGames()); setSource('Synthetic demo — 320 invented games'); setResult(null); setError(''); setHistory(null); setEvaluation({}); }}>Load synthetic demo</button>
          <button className={buttonClass} onClick={() => download('football-synthetic-example.csv', csv(demoGames(), [...columns]))}>Download example CSV</button>
        </div>
        <p className="mt-4 text-sm text-muted-strong">{source}{games.length > 0 ? ` · ${games.length} games` : ''}</p>
        {history && <div className="mt-5 rounded border border-amber-400/25 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-100"><b>Historical research benchmark.</b> Features use earlier games, with a previous-game passer proxy. Archived line timing and historical EPA model vintages are not verified as contemporaneous. These are not live betting recommendations.</div>}
        {history && <label className="mt-5 block max-w-lg text-sm font-semibold">Evaluation period<select className={inputClass} disabled={busy} value={evaluation.fromWeek === 10 ? 'final' : evaluation.throughWeek === 9 ? 'development' : 'earlier'} onChange={e => { try { setEvaluation(e.target.value === 'final' ? finalCheck(games) : e.target.value === 'development' ? { fromSeason: 2023, throughSeason: 2025, throughWeek: 9 } : { fromSeason: 2023, throughSeason: 2024 }); setResult(null); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Cannot select final check.'); } }}><option value="development">2023–2025 week 9 · development</option><option value="earlier">2023–2024 · earlier comparison</option><option value="final">2025 week 10 onward · reveal frozen final check</option></select><span className="mt-2 block text-xs font-normal text-muted">The final check freezes model fitting before week 10. Earlier holdout results may update later pregame features but never the fitted weights. Once inspected, this period is no longer untouched.</span></label>}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <NumberField label="Rolling training window (years)" step={1} value={settings.trainingYears} onChange={n => changeSetting('trainingYears', n)} help="Default 2. Older games remain in the archive but cannot enter this fit. Range: 1–5." />
          <NumberField label="Training weight half-life (days)" step={1} value={settings.halfLifeDays} onChange={n => changeSetting('halfLifeDays', n)} help="Default 365. A game one year older gets half the weight. Minimum: 30." />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="Minimum training games" step={1} value={settings.minTrain} onChange={n => changeSetting('minTrain', n)} />
          <NumberField label="Regularization (alpha)" step={1} value={settings.alpha} onChange={n => changeSetting('alpha', n)} help="Positive values stabilize overlapping inputs." />
          <NumberField label="Minimum line difference" value={settings.threshold} onChange={n => changeSetting('threshold', n)} help="Bet only when the absolute gap exceeds this many points." />
          <NumberField label="Manual QB weight" step={1} value={settings.qbWeight} onChange={n => changeSetting('qbWeight', n)} help="Points per unit of QB EPA/play difference. An assumption, not a sportsbook formula." />
        </div>
        <button className="btn-accent mt-6 rounded px-6 py-3 text-sm font-bold disabled:opacity-40" disabled={!games.length || busy} onClick={run}>{busy ? 'Running comparisons…' : 'Run historical comparison'}</button>
        {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      </section>
      {result && <section className="panel overflow-hidden" aria-live="polite"><div className="p-5 sm:p-6"><p className="text-xs font-bold uppercase tracking-widest text-accent">{result.synthetic ? 'Synthetic demonstration' : history ? 'Real NFL history · retrospective benchmark' : 'Imported historical dataset'}</p><h2 className="mt-2 text-2xl font-bold">Out-of-sample comparison</h2><p className="mt-3 text-sm text-muted-strong">{result.synthetic ? 'These are invented games. Results demonstrate the workflow and cannot establish an NFL betting edge.' : 'Each prediction uses a fit on earlier games only. Source revisions, historical EPA vintages, QB assumptions, and line timing still limit what these results establish.'}</p></div>
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm"><caption className="sr-only">Model accuracy and one-unit betting results</caption><thead className="bg-surface-raised text-xs text-muted"><tr>{['Model', 'Games', 'Error (pts)', 'Market error', 'W–L–Push', 'Win rate', 'Net units', 'ROI'].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{result.summary.map(s => <tr key={s.model} className="border-t border-border"><th className="px-4 py-4 font-semibold">{s.model}</th><td className="px-4 py-4">{s.games}</td><td className="px-4 py-4">{s.mae.toFixed(2)}</td><td className="px-4 py-4">{s.marketMae.toFixed(2)}</td><td className="px-4 py-4">{s.wins}–{s.losses}–{s.pushes}</td><td className="px-4 py-4">{pct(s.winRate)}</td><td className="px-4 py-4">{signed(s.units)}</td><td className="px-4 py-4">{pct(s.roi)}</td></tr>)}</tbody></table></div>
        <div className="space-y-4 p-5 sm:p-6"><p className="text-xs leading-relaxed text-muted">Error is mean absolute prediction error; lower is better. Wagers risk one unit at the imported odds. Pushes return the stake and are excluded from win rate. All models use the same held-out games.</p>
          <div className="grid gap-3 sm:grid-cols-3">{result.summary.map(s => <p key={s.model} className="rounded border border-border p-3 text-xs leading-relaxed text-muted-strong"><b>{s.model}</b><br />{s.bets} bets · approximate 95% win-rate interval {pct(s.winLow)}–{pct(s.winHigh)}. Games may be correlated, so this interval is descriptive.</p>)}</div>
          <h3 className="pt-2 font-bold">Does it repeat by season?</h3><div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead><tr>{['Season', 'Model', 'Games', 'Error', 'Market error', 'Bets', 'Net units', 'ROI'].map(h => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>{result.bySeason.map(s => <tr key={`${s.season}-${s.model}`} className="border-t border-border"><td className="px-3 py-3">{s.season}</td><th className="px-3 py-3">{s.model}</th><td className="px-3 py-3">{s.games}</td><td className="px-3 py-3">{s.mae.toFixed(2)}</td><td className="px-3 py-3">{s.marketMae.toFixed(2)}</td><td className="px-3 py-3">{s.bets}</td><td className="px-3 py-3">{signed(s.units)}</td><td className="px-3 py-3">{pct(s.roi)}</td></tr>)}</tbody></table></div>
          <p className="text-xs text-muted">Run settings: {JSON.stringify(runSettings)}. Evaluation: {Object.keys(runEvaluation).length ? JSON.stringify(runEvaluation) : 'all eligible seasons'}. Changing a setting clears this result.</p>
          <div className="flex flex-wrap gap-3"><button className={buttonClass} onClick={() => download('football-predictions.csv', csv(result.predictions))}>Export predictions</button><button className={buttonClass} onClick={() => download('football-backtest.json', JSON.stringify({ source, metadata: history, settings: runSettings, evaluation: runEvaluation, ...result }, null, 2), 'application/json')}>Export full experiment</button></div>
        </div>
      </section>}
      {history && <details className="panel p-5"><summary className="cursor-pointer font-bold">NFL data coverage and provenance</summary><div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-strong"><p>Built {history.builtAt.slice(0, 10)}. {Object.entries(history.seasonCounts).map(([year, count]) => `${year}: ${count} games`).join(' · ')}.</p><p>{history.featurePolicy}</p><p>{history.qbPolicy}</p><p>{history.availabilityPolicy}</p><p>{history.marketPolicy}</p><p>{history.vintagePolicy}</p><p>{history.attribution}</p><p>Excluded: {Object.entries(history.excluded).map(([reason, count]) => `${reason.replaceAll('_', ' ')}: ${count}`).join(' · ')}.</p><p>Source files and SHA-256 checksums are included when you export the full experiment. <a className="text-accent underline" href="https://github.com/nflverse/nflverse-data">nflverse data</a> · <a className="text-accent underline" href="https://github.com/nflverse/nfldata/blob/master/DATASETS.md">schedule field definitions</a></p></div></details>}
      <details className="panel p-5"><summary className="cursor-pointer font-bold">CSV fields and sign conventions</summary><div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-strong"><p><code>game_id, kickoff, feature_asof, completed_at, home_team, away_team</code>: unique game and ISO timestamps with timezones. Features must be frozen before kickoff. Training excludes games not completed before the test block’s earliest feature timestamp.</p><p><code>home_margin</code>: final home score minus away score. <code>market_home_margin</code>: market-implied home winning margin; home −3.5 becomes +3.5 here. <code>home_odds, away_odds</code>: American odds for each side of that same spread.</p><p><code>off_epa_diff, def_epa_allowed_diff, qb_epa_diff</code>: home minus away in pregame EPA/play ratings. Lower defensive EPA allowed is better. <code>home_field</code>: 1 for a home game, 0 for neutral; the model learns its point value.</p><p>One row per game. Only prior games may contribute to pregame features; exclude the current game and future season totals. All enabled models use training-only scaling, the same ridge settings, and Wednesday–Tuesday test blocks.</p><p>Record the sportsbook, line timestamp, and source version upstream. A closing-line comparison is a benchmark; it does not prove that price was available at your prediction time. Keep 2025 week 10 onward untouched until the model and rules are fixed.</p></div></details>
    </>}

    {tab === 'experiments' && <>
      <section className="panel p-6"><h2 className="text-2xl font-bold">Test the explanation</h2><p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-strong">Correlated statistics are not automatically double counted. The question is whether an extra input or manual adjustment improves predictions on unseen games. The research results now include opponent strength, rest, protection proxies, turnovers, and passing/rushing matchups. Injuries, confirmed starters, weather forecasts, and timestamped line movement are not enabled.</p><button className={`${buttonClass} mt-5`} onClick={() => setTab('backtest')}>Open QB comparison →</button></section>
      <div className="grid gap-4 md:grid-cols-2">{hypotheses.map(([title, description, comparison], i) => <article key={title} className="panel p-5"><p className="text-[10px] font-bold uppercase tracking-widest text-accent">{[0, 2, 3, 4].includes(i) ? 'Implemented comparison · see research results' : 'Not fully implemented'}</p><h2 className="mt-3 text-xl font-bold">{title}</h2><p className="mt-3 text-sm leading-relaxed text-muted-strong">{description}</p><p className="mt-5 border-t border-border pt-4 text-xs text-muted">{comparison}</p></article>)}</div>
      <section className="panel p-5"><h2 className="font-bold">Define success before running</h2><p className="mt-3 text-sm leading-relaxed text-muted-strong">Choose the seasons, feature definitions, and line timestamp first. Compare prediction error and returns after the sportsbook’s price. Inspect sample size, season stability, and the strongest counterexamples. A winning demo or one good season is not proof the market has a repeatable weakness.</p></section>
    </>}
  </div>;
}
