import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { listRaces } from "@/lib/races";

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function RacesPage() {
  await connection();
  const races = listRaces();
  const upcoming = races.filter((r) => r.status === "upcoming").length;
  const completed = races.filter((r) => r.status === "complete").length;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Races</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">{upcoming} upcoming · {completed} complete</p>
          </div>
          <Link href="/races/new" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90">+ New Race</Link>
        </div>
        {races.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
            <p className="text-[var(--muted)]">No races yet.</p>
            <Link href="/races/new" className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline">Create your first race</Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                  {["Race", "Track", "Date", "Division", "Condition", "Status", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {races.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                    <td className="px-4 py-3 font-semibold text-white">{r.name}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{r.track_name}</td>
                    <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap">{fmt.format(new Date(r.race_date + "T12:00:00"))}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{r.division}</td>
                    <td className="px-4 py-3 text-amber-400">{r.track_condition}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.status === "upcoming" ? "bg-amber-500/20 text-amber-400" : r.status === "complete" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/races/${r.id}`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:text-white hover:border-[var(--accent)] transition-colors">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
