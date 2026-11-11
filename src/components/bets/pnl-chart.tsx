/** Cumulative profit over settled bets: one thin line on a zero baseline, direct value labels at the ends, per-point hover. */
export function PnlChart({ points, title }: { points: Array<{ at: string; label: string; profit: number; cumulative: number }>; title: string }) {
  if (points.length < 2) {
    return <p className="text-sm text-[var(--muted)]">The running total draws once two or more bets have settled.</p>;
  }
  const w = 720, h = 220, padL = 44, padR = 16, padT = 14, padB = 28;
  const ys = points.map((p) => p.cumulative);
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
  const span = hi - lo || 1;
  const x = (i: number) => padL + (i / (points.length - 1)) * (w - padL - padR);
  const y = (v: number) => padT + ((hi - v) / span) * (h - padT - padB);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const ticks = [lo, lo + span / 2, hi].map((v) => Math.round(v));
  const fmt = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title} className="h-auto w-full max-w-full" style={{ maxWidth: w }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.35 : 0.1} strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmt(t)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={`${p.at}-${i}`}>
            <circle cx={x(i)} cy={y(p.cumulative)} r={9} fill="transparent"><title>{`${p.at.slice(0, 10)} · ${p.label} · ${fmt(p.profit)} · running ${fmt(p.cumulative)}`}</title></circle>
            <circle cx={x(i)} cy={y(p.cumulative)} r={2.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
          </g>
        ))}
        <text x={x(points.length - 1)} y={y(last.cumulative) - 10} textAnchor="end" fontSize="12" fontWeight={700} fill="var(--foreground)">{fmt(last.cumulative)}</text>
        <text x={padL} y={h - 8} fontSize="11" fill="var(--muted)">{points[0].at.slice(0, 10)}</text>
        <text x={w - padR} y={h - 8} textAnchor="end" fontSize="11" fill="var(--muted)">{last.at.slice(0, 10)}</text>
      </svg>
      <figcaption className="mt-1 text-xs text-[var(--muted)]">{title}: running profit after each settled bet, in your stake currency.</figcaption>
    </figure>
  );
}
