import { Nav } from "@/components/nav";
import { featuredPicks, featuredRaces } from "@/lib/featured-board";

const pct = (value: string) => value;

function numericPercent(value: string) {
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function confidenceClass(confidence: string) {
  if (confidence === "Core") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-300";
  if (confidence === "Lean") return "border-amber-400/30 bg-amber-500/10 text-amber-300";
  return "border-slate-500/30 bg-slate-500/10 text-slate-300";
}

function marketClass(market: string) {
  if (market === "Outright") return "text-red-300";
  if (market === "Top 3" || market === "Top 5" || market === "Top 10") return "text-sky-300";
  if (market === "Matchup") return "text-violet-300";
  if (market === "Caution Free") return "text-emerald-300";
  return "text-fuchsia-300";
}

export default function FeaturedLinesAdminPage() {
  const races = featuredRaces.map((race) => {
    const picks = featuredPicks
      .filter((pick) => pick.raceId === race.id)
      .sort((a, b) => numericPercent(b.edge) - numericPercent(a.edge));
    const bestEdge = picks.reduce((best, pick) => Math.max(best, numericPercent(pick.edge)), 0);
    const coreCount = picks.filter((pick) => pick.confidence === "Core").length;
    return { ...race, picks, bestEdge, coreCount };
  });

  const smoky = races.filter((race) => race.track === "Smoky Mountain Speedway");
  const allPicks = races.flatMap((race) => race.picks.map((pick) => ({ race, pick })));
  const bestLines = [...allPicks]
    .sort((a, b) => numericPercent(b.pick.edge) - numericPercent(a.pick.edge))
    .slice(0, 5);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <section className="border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent)]">
            Admin analytics
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-white">Featured Line Details</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Inspect the public lobby lines by race, market, model probability, edge, stake,
                confidence, and rationale before deciding what should stay bettable.
              </p>
            </div>
            <div className="grid grid-cols-3 border border-[var(--border)] bg-[var(--surface-raised)] text-center">
              <div className="px-4 py-3">
                <div className="text-2xl font-black text-white">{races.length}</div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Races</div>
              </div>
              <div className="border-x border-[var(--border)] px-4 py-3">
                <div className="text-2xl font-black text-white">{featuredPicks.length}</div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Lines</div>
              </div>
              <div className="px-4 py-3">
                <div className="text-2xl font-black text-emerald-300">
                  +{Math.max(...featuredPicks.map((pick) => numericPercent(pick.edge))).toFixed(1)}%
                </div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Best edge</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {smoky.map((race) => (
            <article key={race.id} className="border border-amber-400/25 bg-amber-400/[0.04] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">
                    Smoky Mountain analytics
                  </p>
                  <h2 className="mt-2 text-xl font-black text-white">{race.raceName}</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {race.dateLabel} · {race.purse} · {race.picks.length} lines
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black text-emerald-300">
                    +{race.bestEdge.toFixed(1)}%
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Top edge</div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">{race.note}</p>
            </article>
          ))}
        </section>

        <section className="border border-blue-400/25 bg-blue-400/[0.04] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-300">
                Smoky source evidence
              </p>
              <h2 className="mt-2 text-xl font-black text-white">Track-specific results now matter</h2>
            </div>
            <a
              href="https://www.smokymountainspeedway.com/results.html"
              target="_blank"
              rel="noreferrer"
              className="border border-blue-300/30 px-3 py-2 text-xs font-bold text-blue-200 hover:bg-blue-300/10"
            >
              Open source
            </a>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              {
                label: "Overton",
                detail: "2024 Mountain Moonshine Night 2 winner from pole; Night 1 P7 from P5; strong 2026 Tipoff run before crash.",
              },
              {
                label: "RTJ",
                detail: "2024 Night 1 winner after quick time, heat win, and leading all 40 laps; runner-up on Night 2.",
              },
              {
                label: "Style",
                detail: "Official recaps repeatedly mention outside-line momentum, slower traffic, restarts, and high-banked rhythm.",
              },
            ].map((item) => (
              <div key={item.label} className="border border-white/10 bg-slate-950/45 p-4">
                <p className="text-sm font-black text-white">{item.label}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="text-base font-bold text-white">Best Edges On The Board</h2>
          </div>
          <div className="grid gap-0 divide-y divide-[var(--border)]">
            {bestLines.map(({ race, pick }) => (
              <div key={`${race.id}-${pick.market}-${pick.selection}`} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_110px_110px_110px]">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    {race.raceName}
                  </p>
                  <h3 className="mt-1 font-bold text-white">{pick.selection}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{pick.note}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Market</p>
                  <p className={`mt-1 text-sm font-black ${marketClass(pick.market)}`}>{pick.market}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Line / Model</p>
                  <p className="mt-1 font-mono text-sm font-black text-white">{pick.line}</p>
                  <p className="text-xs text-slate-400">{pct(pick.model)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Edge / Stake</p>
                  <p className="mt-1 text-sm font-black text-emerald-300">{pick.edge}</p>
                  <p className="text-xs text-amber-300">{pick.stake}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-5">
          {races.map((race) => (
            <article key={race.id} className="border border-[var(--border)] bg-[var(--surface)]">
              <div className="border-b border-[var(--border)] px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                      {race.series}
                    </p>
                    <h2 className="mt-1 text-xl font-black text-white">{race.raceName}</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      {race.track} · {race.location} · {race.dateLabel}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 border border-[var(--border)] bg-[var(--surface-raised)] text-center text-xs">
                    <div className="px-3 py-2">
                      <div className="font-black text-white">{race.picks.length}</div>
                      <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Lines</div>
                    </div>
                    <div className="border-x border-[var(--border)] px-3 py-2">
                      <div className="font-black text-emerald-300">+{race.bestEdge.toFixed(1)}%</div>
                      <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Best</div>
                    </div>
                    <div className="px-3 py-2">
                      <div className="font-black text-amber-300">{race.coreCount}</div>
                      <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Core</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                      {["Market", "Selection", "Line", "Model", "Edge", "Stake", "Confidence", "Rationale"].map((head) => (
                        <th key={head} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {race.picks.map((pick) => (
                      <tr key={`${pick.market}-${pick.selection}`} className="border-b border-[var(--border)] last:border-0">
                        <td className={`px-4 py-3 text-xs font-black ${marketClass(pick.market)}`}>{pick.market}</td>
                        <td className="px-4 py-3 font-bold text-white">{pick.selection}</td>
                        <td className="px-4 py-3 font-mono text-xs font-black text-amber-300">{pick.line}</td>
                        <td className="px-4 py-3 font-mono text-xs text-white">{pick.model}</td>
                        <td className="px-4 py-3 font-mono text-xs font-black text-emerald-300">{pick.edge}</td>
                        <td className="px-4 py-3 font-mono text-xs text-white">{pick.stake}</td>
                        <td className="px-4 py-3">
                          <span className={`border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${confidenceClass(pick.confidence)}`}>
                            {pick.confidence}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm leading-6 text-slate-300">{pick.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
