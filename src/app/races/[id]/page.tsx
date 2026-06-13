import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getRace, getRaceEntries } from "@/lib/races";
import { calculateRaceOdds, type DriverOdds } from "@/lib/odds";
import { listDrivers } from "@/lib/drivers";
import { AddEntryForm } from "@/components/add-entry-form";
import { RecordResultsForm } from "@/components/record-results-form";

const fmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

function pct(n: number | null) {
  if (n === null) return "—";
  return `${Math.round(n * 100)}%`;
}

function OddsChip({ odds }: { odds: string }) {
  const negative = odds.startsWith("-");
  return (
    <span className={`font-bold tabular-nums text-lg ${negative ? "text-green-400" : parseInt(odds) <= 300 ? "text-amber-400" : "text-slate-400"}`}>
      {odds}
    </span>
  );
}

function ReasoningCard({ d }: { d: DriverOdds }) {
  const r = d.reasoning;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-[var(--muted)] w-8 text-center">{d.carNumber ?? "—"}</span>
          <div>
            <div className="font-bold text-white text-base">{d.driverName}</div>
            <div className="text-xs text-[var(--muted)]">Win prob {pct(d.impliedProbability)}</div>
          </div>
        </div>
        <OddsChip odds={d.americanOdds} />
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-[var(--border)]">
        {[
          { label: "Track W%", value: r.trackStarts > 0 ? pct(r.trackWinRate) : "No data", sub: `${r.trackStarts} starts` },
          { label: "Sim Track W%", value: r.similarTrackStarts > 0 ? pct(r.similarTrackWinRate) : "No data", sub: `${r.similarTrackStarts} wtd starts` },
          { label: "Season W%", value: pct(r.seasonWinRate), sub: `${r.seasonStarts} WoO starts` },
          { label: "QT Rate", value: pct(r.quickTimeRate), sub: "quick times/starts" },
          { label: "Heat W%", value: pct(r.heatWinRate), sub: "heat wins/starts" },
          { label: "DNF Risk", value: pct(r.dnfRate), sub: r.dnfRate && r.dnfRate > 0.15 ? "⚠ elevated" : "normal" },
        ].map((stat) => (
          <div key={stat.label} className="bg-[var(--surface)] px-3 py-3 text-center">
            <div className="text-xs text-[var(--muted)] mb-1">{stat.label}</div>
            <div className={`text-sm font-semibold ${stat.sub?.includes("⚠") ? "text-red-400" : "text-white"}`}>{stat.value}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>

      {(r.highlights.length > 0 || r.warnings.length > 0) && (
        <div className="px-5 py-3 space-y-1">
          {r.highlights.map((h, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-green-300">
              <span className="mt-0.5 shrink-0">▲</span><span>{h}</span>
            </div>
          ))}
          {r.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-red-300">
              <span className="mt-0.5 shrink-0">▼</span><span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function RacePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const raceId = parseInt(id, 10);
  if (isNaN(raceId)) notFound();
  const race = getRace(raceId);
  if (!race) notFound();

  // JSON round-trip makes SQLite rows plain objects (null-prototype → Object.prototype)
  // so they can be passed to "use client" components without React serialization errors.
  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const entries = plain(getRaceEntries(raceId));
  const odds = plain(calculateRaceOdds(raceId, race.track_id));
  const allDrivers = plain(listDrivers());
  const entryDriverIds = new Set(entries.map((e) => e.driver_id));
  const availableDrivers = allDrivers.filter((d) => !entryDriverIds.has(d.id));
  const isUpcoming = race.status === "upcoming";
  const isComplete = race.status === "complete";

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl px-6 py-10 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/races" className="text-xs text-[var(--muted)] hover:text-white transition-colors">← Races</Link>
            <h1 className="mt-1 text-3xl font-bold text-white">{race.name}</h1>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-[var(--muted)]">
              <span>{race.track_name}</span><span>·</span>
              <span>{fmt.format(new Date(race.race_date + "T12:00:00"))}</span><span>·</span>
              <span>{race.division}</span>
              {(race as any).distance && <><span>·</span><span>{(race as any).distance} laps</span></>}
              <span>·</span>
              <span className="text-amber-400">{race.track_condition}</span>
              {race.weather_notes && <><span>·</span><span>{race.weather_notes}</span></>}
            </div>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold shrink-0 ${isComplete ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}`}>
            {isComplete ? "Complete" : "Upcoming"}
          </span>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            {/* Quick odds table */}
            <section>
              <h2 className="text-base font-semibold text-white mb-3">
                {isComplete ? "Results" : "Odds Board"}
                {!isComplete && odds.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">{odds.length} entrants · 12% vig</span>
                )}
              </h2>
              {odds.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-sm text-[var(--muted)]">
                  Add drivers to the field to generate odds.
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                        {["Rank", "Driver", "#", "Odds", "Win%", "Track", "Sim Track", "Season", "QT%", "DNF%", ...(isComplete ? ["Finish"] : [])].map((h) => (
                          <th key={h} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${["Rank","Driver","#"].includes(h) ? "text-left" : "text-right"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {odds.map((d, i) => {
                        const entry = entries.find((e) => e.driver_id === d.driverId);
                        const r = d.reasoning;
                        return (
                          <tr key={d.driverId} className={`border-b border-[var(--border)] last:border-0 transition-colors ${isComplete && entry?.finishing_position === 1 ? "bg-amber-500/10" : "hover:bg-[var(--surface-raised)]"}`}>
                            <td className="px-3 py-2.5 text-[var(--muted)] text-xs">{i + 1}</td>
                            <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">{d.driverName}</td>
                            <td className="px-3 py-2.5 text-[var(--muted)] text-xs">{d.carNumber ?? "—"}</td>
                            <td className="px-3 py-2.5 text-right">
                              <OddsChip odds={d.americanOdds} />
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">{(d.impliedProbability * 100).toFixed(1)}%</td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">
                              {r.trackStarts > 0 ? `${pct(r.trackWinRate)} (${r.trackStarts})` : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">
                              {r.similarTrackStarts > 0 ? pct(r.similarTrackWinRate) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">
                              {r.seasonWinRate !== null ? pct(r.seasonWinRate) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">
                              {r.quickTimeRate !== null ? pct(r.quickTimeRate) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className={`px-3 py-2.5 text-right tabular-nums text-xs ${r.dnfRate && r.dnfRate > 0.15 ? "text-red-400" : "text-[var(--muted)]"}`}>
                              {r.dnfRate !== null ? pct(r.dnfRate) : <span className="text-slate-600">—</span>}
                            </td>
                            {isComplete && (
                              <td className="px-3 py-2.5 text-right">
                                {entry?.dnf ? <span className="text-red-400 font-medium text-xs">DNF</span>
                                  : entry?.finishing_position ? <span className={`text-xs ${entry.finishing_position === 1 ? "text-amber-400 font-bold" : "text-white"}`}>P{entry.finishing_position}</span>
                                  : <span className="text-[var(--muted)]">—</span>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Reasoning cards — top 10 */}
            {odds.length > 0 && !isComplete && (
              <section>
                <h2 className="text-base font-semibold text-white mb-3">
                  Why They&apos;re Favored
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">Top {Math.min(10, odds.length)} contenders</span>
                </h2>
                <div className="space-y-3">
                  {odds.slice(0, 10).map((d) => (
                    <ReasoningCard key={d.driverId} d={d} />
                  ))}
                </div>
                <p className="mt-4 text-xs text-[var(--muted)]">
                  Model weights: track history 35% · similar-track history 25% · season win% 20% · quick time rate 10% · heat win rate 10% · DNF risk −15% penalty · momentum 10% bonus
                </p>
              </section>
            )}
          </div>

          <aside className="space-y-5">
            {isUpcoming && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-white mb-4">Add to Field</h3>
                {availableDrivers.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">All drivers are in the field.</p>
                ) : (
                  <AddEntryForm raceId={raceId} drivers={availableDrivers} />
                )}
              </div>
            )}
            {isUpcoming && entries.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-white mb-4">Record Results</h3>
                <RecordResultsForm raceId={raceId} entries={entries} />
              </div>
            )}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h3 className="font-semibold text-white mb-3">Field</h3>
              <div className="space-y-1 text-sm text-[var(--muted)] max-h-64 overflow-y-auto pr-1">
                {entries.length === 0 ? (
                  <span className="text-xs">No entries yet.</span>
                ) : (
                  entries.map((e) => (
                    <div key={e.id} className="flex items-center gap-2">
                      <span className="font-mono text-xs w-10 text-right text-amber-400">{e.car_number ?? "?"}</span>
                      <span>{e.driver_name}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
