import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { listRaces } from "@/lib/races";
import { listDrivers } from "@/lib/drivers";
import { listTracks } from "@/lib/tracks";

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function Dashboard() {
  await connection();
  const races = listRaces();
  const drivers = listDrivers();
  const tracks = listTracks();
  const upcoming = races.filter((r) => r.status === "upcoming").slice(0, 5);
  const recent = races.filter((r) => r.status === "complete").slice(0, 5);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Drivers", value: drivers.length },
            { label: "Tracks", value: tracks.length },
            { label: "Total Races", value: races.length },
            { label: "Completed", value: races.filter((r) => r.status === "complete").length },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">{s.label}</p>
              <p className="mt-2 text-3xl font-bold text-[var(--accent)]">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h2 className="font-semibold text-white">Upcoming Races</h2>
              <Link href="/races" className="text-xs text-[var(--muted)] hover:text-white transition-colors">All races →</Link>
            </div>
            {upcoming.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
                No upcoming races. <Link href="/races/new" className="text-[var(--accent)] hover:underline">Add one</Link>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {upcoming.map((r) => (
                  <li key={r.id}>
                    <Link href={`/races/${r.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-[var(--surface-raised)] transition-colors">
                      <div>
                        <p className="text-sm font-semibold text-white">{r.name}</p>
                        <p className="text-xs text-[var(--muted)] mt-0.5">{r.track_name} · {fmt.format(new Date(r.race_date + "T12:00:00"))}</p>
                      </div>
                      <span className="text-xs text-amber-400">{r.track_condition}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h2 className="font-semibold text-white">Recent Results</h2>
            </div>
            {recent.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">No completed races yet.</div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`/races/${r.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-[var(--surface-raised)] transition-colors">
                      <div>
                        <p className="text-sm font-semibold text-white">{r.name}</p>
                        <p className="text-xs text-[var(--muted)] mt-0.5">{r.track_name} · {fmt.format(new Date(r.race_date + "T12:00:00"))}</p>
                      </div>
                      <span className="rounded-full bg-green-500/20 px-2.5 py-0.5 text-xs font-semibold text-green-400">Complete</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--muted)]">Quick Actions</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { href: "/races/new", label: "New Race", sub: "Set up a race and generate odds" },
              { href: "/drivers/new", label: "Add Driver", sub: "Register a driver with history" },
              { href: "/tracks/new", label: "Add Track", sub: "Add a track to the database" },
            ].map((item) => (
              <Link key={item.href} href={item.href}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-raised)]">
                <p className="font-semibold text-white">{item.label}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{item.sub}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
