import { connection } from "next/server";
import { Nav } from "@/components/nav";
import { computeFactorAccuracy, computeConditionBreakdown, getDriverFactorTable } from "@/lib/analytics";

function pct(n: number | null, decimals = 0) {
  if (n === null) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}

function AccuracyBar({ value, max = 1 }: { value: number | null; max?: number }) {
  if (value === null) return <span className="text-xs text-slate-600 italic">need more data</span>;
  const w = Math.round((value / max) * 100);
  const color = value >= 0.6 ? "bg-green-500" : value >= 0.4 ? "bg-amber-500" : "bg-slate-600";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-2 w-24 rounded-full bg-slate-800 shrink-0">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`text-xs tabular-nums font-semibold ${value >= 0.6 ? "text-green-400" : value >= 0.4 ? "text-amber-400" : "text-slate-500"}`}>
        {pct(value)}
      </span>
    </div>
  );
}

function WeightBar({ weight }: { weight: string }) {
  const num = parseFloat(weight.replace(/[^0-9.]/g, ""));
  const isNeg = weight.startsWith("−") || weight.startsWith("-");
  const w = Math.min(100, (num / 30) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-slate-800 shrink-0">
        <div className={`h-1.5 rounded-full ${isNeg ? "bg-red-500/70" : "bg-amber-500"}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`text-xs font-mono font-semibold tabular-nums ${isNeg ? "text-red-400" : "text-amber-400"}`}>{weight}</span>
    </div>
  );
}

export default async function ModelPage() {
  await connection();

  const factorAccuracy = computeFactorAccuracy();
  const conditions = computeConditionBreakdown();
  const driverTable = getDriverFactorTable();

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl px-6 py-10 space-y-10">

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold text-white">Model Training</h1>
            <span className="rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-semibold px-3 py-1">Not predictions</span>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)] max-w-2xl">
            This is the training and validation layer — factor weights, historical accuracy, and what the data says about each signal.
            Actual race predictions (odds boards) live under <a href="/races" className="text-amber-400 hover:underline">Races</a>.
          </p>
        </div>

        {/* How the model works */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
          <h2 className="text-base font-semibold text-white">How Odds Are Built</h2>
          <div className="grid sm:grid-cols-2 gap-4 text-sm text-[var(--muted)]">
            <div className="space-y-2">
              <p>
                dirtIQ blends two independent signals: a <strong className="text-white">composite score</strong> built
                from track/season stats (55% weight) and an <strong className="text-white">Elo rating</strong> seeded
                from dirtlatemodel.com and updated with every race result (45% weight).
              </p>
              <p>
                This prevents either signal from dominating: Elo provides broad historical context
                while the composite score captures recent form, track-specific history, and
                tonight&apos;s surface conditions.
              </p>
            </div>
            <div className="space-y-2">
              <p>
                Raw scores are converted to win probabilities, then a <strong className="text-white">12% vig</strong> is
                applied — matching standard sportsbook overround — to produce American odds.
              </p>
              <p>
                Feature Plus/Minus (positions gained in features) is tracked per driver and will
                gain weight as we accumulate starting-position data from MRP race syncs.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 pt-2 text-xs text-[var(--muted)]">
            <span className="rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 px-3 py-1">55% Composite (track + season stats)</span>
            <span className="rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 px-3 py-1">45% Elo (DLM-seeded, race-updated)</span>
            <span className="rounded-full bg-slate-700/50 border border-slate-600 px-3 py-1">12% vig applied</span>
          </div>
        </section>

        {/* Factor weights + accuracy */}
        <section>
          <h2 className="text-base font-semibold text-white mb-4">
            Factor Weights &amp; Predictive Accuracy
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">
              Accuracy = how often the driver best in that factor actually won
            </span>
          </h2>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                  {["Factor", "Weight", "What it measures", "Races", "Accuracy"].map((h) => (
                    <th key={h} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${h === "Factor" || h === "What it measures" ? "text-left" : "text-center"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {factorAccuracy.map((f) => (
                  <tr key={f.factor} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                    <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{f.factor}</td>
                    <td className="px-4 py-3"><WeightBar weight={f.weight} /></td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs max-w-xs">{f.description}</td>
                    <td className="px-4 py-3 text-center text-[var(--muted)] text-xs tabular-nums">
                      {f.racesWithData > 0 ? `${f.timesTopPickWon}/${f.racesWithData}` : "—"}
                    </td>
                    <td className="px-4 py-3 flex justify-center">
                      <AccuracyBar value={f.accuracy} />
                    </td>
                  </tr>
                ))}
                {/* Elo row */}
                <tr className="border-b border-[var(--border)] last:border-0 bg-blue-500/5 hover:bg-blue-500/10 transition-colors">
                  <td className="px-4 py-3 font-medium text-blue-300 whitespace-nowrap">Elo Rating</td>
                  <td className="px-4 py-3"><WeightBar weight="45% blend" /></td>
                  <td className="px-4 py-3 text-[var(--muted)] text-xs">DLM-seeded skill rating updated pairwise after every race result</td>
                  <td className="px-4 py-3 text-center text-[var(--muted)] text-xs tabular-nums">all races</td>
                  <td className="px-4 py-3 flex justify-center"><span className="text-xs text-blue-400">blended signal</span></td>
                </tr>
                <tr className="last:border-0 bg-slate-800/30 hover:bg-[var(--surface-raised)] transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-400 whitespace-nowrap">Feature +/−</td>
                  <td className="px-4 py-3"><WeightBar weight="5%" /></td>
                  <td className="px-4 py-3 text-[var(--muted)] text-xs">Avg positions gained in features — grows as MRP start data accumulates</td>
                  <td className="px-4 py-3 text-center text-slate-600 text-xs">no data yet</td>
                  <td className="px-4 py-3 flex justify-center"><span className="text-xs text-slate-600 italic">pending</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Accuracy uses only completed races with ≥3 data points per factor. Low sample sizes (shown as "—") mean accuracy isn't statistically meaningful yet.
          </p>
        </section>

        {/* Track condition breakdown */}
        {conditions.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-white mb-4">
              Winners by Track Condition
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">which drivers perform best on each surface</span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {conditions.map((c) => (
                <div key={c.condition} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-amber-400">{c.condition}</span>
                    <span className="text-xs text-[var(--muted)]">{c.races} race{c.races !== 1 ? "s" : ""}</span>
                  </div>
                  {c.topDrivers.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">No wins recorded yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {c.topDrivers.map((d) => (
                        <div key={d.name} className="flex items-center justify-between text-sm">
                          <span className="text-white">{d.name}</span>
                          <div className="flex items-center gap-2 text-xs text-[var(--muted)] tabular-nums">
                            <span className="text-amber-400 font-semibold">{d.wins}W</span>
                            <span>/ {d.starts} starts</span>
                            <span className="text-slate-600">({Math.round((d.wins / d.starts) * 100)}%)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {c.races < 5 && (
                    <p className="mt-3 text-[10px] text-slate-600 italic">
                      Small sample — add more races with this condition to improve reliability.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Driver factor table */}
        {driverTable.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-white mb-4">
              Driver Factor Breakdown
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">2026 WoO Late Model season stats</span>
            </h2>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Driver", "Starts", "Wins", "Win%", "Avg Fin", "Last 5", "QT%", "Heat W%", "DNF%"].map((h) => (
                      <th key={h} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${h === "Driver" ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {driverTable
                    .sort((a, b) => (b.seasonWins / Math.max(b.seasonStarts, 1)) - (a.seasonWins / Math.max(a.seasonStarts, 1)))
                    .map((d) => {
                      const winRate = d.seasonStarts > 0 ? d.seasonWins / d.seasonStarts : 0;
                      return (
                        <tr key={d.name} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                          <td className="px-3 py-2.5 font-medium text-white">{d.name}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">{d.seasonStarts}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <span className={d.seasonWins > 0 ? "text-amber-400 font-semibold" : "text-[var(--muted)]"}>{d.seasonWins}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <span className={winRate >= 0.2 ? "text-green-400" : winRate >= 0.1 ? "text-amber-400" : "text-[var(--muted)]"}>
                              {pct(d.seasonStarts > 0 ? winRate : null)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <span className={d.avgFinish != null && d.avgFinish <= 5 ? "text-green-400" : d.avgFinish != null && d.avgFinish <= 9 ? "text-amber-400" : "text-[var(--muted)]"}>
                              {d.avgFinish != null ? d.avgFinish.toFixed(1) : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <span className={d.last5Avg != null && d.last5Avg <= 4.5 ? "text-green-400 font-semibold" : d.last5Avg != null && d.last5Avg <= 9 ? "text-amber-400" : "text-[var(--muted)]"}>
                              {d.last5Avg != null ? d.last5Avg.toFixed(1) : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">{pct(d.qtRate)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">{pct(d.heatWinRate)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums text-xs ${d.dnfRate != null && d.dnfRate > 0.12 ? "text-red-400" : "text-[var(--muted)]"}`}>
                            {pct(d.dnfRate)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* What we're building toward */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-base font-semibold text-white mb-3">Factors Planned — More Data Needed</h2>
          <div className="grid sm:grid-cols-2 gap-3 text-sm text-[var(--muted)]">
            {[
              { name: "Feature +/−", desc: "Positions gained/lost per race. Populates after MRP syncs with start data. Drivers who consistently charge from mid-pack get a bonus." },
              { name: "Condition Win Rate", desc: "Win rate by surface condition (Tacky, Dry Slick, Cushion, etc.). Currently all tracked data is Tacky. Differentiation comes with more tagged races." },
              { name: "Weather Correlation", desc: "Precip/humidity in the 24hrs before a race affects track moisture. Will integrate Weather Underground data per race date once we have enough race history." },
              { name: "Track Rubber Buildup", desc: "Rubber accumulates across events at the same track — lap times and groove change. Will model as events-since-last-prep once track prep calendar is mapped." },
            ].map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{item.name}</div>
                <div className="text-xs leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
