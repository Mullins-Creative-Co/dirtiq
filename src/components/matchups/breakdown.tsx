'use client';
import { useState } from 'react';
import { compareEstimate, explainMatchup, type ExternalEstimate } from '@/lib/matchups/breakdown';
import type { MatchupInput, RunResult } from '@/lib/matchups/model';

export function MatchupBreakdown({ input, result, at }: { input: MatchupInput; result: RunResult; at: string }) {
  const report = explainMatchup(input, result);
  const [other, setOther] = useState<ExternalEstimate>({ name: '', url: '', publishedAt: '', homeMargin: null, injuryAware: 'unknown' });
  const [checked, setChecked] = useState(false);
  const comparison = compareEstimate(input, result, other, at);
  const field = 'mt-1 w-full rounded border border-border-strong bg-background p-2 text-base';
  function change(patch: Partial<ExternalEstimate>) { setOther({ ...other, ...patch }); setChecked(false); }
  return <section className="mt-5 space-y-4 rounded-lg border border-border p-4" aria-label="Integrated matchup breakdown">
    <h3 className="font-bold">{report.headline}</h3><p className="text-sm">{report.explanation}</p>
    <div><h4 className="text-sm font-bold">Does the price support it?</h4><p className="mt-1 text-sm text-muted-strong">{report.priceCheck}</p></div>
    <div><h4 className="text-sm font-bold">What could change the answer?</h4>{report.risks.length ? <ul className="mt-1 list-disc pl-5 text-sm text-muted-strong">{report.risks.map(r => <li key={r}>{r}</li>)}</ul> : <p className="text-sm text-muted-strong">Inputs marked reviewed are user assertions, not independently verified news. Random scoring variation and model error remain.</p>}</div>
    <div className="text-xs text-muted"><p>Scenario generated: {at}</p><p>Projection source: {input.baselineSource || 'Distribution supplied / source not specified'}</p><p>Probability source: {input.probabilitySource || 'Unavailable'}</p><p>Quote observed: {input.quoteObservedAt || 'Unknown'} · {input.book || 'Book unknown'}</p></div>
    <details><summary className="cursor-pointer text-sm font-bold">Compare another model</summary>
      <p className="mt-2 text-xs text-muted">No external model feed is connected. Enter a prediction you are authorized to use for these exact teams, venue and date. This session-only comparison is not saved or included in downloads. Sportsbook odds and analyst picks are not independent model forecasts. Agreement is not proof: models can share data and errors.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Model / version<input className={field} value={other.name} onChange={e => change({ name: e.target.value })}/></label>
        <label className="text-sm">Source link<input className={field} type="url" placeholder="https://" value={other.url} onChange={e => change({ url: e.target.value })}/></label>
        <label className="text-sm">Published at, with timezone<input className={field} placeholder="2026-11-10T08:00:00-05:00" value={other.publishedAt} onChange={e => change({ publishedAt: e.target.value })}/></label>
        <label className="text-sm">Predicted {input.home} margin<input type="number" step="any" className={field} value={other.homeMargin ?? ''} onChange={e => change({ homeMargin: e.target.value === '' ? null : Number(e.target.value) })}/><span className="text-xs text-muted">Positive = home wins; negative = away wins. Not a sportsbook spread.</span></label>
        <label className="text-sm">Includes current lineup / injuries?<select className={field} value={other.injuryAware} onChange={e => change({ injuryAware: e.target.value as ExternalEstimate['injuryAware'] })}><option value="unknown">Unknown</option><option value="yes">Source says yes</option><option value="no">Source says no</option></select></label>
      </div>
      <button type="button" className="mt-3 rounded border border-border-strong p-2 text-sm font-bold" onClick={() => setChecked(true)}>Compare at this spread</button>
      {checked && <div role="status" className="mt-3 text-sm">{comparison.errors.length ? <ul>{comparison.errors.map(e => <li key={e}>{e}</li>)}</ul> : <><p>{comparison.agreement}</p><p>External points gap: {comparison.gap === null ? 'Spread unavailable' : comparison.gap.toFixed(2)} (positive favors home).</p><p>Injury awareness: {other.injuryAware}. Source and estimate are manually entered, not verified. No combined probability is calculated.</p></>}</div>}
    </details>
    <details><summary className="cursor-pointer text-sm font-bold">Testing status and standard</summary><p className="mt-2 text-xs text-muted">{report.testStatus}</p><p className="mt-2 text-xs text-muted">This screen compares spread scenarios only, not game totals. Historical favorite-cover frequency describes a sample, not why a specific team failed or its next-game probability.</p></details>
  </section>;
}
