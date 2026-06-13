import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getRace, getRaceEntries } from "@/lib/races";
import { calculateRaceOdds, formatAmericanOdds } from "@/lib/odds";
import { listDrivers } from "@/lib/drivers";
import { AddEntryForm } from "@/components/add-entry-form";
import { RecordResultsForm } from "@/components/record-results-form";

const fmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

export default async function RacePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const raceId = parseInt(id, 10);
  if (isNaN(raceId)) notFound();
  const race = getRace(raceId);
  if (!race) notFound();

  const entries = getRaceEntries(raceId);
  const odds = calculateRaceOdds(raceId, race.track_id);
  const allDrivers = listDrivers();
  const entryDriverIds = new Set(entries.map((e) => e.driver_id));
  const availableDrivers = allDrivers.filter((d) => !entryDriverIds.has(d.id));
  const sortedOdds = [...odds].sort((a, b) => b.win_probability - a.win_probability);
  const isUpcoming = race.status === "upcoming";
  const isComplete = race.status === "complete";

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/races" className="text-xs text-[var(--muted)] hover:text-white transition-colors">← Races</Link>
            <h1 className="mt-1 text-3xl font-bold text-white">{race.name}</h1>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-[var(--muted)]">
              <span>{race.track_name}</span><span>·</span>
              <span>{fmt.format(new Date(race.race_date + "T12:00:00"))}</span><span>·</span>
              <span>{race.division}</span><span>·</span>
              <span className="text-amber-400">{race.track_condition}</span>
              {race.weather_notes && <><span>·</span><span>{race.weather_notes}</span></>}
            </div>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${isComplete ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}`}>
            {isComplete ? "Complete" : "Upcoming"}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-4">
            <h2 className="text-base font-semibold text-white">
              {isComplete ? "Results" : "Odds Board"}
              {!isComplete && entries.length > 0 && <span className="ml-2 text-xs font-normal text-[var(--muted)]">{entries.length} entrants · 12% vig</span>}
            </h2>
            {sortedOdds.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-sm text-[var(--muted)]">
                Add drivers to the field to generate odds.
              </div>
            ) : (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                      {["#", "Driver", "Car", "Odds", "Win %", "Track W", "Form", ...(isComplete ? ["Finish"] : [])].map((h) => (
                        <th key={h} className={`px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--muted)] ${h === "#" || h === "Driver" || h === "Car" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedOdds.map((d, i) => {
                      const entry = entries.find((e) => e.driver_id === d.driver_id);
                      return (
                        <tr key={d.driver_id} className={`border-b border-[var(--border)] last:border-0 transition-colors ${isComplete && entry?.finishing_position === 1 ? "bg-amber-500/10" : "hover:bg-[var(--surface-raised)]"}`}>
                          <td className="px-4 py-3 text-[var(--muted)]">{i + 1}</td>
                          <td className="px-4 py-3 font-semibold text-white">{d.driver_name}</td>
                          <td className="px-4 py-3 text-[var(--muted)]">{d.car_number ?? "—"}</td>
                          <td className={`px-4 py-3 text-right font-bold tabular-nums ${d.american_odds < 0 ? "text-green-400" : d.american_odds <= 300 ? "text-amber-400" : "text-[var(--muted)]"}`}>
                            {formatAmericanOdds(d.american_odds)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--muted)] tabular-nums">{(d.win_probability * 100).toFixed(1)}%</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)] tabular-nums">{d.track_wins}/{d.track_starts}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)] tabular-nums">{(d.recent_form_score * 100).toFixed(0)}</td>
                          {isComplete && (
                            <td className="px-4 py-3 text-right">
                              {entry?.dnf ? <span className="text-red-400 font-medium">DNF</span>
                                : entry?.finishing_position ? <span className={entry.finishing_position === 1 ? "text-[var(--accent)] font-bold" : "text-white"}>P{entry.finishing_position}</span>
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
            {entries.length > 0 && !isComplete && (
              <p className="text-xs text-[var(--muted)]">Weights: track history 45% · recent form 35% · overall win rate 20%. Flat distribution when no data.</p>
            )}
          </section>

          <aside className="space-y-5">
            {isUpcoming && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-white mb-4">Add to Field</h3>
                {availableDrivers.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">All registered drivers are in the field. <Link href="/drivers/new" className="text-[var(--accent)] hover:underline">Add more drivers</Link></p>
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
            {entries.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-white mb-3">Field ({entries.length})</h3>
                <ul className="space-y-2">
                  {entries.map((e) => (
                    <li key={e.id} className="flex items-center justify-between text-sm">
                      <span className="text-white">{e.driver_name}</span>
                      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                        {e.car_number && <span>#{e.car_number}</span>}
                        {e.starting_position && <span>P{e.starting_position}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
