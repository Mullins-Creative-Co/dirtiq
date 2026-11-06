import type { InputReadiness, ResearchReport } from '@/lib/football/research';
import { QbSegments } from './qb-segments';

const points = (n: number | null) => n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(3)}`;

export function ResearchPanel({ report, readiness }: { report: ResearchReport; readiness: InputReadiness }) {
  const best = [...report.rows].sort((a, b) => a.mae-b.mae)[0];
  const market = best.marketMae;
  return <div className="space-y-6">
    <section className="panel-raised p-5 sm:p-7">
      <p className="text-xs font-bold uppercase tracking-widest text-accent">Completed development comparison</p>
      <h2 className="mt-3 font-display text-2xl font-black sm:text-3xl">Does each new input earn its place?</h2>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-strong">Ten model variants use the same earlier-game data and fixed settings. Each new input is compared with the model it extends. Improvements must survive later development periods, not just look good on the games used to fit the weights.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-border p-4"><p className="text-xs text-muted">Development games</p><p className="mt-2 text-3xl font-black">{report.games}</p><p className="mt-2 text-xs text-muted">2023–2024 + 2025 weeks 1–9</p></div>
        <div className="rounded border border-border p-4"><p className="text-xs text-muted">Market margin error</p><p className="mt-2 text-3xl font-black">{market.toFixed(2)} <span className="text-sm">pts</span></p><p className="mt-2 text-xs text-muted">Mean absolute error; lower is better</p></div>
        <div className="rounded border border-border p-4"><p className="text-xs text-muted">Best model margin error</p><p className="mt-2 text-3xl font-black">{best.mae.toFixed(2)} <span className="text-sm">pts</span></p><p className="mt-2 text-xs text-muted">{best.model}</p></div>
      </div>
      <p className="mt-5 rounded border border-amber-400/25 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-100">{best.mae >= market ? 'The market remains more accurate than every current model on these development games. No betting edge is established.' : 'A model has lower development error than the market. This is a research result that still needs the untouched final test and verified price timing.'}</p>
    </section>

    <section className="panel overflow-hidden"><div className="p-5"><h2 className="text-xl font-bold">Incremental information test</h2><p className="mt-3 text-sm leading-relaxed text-muted-strong">Negative error change means improvement against the named parent. The interval uses weekly-block resampling with a conservative adjustment for {report.comparisons} comparisons. “Repeated” means lower error in both 2024 and the first nine weeks of 2025.</p></div>
      <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><caption className="sr-only">Model additions and development evidence</caption><thead className="bg-surface-raised text-muted"><tr>{['Model', 'Compared with', 'Error (pts)', 'Error change', `${(report.intervalConfidence*100).toFixed(1)}% interval`, 'Repeated', 'Evidence'].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.model} className="border-t border-border"><th className="px-4 py-4 font-semibold">{row.model}</th><td className="px-4 py-4 text-muted-strong">{row.parent ?? '—'}</td><td className="px-4 py-4">{row.mae.toFixed(3)}</td><td className="px-4 py-4">{points(row.delta)}</td><td className="px-4 py-4">{row.low === null ? '—' : `${points(row.low)} to ${points(row.high)}`}</td><td className="px-4 py-4">{row.parent ? row.consistentValidation ? 'Yes' : 'No' : '—'}</td><td className="px-4 py-4">{row.status}</td></tr>)}</tbody></table></div>
      <p className="p-5 text-xs leading-relaxed text-muted">A candidate increment is an improvement over its parent, not proof of an advantage against sportsbook prices. Development has been inspected; it is no longer an untouched test.</p>
    </section>

    <QbSegments segments={report.segments} />

    <section className="panel p-5"><h2 className="text-xl font-bold">Does it carry forward?</h2><div className="mt-5 grid gap-4 lg:grid-cols-3">{report.byPeriod.map(period => <div key={period.period} className="rounded border border-border p-4"><h3 className="text-sm font-bold">{period.period}</h3><p className="mt-2 text-xs text-muted">Market error: {period.rows[0].marketMae.toFixed(2)} pts</p><dl className="mt-4 space-y-2">{period.rows.map(row => <div key={row.model} className="flex justify-between gap-2 text-xs"><dt className="text-muted-strong">{row.model}</dt><dd>{row.mae.toFixed(2)}</dd></div>)}</dl></div>)}</div></section>

    <section className="panel p-5"><p className="text-xs font-bold uppercase tracking-widest text-accent">Final check remains unrun</p><h2 className="mt-3 text-xl font-bold">2025 week 10 onward</h2><p className="mt-3 text-sm leading-relaxed text-muted-strong">Develop and choose the rules using earlier periods first. The final check freezes coefficients and training weights before week 10. Later pregame features can update from games already completed, as they would during live use; those outcomes never enter fitting.</p><p className="mt-3 text-xs text-muted">The final check is available explicitly in Historical backtest. This report has not evaluated it.</p></section>

    <section className="panel p-5"><h2 className="text-xl font-bold">What is actually implemented?</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{report.rows.map(row => <article key={row.model} className="rounded border border-border p-4"><h3 className="text-sm font-bold">{row.model}</h3><p className="mt-2 text-xs leading-relaxed text-muted-strong">{row.description}</p></article>)}</div></section>

    <section className="panel p-5"><h2 className="text-xl font-bold">Injury and forecast data readiness</h2><p className="mt-3 text-sm leading-relaxed text-muted-strong">Missing information is not treated as a healthy roster or calm weather. These inputs remain excluded until we can verify what was available at prediction time.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{readiness.injuries.map(row => <article key={row.season} className="rounded border border-border p-4"><h3 className="text-sm font-bold">{row.season} injury archive</h3><p className="mt-2 text-xs text-muted-strong">{row.rows.toLocaleString('en-US')} reports · {row.timestamped.toLocaleString('en-US')} with modification timestamps</p><p className="mt-3 text-xs leading-relaxed text-amber-100">{row.status}</p></article>)}</div><p className="mt-4 text-sm text-muted-strong">Next data requirement: {readiness.nextRequirement}</p><p className="mt-3 text-xs text-muted">No current-game prediction or live betting recommendation is generated.</p></section>

    <details className="panel p-5"><summary className="cursor-pointer font-bold">Method, limitations, and reproducibility</summary><ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-relaxed text-muted-strong">{report.limits.map(limit => <li key={limit}>{limit}</li>)}</ul><p className="mt-5 break-words text-xs text-muted">Built {report.generatedAt}. Source: {report.source.provider}, snapshot {report.source.builtAt}. Data SHA-256: {report.sourceSha256}. Settings: {JSON.stringify(report.settings)}.</p><a className="mt-4 inline-block text-sm text-accent underline" href="/football/research.json" download="football-research.json">Download this research report</a></details>
  </div>;
}
