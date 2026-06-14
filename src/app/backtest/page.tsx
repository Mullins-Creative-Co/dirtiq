import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { runBacktest, type BacktestResult } from "@/lib/simulate";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const usd2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// ── Inline SVG line chart for cumulative P&L paths ──────────────────────────
function PLChart({ paths, racesRun }: { paths: BacktestResult["summary"]["cumPaths"]; racesRun: number }) {
  if (racesRun === 0) return null;

  const W = 600, H = 220, PAD = { top: 20, right: 20, bottom: 30, left: 60 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const allVals = [...paths.p10, ...paths.p50, ...paths.p90, 0];
  const minY = Math.min(...allVals);
  const maxY = Math.max(...allVals);
  const range = maxY - minY || 1;

  function toX(i: number) {
    return PAD.left + (i / (racesRun - 1 || 1)) * innerW;
  }
  function toY(v: number) {
    return PAD.top + innerH - ((v - minY) / range) * innerH;
  }

  function pathD(values: number[]) {
    return values
      .map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`)
      .join(" ");
  }

  const zeroY = toY(0);

  // Y-axis tick values
  const ticks = 5;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => minY + (range / ticks) * i);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
      {/* Zero line */}
      <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY}
        stroke="#ffffff20" strokeWidth="1" strokeDasharray="4 3" />

      {/* Y-axis ticks */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.left - 4} y1={toY(v)} x2={PAD.left} y2={toY(v)} stroke="#ffffff30" strokeWidth="1" />
          <text x={PAD.left - 7} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#ffffff50">
            {v >= 0 ? `+${usd(v)}` : usd(v)}
          </text>
        </g>
      ))}

      {/* X-axis race labels */}
      {paths.p50.map((_, i) => (
        <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#ffffff40">
          R{i + 1}
        </text>
      ))}

      {/* Shaded band between p10 and p90 */}
      <path
        d={`${pathD(paths.p10)} ${[...paths.p90].reverse().map((v, i) => {
          const ri = racesRun - 1 - i;
          return `L ${toX(ri).toFixed(1)} ${toY(v).toFixed(1)}`;
        }).join(" ")} Z`}
        fill="#3b82f620"
        stroke="none"
      />

      {/* p10 line */}
      <path d={pathD(paths.p10)} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 2" />
      {/* p90 line */}
      <path d={pathD(paths.p90)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4 2" />
      {/* p50 median line */}
      <path d={pathD(paths.p50)} fill="none" stroke="#3b82f6" strokeWidth="2.5" />

      {/* Legend */}
      <g transform={`translate(${PAD.left + 8}, ${PAD.top + 8})`}>
        <line x1="0" y1="6" x2="18" y2="6" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4 2" />
        <text x="22" y="9" fontSize="9" fill="#22c55e">90th pct</text>
        <line x1="60" y1="6" x2="78" y2="6" stroke="#3b82f6" strokeWidth="2.5" />
        <text x="82" y="9" fontSize="9" fill="#3b82f6">median</text>
        <line x1="128" y1="6" x2="146" y2="6" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 2" />
        <text x="150" y="9" fontSize="9" fill="#ef4444">10th pct</text>
      </g>
    </svg>
  );
}

export default async function BacktestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await connection();
  const sp = await searchParams;

  const params = {
    bettorsPerRace: Math.min(200, Math.max(5, parseInt(sp.bettors ?? "30", 10))),
    stakePerBet: Math.min(500, Math.max(1, parseFloat(sp.stake ?? "20"))),
    squareness: Math.min(3, Math.max(0, parseFloat(sp.squareness ?? "1.5"))),
    numSimulations: 500,
  };

  const result = runBacktest(params);
  const { summary, races } = result;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-white">Backtest</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Replays {summary.racesRun} completed races with {params.numSimulations} Monte Carlo simulations per race to model sportsbook risk.
          </p>
        </div>

        {/* Parameter form */}
        <form method="GET" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-end gap-5">
            <div className="space-y-1.5">
              <label className="block text-xs text-[var(--muted)]">Bettors / race</label>
              <input name="bettors" type="number" min="5" max="200" defaultValue={params.bettorsPerRace}
                className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-[var(--muted)]">Flat stake ($)</label>
              <input name="stake" type="number" min="1" max="500" step="1" defaultValue={params.stakePerBet}
                className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-[var(--muted)]">
                Bettor profile
                <span className="ml-1 text-slate-600">(0=random · 1=prob · 2=chalk)</span>
              </label>
              <input name="squareness" type="number" min="0" max="3" step="0.5" defaultValue={params.squareness}
                className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
            </div>
            <button type="submit"
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:opacity-90">
              Run
            </button>
          </div>
        </form>

        {summary.racesRun === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center text-sm text-[var(--muted)]">
            No completed races found. Record results to run a backtest.
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Handle", value: usd(summary.meanTotalHandle), sub: `${summary.racesRun} races · ${params.bettorsPerRace} bettors each` },
                { label: "Expected Profit", value: usd2(summary.meanTotalPL), sub: `Hold: ${pct(summary.holdPct)}`, positive: summary.meanTotalPL > 0 },
                { label: "Worst Race (mean)", value: usd2(summary.worstRaceMeanPL), sub: "expected worst-case single race", negative: summary.worstRaceMeanPL < 0 },
                { label: "Bankroll Needed", value: usd(summary.bankrollFor95Survival), sub: "covers 95% of simulated paths", neutral: true },
              ].map((c) => (
                <div key={c.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
                  <div className="text-xs text-[var(--muted)] mb-1">{c.label}</div>
                  <div className={`text-xl font-bold tabular-nums ${"negative" in c && c.negative ? "text-red-400" : "positive" in c && c.positive ? "text-green-400" : "text-white"}`}>
                    {c.value}
                  </div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">{c.sub}</div>
                </div>
              ))}
            </div>

            {/* Model accuracy */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "Model Favorite Won", value: `${summary.favoriteWonCount}/${summary.racesRun}`, sub: `${pct(summary.favoriteWonCount / summary.racesRun)} hit rate`, note: "base rate ~10%" },
                { label: "Winner in Top 3", value: `${summary.top3WonCount}/${summary.racesRun}`, sub: `${pct(summary.top3WonCount / summary.racesRun)} of races`, note: "base rate ~25%" },
                { label: "Avg Winner Rank", value: summary.meanWinnerRank.toFixed(1), sub: "model's rank for actual winner", note: "1.0 = perfect" },
              ].map((c) => (
                <div key={c.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
                  <div className="text-xs text-[var(--muted)] mb-1">{c.label}</div>
                  <div className="text-2xl font-bold text-white">{c.value}</div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">{c.sub}</div>
                  <div className="text-[10px] text-slate-600 mt-0.5">{c.note}</div>
                </div>
              ))}
            </div>

            {/* Cumulative P&L chart */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="text-sm font-semibold text-white mb-1">Cumulative P&L — Simulated Paths</h2>
              <p className="text-xs text-[var(--muted)] mb-4">
                500 Monte Carlo simulations. Shaded band = 10th–90th percentile range. Blue line = median outcome.
              </p>
              <PLChart paths={summary.cumPaths} racesRun={summary.racesRun} />
            </div>

            {/* Race-by-race table */}
            <section>
              <h2 className="text-base font-semibold text-white mb-3">Race Breakdown</h2>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                      {["Race", "Date", "Field", "Model Pick", "Actual Winner", "Odds", "Rank", "Handle", "Median P&L", "10th/90th"].map((h) => (
                        <th key={h} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${["Race", "Model Pick", "Actual Winner"].includes(h) ? "text-left" : "text-right"}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {races.map((r) => (
                      <tr key={r.raceId}
                        className={`border-b border-[var(--border)] last:border-0 transition-colors ${r.modelFavoriteWon ? "bg-green-500/5" : "hover:bg-[var(--surface-raised)]"}`}>
                        <td className="px-3 py-2.5">
                          <Link href={`/races/${r.raceId}`} className="text-white font-medium hover:text-[var(--accent)] transition-colors">
                            {r.raceName}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-[var(--muted)] whitespace-nowrap tabular-nums">
                          {fmt.format(new Date(r.raceDate + "T12:00:00"))}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-[var(--muted)] tabular-nums">{r.fieldSize}</td>
                        <td className="px-3 py-2.5 text-xs">
                          <span className={r.modelFavoriteWon ? "text-green-400 font-semibold" : "text-[var(--muted)]"}>
                            {r.modelFavoriteName}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-medium text-white">{r.actualWinnerName}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-xs text-[var(--muted)]">{r.actualWinnerOdds}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                          <span className={`font-semibold ${r.actualWinnerModelRank === 1 ? "text-green-400" : r.actualWinnerModelRank <= 3 ? "text-amber-400" : "text-slate-500"}`}>
                            #{r.actualWinnerModelRank}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-xs text-[var(--muted)]">{usd(r.meanHandle)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                          <span className={r.meanHousePL >= 0 ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
                            {r.meanHousePL >= 0 ? "+" : ""}{usd2(r.meanHousePL)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[10px] text-[var(--muted)]">
                          {usd(r.p10HousePL)} / {usd(r.p90HousePL)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--border)] bg-[var(--surface-raised)]">
                      <td colSpan={7} className="px-3 py-2.5 text-xs text-[var(--muted)]">Total</td>
                      <td className="px-3 py-2.5 text-right text-xs font-semibold text-white tabular-nums">{usd(summary.meanTotalHandle)}</td>
                      <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums">
                        <span className={summary.meanTotalPL >= 0 ? "text-green-400" : "text-red-400"}>
                          {summary.meanTotalPL >= 0 ? "+" : ""}{usd2(summary.meanTotalPL)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[10px] text-[var(--muted)] tabular-nums">
                        {pct(summary.holdPct)} hold
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            {/* Risk interpretation */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3">
              <h2 className="text-sm font-semibold text-white">Risk Interpretation</h2>
              <div className="grid sm:grid-cols-2 gap-4 text-sm text-[var(--muted)]">
                <div className="space-y-2">
                  <p><span className="text-white font-medium">Hold %</span> — with 12% vig and this bettor mix, you keep ~{pct(summary.holdPct)} of handle long-run. Target is 8–10%.</p>
                  <p><span className="text-white font-medium">Bankroll needed ({usd(summary.bankrollFor95Survival)})</span> — the minimum reserve to absorb the worst 5% of simulated outcomes. This is your required operating capital.</p>
                </div>
                <div className="space-y-2">
                  <p><span className="text-white font-medium">Model accuracy</span> — favorite won {summary.favoriteWonCount}/{summary.racesRun} races. Random chance would predict {((1 / races.reduce((s, r) => s + r.fieldSize, 0) * races.length) * 100).toFixed(0)}%. A calibrated model improves line setting.</p>
                  <p><span className="text-white font-medium">Bettor profile (squareness={params.squareness})</span> — {params.squareness < 1 ? "uniform random bettors, no systematic bias" : params.squareness < 1.5 ? "probability-matching bettors (rational)" : "chalk-heavy bettors who over-bet favorites"}. Adjust to match your actual customer base.</p>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
