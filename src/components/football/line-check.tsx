'use client';

import { useState } from 'react';

const factors = [
  ['QB and supporting cast', 'Compare the expected QB and offense with the lineup assumed in your baseline.'],
  ['Other lineup changes', 'Include only new absences, returns, or changes to replacement quality.'],
  ['Efficiency and opponent strength', 'Use only an update beyond the team ratings or opponent adjustment already applied.'],
  ['Matchup and scheme', 'Consider pass protection, pressure, run defense, and other matchup effects together.'],
  ['Home field, rest and travel', 'Account for venue, scheduling, and travel relative to the baseline.'],
  ['Weather and offensive style', 'Estimate the net change to the margin for both offenses.'],
  ['Turnovers and recent results', 'Record any change supported by the underlying play. Check for overlap with efficiency.'],
] as const;

type Status = 'unknown' | 'included' | 'change';
type Adjustment = { status: Status; points: string; reason: string };
const blank = { home: '', away: '', baseline: '', homeSpread: '', homeOdds: '', awayOdds: '', probability: '' };
const blankFactors = () => factors.map((): Adjustment => ({ status: 'unknown', points: '', reason: '' }));
const input = 'mt-1 w-full rounded border border-border-strong bg-background px-3 py-2 text-base text-foreground sm:text-sm';
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const pct = (n: number) => `${(100 * n).toFixed(1)}%`;

function number(value: string, limit: number) {
  const n = Number(value);
  return value.trim() && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function price(value: string) {
  const odds = number(value, 100000);
  if (odds === null || !Number.isInteger(odds) || Math.abs(odds) < 100) return null;
  const profit = odds > 0 ? odds / 100 : 100 / -odds;
  return { profit, breakEven: 1 / (1 + profit) };
}

export function LineCheck() {
  const [fields, setFields] = useState(blank);
  const [adjustments, setAdjustments] = useState(blankFactors);
  const [example, setExample] = useState(false);
  const baseline = number(fields.baseline, 150);
  const spread = number(fields.homeSpread, 150);
  const changes = adjustments.map(a => a.status === 'change' ? number(a.points, 100) : 0);
  const total = changes.reduce<number>((sum, delta) => sum + (delta ?? 0), 0);
  const incomplete = changes.includes(null);
  const projection = baseline === null || incomplete ? null : baseline + total;
  const gap = projection === null || spread === null ? null : projection + spread;
  const home = fields.home.trim() || 'Home';
  const away = fields.away.trim() || 'Away';
  const probability = number(fields.probability, 100);
  const homeProbability = probability !== null && probability >= 0 ? probability / 100 : null;
  const unknown = adjustments.filter(a => a.status === 'unknown').length;
  const changed = adjustments.filter(a => a.status === 'change').length;

  function edit(key: keyof typeof blank, value: string) {
    setFields(current => ({ ...current, [key]: value }));
  }

  function updateFactor(index: number, patch: Partial<Adjustment>) {
    setAdjustments(current => current.map((a, i) => i === index ? { ...a, ...patch } : a));
  }

  const summary = 'cursor-pointer py-1 text-base font-bold';
  const sides = [{ name: home, line: spread, rawPrice: fields.homeOdds, p: homeProbability }];
  if (fields.awayOdds.trim()) {
    sides.push({ name: away, line: spread === null ? null : -spread, rawPrice: fields.awayOdds, p: homeProbability === null ? null : 1 - homeProbability });
  }

  return <div className="space-y-4">
    <header className="mt-4 border-b border-border pb-4">
      <h1 className="font-display text-4xl font-black">Football Line Check</h1>
      <p className="mt-2 text-sm text-muted-strong">Compare your model’s line with the spread and price in your sportsbook.</p>
      <button type="button" className="mt-4 rounded border border-border-strong px-3 py-2 text-sm font-semibold" onClick={() => {
        setFields({ ...blank, home: 'Tennessee', away: 'Kentucky', baseline: '10', homeSpread: '-5.5', homeOdds: '-115', awayOdds: '-105' });
        setAdjustments(blankFactors());
        setExample(true);
      }}>Load Tennessee–Kentucky example</button>
      {example && <p className="mt-2 text-xs text-muted">November 7, 2026 example using the published SP+ margin and the FanDuel Research snapshot discussed earlier. Update the quote and assumptions for your scenario.</p>}
    </header>

    <section className="panel p-4 sm:p-5">
      <h2 className="text-lg font-bold">Quick check</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="col-span-2 text-sm font-semibold sm:col-span-1">Model’s home win margin
          <input className={input} type="number" step="any" placeholder="10" value={fields.baseline} onChange={e => edit('baseline', e.target.value)} />
          <span className="mt-1 block text-xs font-normal text-muted">Use a minus sign if the away team is projected to win.</span>
        </label>
        <label className="text-sm font-semibold">Book’s home spread
          <input className={input} type="number" step="any" placeholder="-5.5" value={fields.homeSpread} onChange={e => edit('homeSpread', e.target.value)} />
        </label>
        <label className="text-sm font-semibold">Home spread odds
          <input className={input} type="number" step="1" placeholder="-115" value={fields.homeOdds} onChange={e => edit('homeOdds', e.target.value)} />
        </label>
      </div>
    </section>

    <section className="panel p-4 sm:p-5" aria-live="polite">
      <h2 className="text-lg font-bold">Line check result</h2>
      {gap === null || projection === null ? <p className="mt-2 text-sm text-muted">{incomplete ? 'Enter points for every new matchup adjustment.' : 'Enter your model’s margin and the book’s spread to compare the lines.'}</p> : <>
        <p className="mt-2 font-display text-2xl font-black">{home} {signed(-projection)} <span className="text-base text-muted">projected</span></p>
        <p className="mt-1 text-sm">{Math.abs(gap) < .05 ? 'The model and book are on the same line to one decimal place.' : `The projection leans ${gap > 0 ? home : away} by ${Math.abs(gap).toFixed(1)} points against the book’s spread.`}</p>
        {unknown > 0 && <p className="mt-1 text-xs text-muted">{unknown} matchup factors still unreviewed.</p>}
      </>}
      {sides.some(side => side.rawPrice.trim()) && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {sides.map((side, i) => {
          const quote = price(side.rawPrice);
          const expected = quote && side.p !== null && side.line !== null ? side.p * quote.profit - (1 - side.p) : null;
          return <div key={i} className="rounded border border-border p-3">
            <h3 className="text-sm font-semibold">{side.name}{side.line === null ? '' : ` ${signed(side.line)}`}</h3>
            <p className="mt-1 text-sm">{quote ? `${pct(quote.breakEven)} cover probability to break even` : 'Enter American odds like −110 or +105.'}</p>
            {expected !== null && side.p !== null && <>
              <p className="mt-2 text-sm font-semibold">{Math.abs(expected) < 1e-9 ? 'At break-even' : expected > 0 ? 'Above break-even' : 'Below break-even'} using your estimate of {pct(side.p)}.</p>
              <p className="mt-1 text-xs text-muted">Expected return per non-push stake {pct(expected)}.</p>
            </>}
          </div>;
        })}
      </div>}
    </section>

    <details className="panel p-4 sm:p-5">
      <summary className={summary}>Matchup adjustments <span className="ml-2 text-xs font-normal text-muted">{incomplete ? 'Points needed' : changed ? `${changed} added · ${signed(total)} pts` : 'Optional'}</span></summary>
      <p className="mt-2 text-sm text-muted">Use positive points for changes that help the home margin and negative points for changes that hurt it. Assign each effect to one row. The projection adds only rows marked “New adjustment.”</p>
      <div className="mt-4 space-y-3">
        {factors.map(([label, help], i) => {
          const a = adjustments[i];
          return <fieldset key={label} className="rounded border border-border p-3">
            <legend className="px-1 text-sm font-semibold">{label}</legend>
            <p className="text-xs text-muted">{help}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
              <label className="text-xs">Baseline treatment<select className={input} value={a.status} onChange={e => updateFactor(i, { status: e.target.value as Status })}>
                <option value="unknown">Unreviewed</option><option value="included">Accounted for or no change</option><option value="change">New adjustment</option>
              </select></label>
              <label className="text-xs">Incremental points<input className={input} type="number" step="any" disabled={a.status !== 'change'} value={a.points} onChange={e => updateFactor(i, { points: e.target.value })} /></label>
              <label className="text-xs">Reason or source<input className={input} value={a.reason} onChange={e => updateFactor(i, { reason: e.target.value })} /></label>
            </div>
          </fieldset>;
        })}
      </div>
    </details>

    <details className="panel p-4 sm:p-5">
      <summary className={summary}>Team names, away odds, and cover estimate</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {([
          ['home', 'Home team', 'text'], ['away', 'Away team', 'text'],
          ['awayOdds', 'Away odds for the opposite spread', 'number'],
          ['probability', 'Estimated home cover probability (%)', 'number'],
        ] as const).map(([key, label, type]) => <label key={key} className="text-sm font-semibold">{label}
          <input className={input} type={type} step="any" value={fields[key]} onChange={e => edit(key, e.target.value)} />
        </label>)}
      </div>
      <p className="mt-2 text-xs text-muted">Use a calibrated cover estimate for this exact spread, excluding pushes. The points difference alone can’t tell you the cover probability.</p>
      {fields.probability && homeProbability === null && <p className="mt-2 text-xs text-amber-200">Enter a percentage from 0 to 100.</p>}
    </details>
  </div>;
}
