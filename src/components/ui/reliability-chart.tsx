"use client";

import { useId, useState } from "react";
import type { CalibrationBin } from "@/lib/model-reports";

/** Reliability diagram: observed hit rate against forecast probability.
 *  One series (the model) against a reference diagonal, so no legend box is needed.
 *  Dot size never encodes count; count is in the hover tooltip and the table view. */
export function ReliabilityChart({ bins, title = "Reliability", height = 220 }: { bins: CalibrationBin[]; title?: string; height?: number }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const live = bins.filter((b) => b.n > 0 && b.predicted !== null && b.observed !== null);
  const width = 320;
  const pad = { top: 10, right: 14, bottom: 30, left: 38 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxAxis = Math.max(0.2, ...live.map((b) => Math.max(b.predicted ?? 0, b.observed ?? 0)));
  const axisMax = maxAxis > 0.6 ? 1 : maxAxis > 0.3 ? 0.6 : maxAxis > 0.15 ? 0.3 : 0.15;
  const x = (v: number) => pad.left + (v / axisMax) * plotW;
  const y = (v: number) => pad.top + plotH - (v / axisMax) * plotH;
  const ticks = [0, axisMax / 4, axisMax / 2, (3 * axisMax) / 4, axisMax];
  const total = live.reduce((sum, b) => sum + b.n, 0);
  const activeBin = active === null ? null : live[active];

  if (live.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No settled forecasts yet, so there is nothing to calibrate.</p>;
  }

  return (
    <figure className="chart" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="chart-title">{title} · observed vs forecast</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full max-w-[420px]" role="img" aria-describedby={`${id}-desc`}>
        <desc id={`${id}-desc`}>Observed hit rate plotted against forecast probability for {total} settled forecasts in {live.length} bins.</desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" className="chart-tick">{Math.round(t * 100)}%</text>
            <text x={x(t)} y={pad.top + plotH + 16} textAnchor="middle" className="chart-tick">{Math.round(t * 100)}%</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(axisMax)} y2={y(axisMax)} className="chart-reference" />
        <text x={pad.left + plotW} y={pad.top + plotH + 28} textAnchor="end" className="chart-axis-label">forecast probability</text>
        {live.map((b, i) => {
          const cx = x(Math.min(b.predicted ?? 0, axisMax));
          const cy = y(Math.min(b.observed ?? 0, axisMax));
          return (
            <g key={`${b.lo}-${b.hi}`} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} tabIndex={0}>
              <circle cx={cx} cy={cy} r={12} fill="transparent" />
              <circle cx={cx} cy={cy} r={active === i ? 6 : 4.5} className="chart-dot" />
            </g>
          );
        })}
      </svg>
      <div className="chart-tooltip" aria-live="polite">
        {activeBin
          ? `${Math.round(activeBin.lo * 100)}–${Math.round(activeBin.hi * 100)}% bin: forecast ${(100 * (activeBin.predicted ?? 0)).toFixed(1)}%, observed ${(100 * (activeBin.observed ?? 0)).toFixed(1)}% over ${activeBin.n} forecasts`
          : `${total} forecasts. Dots on the line are calibrated; above it the model is underconfident, below it overconfident.`}
      </div>
      <details className="chart-table">
        <summary>Table view</summary>
        <table className="data-table mt-2">
          <thead><tr><th>Bin</th><th className="num">Forecasts</th><th className="num">Mean forecast</th><th className="num">Observed</th></tr></thead>
          <tbody>
            {live.map((b) => (
              <tr key={`${b.lo}-${b.hi}`}>
                <td>{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%</td>
                <td className="num">{b.n}</td>
                <td className="num">{(100 * (b.predicted ?? 0)).toFixed(1)}%</td>
                <td className="num">{(100 * (b.observed ?? 0)).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
