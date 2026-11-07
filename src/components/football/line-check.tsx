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
const input = 'mt-1 w-full rounded border border-border-strong bg-background px-3 py-2 text-sm text-foreground';
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
  const projection = baseline === null || changes.includes(null) ? null : baseline + total;
  const gap = projection === null || spread === null ? null : projection + spread;
  const home = fields.home.trim() || 'Home';
  const away = fields.away.trim() || 'Away';
  const probability = number(fields.probability, 100);
  const homeProbability = probability !== null && probability >= 0 ? probability / 100 : null;
  const unknown = adjustments.filter(a => a.status === 'unknown').length;

  function edit(key: keyof typeof blank, value: string) {
    setFields(current => ({ ...current, [key]: value }));
  }

  function updateFactor(index: number, patch: Partial<Adjustment>) {
    setAdjustments(current => current.map((a, i) => i === index ? { ...a, ...patch } : a));
  }

  return <div className="space-y-6">
    <header className="mt-4 border-b border-border pb-5">
      <h1 className="font-display text-4xl font-black">Football Line Check</h1>
      <p className="mt-3 max-w-3xl text-muted-strong">Start with a model’s expected home margin, add the changes it has yet to account for, and compare the result with the spread and price on your ticket.</p>
      <button type="button" className="mt-4 rounded border border-border-strong px-3 py-2 text-sm font-semibold" onClick={() => {
        setFields({ ...blank, home: 'Tennessee', away: 'Kentucky', baseline: '10', homeSpread: '-5.5', homeOdds: '-115', awayOdds: '-105' });
        setAdjustments(blankFactors());
        setExample(true);
      }}>Load Tennessee–Kentucky example</button>
      {example && <p className="mt-2 text-xs text-muted">November 7, 2026 example using the published SP+ margin and the FanDuel Research snapshot discussed earlier. Update the quote and assumptions for your scenario.</p>}
    </header>

    <section className="panel p-5">
      <h2 className="text-lg font-bold">Baseline and sportsbook quote</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {([
          ['home', 'Home team', 'text'], ['away', 'Away team', 'text'],
          ['baseline', 'Baseline home margin', 'number'], ['homeSpread', 'Sportsbook home spread', 'number'],
          ['homeOdds', 'Home spread price (American odds)', 'number'], ['awayOdds', 'Away spread price (American odds)', 'number'],
        ] as const).map(([key, label, type]) => <label key={key} className="text-sm font-semibold">{label}
          <input className={input} type={type} step="any" value={fields[key]} onChange={e => edit(key, e.target.value)} />
        </label>)}
      </div>
      <p className="mt-3 text-xs text-muted">If your model expects the home team to win by 10, enter a baseline margin of +10. If the sportsbook offers home −5.5, enter −5.5. Use prices for opposite sides of that same spread.</p>
    </section>

    <section className="panel p-5">
      <h2 className="text-lg font-bold">Matchup adjustments</h2>
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
    </section>

    <section className="panel p-5" aria-live="polite">
      <h2 className="text-lg font-bold">Projected line and price check</h2>
      {gap === null || projection === null ? <p className="mt-3 text-sm text-muted">Enter a baseline and spread within ±150 points and fill in every new adjustment within ±100 points.</p> : <>
        <p className="mt-3 font-display text-2xl font-black">{home} projected spread {signed(-projection)}</p>
        <p className="mt-2 text-sm text-muted">Baseline home margin {signed(baseline!)} · Combined changes {signed(total)} · Book home spread {signed(spread!)}</p>
        <p className="mt-2 text-sm">{Math.abs(gap) < .05 ? 'The projected line matches the book to one decimal place.' : `The projection favors ${gap > 0 ? home : away} against the spread by ${Math.abs(gap).toFixed(1)} points.`} {unknown > 0 && `${unknown} matchup factors are still unreviewed.`}</p>
      </>}
      <label className="mt-4 block max-w-md text-sm font-semibold">Optional home cover estimate, excluding pushes (%)
        <input className={input} type="number" min="0" max="100" step="any" value={fields.probability} onChange={e => edit('probability', e.target.value)} />
      </label>
      <p className="mt-2 text-xs text-muted">Use an estimate calibrated for this spread. The point gap alone cannot tell you the cover probability. Price comparisons use the probability you enter and assume the two sides are complementary among settled wins and losses.</p>
      {fields.probability && homeProbability === null && <p className="mt-2 text-xs text-amber-200">Enter a percentage from 0 to 100.</p>}
      {spread !== null && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {([{ name: home, line: spread, rawPrice: fields.homeOdds, p: homeProbability }, { name: away, line: -spread, rawPrice: fields.awayOdds, p: homeProbability === null ? null : 1 - homeProbability }]).map((side, i) => {
          const quote = price(side.rawPrice);
          const expected = quote && side.p !== null ? side.p * quote.profit - (1 - side.p) : null;
          return <div key={i} className="rounded border border-border p-4">
            <h3 className="font-semibold">{side.name} {signed(side.line)}</h3>
            <p className="mt-2 text-sm">{quote ? `${pct(quote.breakEven)} cover probability to break even` : 'Enter a valid American price, such as −110 or +105.'}</p>
            {expected !== null && quote && side.p !== null && <>
              <p className="mt-2 text-sm font-semibold">{Math.abs(expected) < 1e-9 ? 'At break-even' : expected > 0 ? 'Above break-even' : 'Below break-even'} using your estimate of {pct(side.p)}.</p>
              <p className="mt-1 text-xs text-muted">Expected return per non-push stake {pct(expected)}.</p>
            </>}
          </div>;
        })}
      </div>}
    </section>
  </div>;
}
