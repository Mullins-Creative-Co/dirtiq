"use client";

import { useState } from "react";

export type SeasonPoint = { label: string; model: number | null; market: number | null; n: number };

/** Dumbbell dot chart: model error and market error per season joined by a connector.
 *  Dots (not bars) so the axis may be truncated to the data range. Two series, so a
 *  legend is present; values appear in the hover line and the table view. */
export function SeasonDumbbell({ rows, unit = "pts", title }: { rows: SeasonPoint[]; unit?: string; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const live = rows.filter((r) => r.model !== null);
  if (live.length === 0) return <p className="text-sm text-[var(--muted)]">No seasons to show.</p>;
  const values = live.flatMap((r) => [r.model ?? NaN, r.market ?? NaN]).filter((v) => Number.isFinite(v));
  const span = Math.max(...values) - Math.min(...values) || 1;
  const max = Math.max(...values) + span * 0.15;
  const min = Math.min(...values) - span * 0.15;
  const width = 440;
  const height = 210;
  const pad = { top: 12, right: 10, bottom: 26, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / live.length;
  const y = (v: number) => pad.top + plotH - ((v - min) / (max - min)) * plotH;
  const ticks = [min + span * 0.15, (min + max) / 2, max - span * 0.15];
  const activeRow = active === null ? null : live[active];
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full max-w-[520px]" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={pad.left - 5} y={y(t) + 3} textAnchor="end" className="chart-tick">{t.toFixed(1)}</text>
          </g>
        ))}
        {live.map((r, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const base = pad.top + plotH;
          const ym = y(r.model ?? min);
          return (
            <g key={r.label} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={plotH} fill="transparent" />
              {r.market !== null ? <line x1={cx} x2={cx} y1={ym} y2={y(r.market)} className="chart-connector" /> : null}
              {r.market !== null ? <circle cx={cx} cy={y(r.market)} r={4.5} className="chart-dot-muted" /> : null}
              <circle cx={cx} cy={ym} r={active === i ? 6 : 4.5} className="chart-dot" />
              <text x={cx} y={base + 14} textAnchor="middle" className="chart-tick">{r.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><i className="swatch swatch-accent" style={{ borderRadius: 999 }} />Model</span>
        <span><i className="swatch swatch-muted" style={{ borderRadius: 999 }} />Market</span>
      </div>
      <div className="chart-tooltip" aria-live="polite">
        {activeRow
          ? `${activeRow.label}: model ${activeRow.model?.toFixed(2)} ${unit}, market ${activeRow.market === null ? "n/a" : `${activeRow.market.toFixed(2)} ${unit}`}, ${activeRow.n} games`
          : `Mean absolute error of the projected margin by season; lower is better. Axis spans the data range.`}
      </div>
      <details className="chart-table">
        <summary>Table view</summary>
        <table className="data-table mt-2">
          <thead><tr><th>Season</th><th className="num">Games</th><th className="num">Model</th><th className="num">Market</th></tr></thead>
          <tbody>{live.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{r.n}</td><td className="num">{r.model?.toFixed(2)}</td><td className="num">{r.market === null ? "—" : r.market.toFixed(2)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
