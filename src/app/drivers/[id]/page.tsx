import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getDriver, getDriverStats } from "@/lib/drivers";
import { getDriverSpecialties } from "@/lib/driver-specialties";
import { listTracks } from "@/lib/tracks";
import { DriverIntelligenceEditor } from "@/components/driver-intelligence-editor";
import { getDb } from "@/lib/db";

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function DriverDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const driverId = parseInt(id, 10);
  if (isNaN(driverId)) notFound();

  const driver = getDriver(driverId);
  if (!driver) notFound();

  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const stats = getDriverStats(driverId);
  const specialties = plain(getDriverSpecialties(driverId));
  const allTracks = plain(listTracks());

  const recentRaces = getDb().prepare(`
    SELECT r.id, r.name, r.race_date, t.name AS track_name,
      re.finishing_position, re.starting_position, re.heat_position, re.dnf, re.laps_led
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    JOIN tracks t ON t.id = r.track_id
    WHERE re.driver_id = ? AND r.status = 'complete'
    ORDER BY r.race_date DESC
    LIMIT 15
  `).all(driverId) as Array<{
    id: number; name: string; race_date: string; track_name: string;
    finishing_position: number | null; starting_position: number | null;
    heat_position: number | null; dnf: number; laps_led: number;
  }>;

  const seasonStats = getDb().prepare(`
    SELECT * FROM driver_season_stats WHERE driver_id = ? ORDER BY season DESC LIMIT 3
  `).all(driverId) as Array<{
    season: number; series: string; starts: number; wins: number;
    top5: number; avg_finish: number | null; dnfs: number;
  }>;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10 space-y-8">

        {/* Header */}
        <div>
          <Link href="/drivers" className="text-xs text-[var(--muted)] hover:text-white transition-colors">← Drivers</Link>
          <div className="mt-2 flex items-start gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white">{driver.name}</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {driver.car_number && <span className="font-mono text-amber-400 mr-2">#{driver.car_number}</span>}
                {driver.division}
                {driver.hometown && <span> · {driver.hometown}</span>}
              </p>
            </div>
          </div>
        </div>

        {/* Career stats strip */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Starts", value: stats.total_starts },
            { label: "Wins", value: stats.wins, accent: true },
            { label: "Top 5", value: stats.top5 },
            { label: "Win %", value: `${(stats.win_pct * 100).toFixed(1)}%` },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center">
              <p className="text-[10px] uppercase tracking-widest text-[var(--muted)]">{s.label}</p>
              <p className={`mt-1 text-xl font-bold ${s.accent ? "text-[var(--accent)]" : "text-white"}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Season stats */}
        {seasonStats.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--muted)]">Season Stats</h2>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Season", "Series", "Starts", "Wins", "Top 5", "Avg Finish", "DNFs"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seasonStats.map((s) => (
                    <tr key={`${s.season}-${s.series}`} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3 font-semibold text-white">{s.season}</td>
                      <td className="px-4 py-3 text-[var(--muted)] text-xs">{s.series}</td>
                      <td className="px-4 py-3 text-white">{s.starts}</td>
                      <td className="px-4 py-3 font-semibold text-[var(--accent)]">{s.wins}</td>
                      <td className="px-4 py-3 text-white">{s.top5}</td>
                      <td className="px-4 py-3 text-white">{s.avg_finish?.toFixed(1) ?? "—"}</td>
                      <td className="px-4 py-3 text-red-400">{s.dnfs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Intelligence editor — specialties + AI suggest */}
        <DriverIntelligenceEditor
          driver={driver}
          specialties={specialties}
          allTracks={allTracks}
        />

        {/* Recent results */}
        {recentRaces.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--muted)]">Recent Results</h2>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Race", "Track", "Date", "Start", "Heat", "Finish"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentRaces.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/races/${r.id}`} className="text-white hover:text-[var(--accent)] transition-colors">{r.name}</Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)] text-xs">{r.track_name}</td>
                      <td className="px-4 py-3 text-[var(--muted)] text-xs">{fmt.format(new Date(r.race_date + "T12:00:00"))}</td>
                      <td className="px-4 py-3 text-[var(--muted)]">{r.starting_position ?? "—"}</td>
                      <td className="px-4 py-3 text-[var(--muted)]">{r.heat_position ?? "—"}</td>
                      <td className="px-4 py-3 font-semibold">
                        {r.dnf ? (
                          <span className="text-red-400">DNF</span>
                        ) : r.finishing_position === 1 ? (
                          <span className="text-[var(--accent)]">P1 🏆</span>
                        ) : r.finishing_position !== null ? (
                          <span className={r.finishing_position <= 3 ? "text-green-400" : "text-white"}>
                            P{r.finishing_position}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
