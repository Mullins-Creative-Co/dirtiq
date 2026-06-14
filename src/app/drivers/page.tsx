import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { listDrivers, getDriverStats } from "@/lib/drivers";

export default async function DriversPage() {
  await connection();
  const drivers = listDrivers().map((d) => ({ ...d, stats: getDriverStats(d.id) }));
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Drivers <span className="text-sm font-normal text-[var(--muted)]">({drivers.length})</span></h1>
          <Link href="/drivers/new" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 transition-opacity">+ Add Driver</Link>
        </div>
        {drivers.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
            <p className="text-[var(--muted)]">No drivers yet.</p>
            <Link href="/drivers/new" className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline">Add your first driver</Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                  {["Driver", "Car #", "Division", "Hometown", "Starts", "Wins", "Win %", "Top 5", "DNFs"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                    <td className="px-4 py-3 font-semibold text-white">{d.name}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{d.car_number ?? "—"}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{d.division}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{d.hometown ?? "—"}</td>
                    <td className="px-4 py-3 text-white">{d.stats.total_starts}</td>
                    <td className="px-4 py-3 font-semibold text-[var(--accent)]">{d.stats.wins}</td>
                    <td className="px-4 py-3 text-white">{(d.stats.win_pct * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-white">{d.stats.top5}</td>
                    <td className="px-4 py-3 text-red-400">{d.stats.dnfs}</td>
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
