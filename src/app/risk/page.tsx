import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { listRaces } from "@/lib/races";
import { getBookSummary, getDriverLiabilities, getRiskLimits } from "@/lib/book";

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function PLCell({ value }: { value: number }) {
  if (value === 0) return <span className="text-[var(--muted)]">—</span>;
  return (
    <span className={`tabular-nums font-semibold ${value > 0 ? "text-green-400" : "text-red-400"}`}>
      {value > 0 ? "+" : ""}{usd(value)}
    </span>
  );
}

export default async function RiskPage() {
  await connection();
  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const allRaces = plain(listRaces());
  const upcoming = allRaces.filter((r: { status: string }) => r.status === "upcoming");
  const complete = allRaces.filter((r: { status: string }) => r.status === "complete").slice(0, 10);

  type RaceRisk = {
    race: typeof allRaces[number];
    summary: ReturnType<typeof getBookSummary>;
    alertCount: number;
    maxExposureDriver: string | null;
  };

  const buildRisk = (races: typeof allRaces): RaceRisk[] =>
    races.map((race: typeof allRaces[number]) => {
      const summary = plain(getBookSummary(race.id));
      const liabilities = plain(getDriverLiabilities(race.id));
      const limits = plain(getRiskLimits(race.id));
      const alertCount = liabilities.filter(
        (l: { handle_pct: number }) => l.handle_pct > limits.alert_handle_pct
      ).length;
      const maxExposure = liabilities[0] as { driver_name: string } | undefined;
      return { race, summary, alertCount, maxExposureDriver: maxExposure?.driver_name ?? null };
    });

  const upcomingRisks = buildRisk(upcoming);
  const completeRisks = buildRisk(complete);

  const totalHandle = upcomingRisks.reduce((s, r) => s + r.summary.total_handle, 0);
  const totalWorstCase = upcomingRisks.reduce((s, r) => s + r.summary.worst_case_pl, 0);
  const totalAlerts = upcomingRisks.reduce((s, r) => s + r.alertCount, 0);
  const openBets = upcomingRisks.reduce((s, r) => s + r.summary.num_bets, 0);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-10">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-white">Risk Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Exposure across all open books</p>
        </div>

        {/* Portfolio summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Handle", value: usd(totalHandle), sub: `${openBets} open bets` },
            { label: "Worst Case P&L", value: usd(totalWorstCase), sub: "portfolio max loss", negative: totalWorstCase < 0 },
            { label: "Open Books", value: `${upcomingRisks.length}`, sub: "upcoming races" },
            { label: "Active Alerts", value: `${totalAlerts}`, sub: "concentration flags", negative: totalAlerts > 0 },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
              <div className="text-xs text-[var(--muted)] mb-1">{c.label}</div>
              <div className={`text-2xl font-bold tabular-nums ${"negative" in c && c.negative ? "text-red-400" : "text-white"}`}>
                {c.value}
              </div>
              <div className="text-[10px] text-[var(--muted)] mt-0.5">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Open books table */}
        <section>
          <h2 className="text-base font-semibold text-white mb-3">
            Open Books
            {upcomingRisks.length === 0 && <span className="ml-2 text-xs font-normal text-[var(--muted)]">No upcoming races</span>}
          </h2>

          {upcomingRisks.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Race", "Date", "Handle", "Bets", "Worst Case", "Best Case", "Alerts", ""].map((h) => (
                      <th key={h} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${["Race"].includes(h) ? "text-left" : "text-right"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upcomingRisks.map(({ race, summary, alertCount, maxExposureDriver }) => (
                    <tr key={race.id} className={`border-b border-[var(--border)] last:border-0 ${alertCount > 0 ? "bg-amber-500/5" : "hover:bg-[var(--surface-raised)]"} transition-colors`}>
                      <td className="px-4 py-3">
                        <div>
                          <span className="font-semibold text-white">{race.name}</span>
                          <span className="ml-2 text-[10px] text-[var(--muted)]">{race.track_name}</span>
                        </div>
                        {maxExposureDriver && summary.total_handle > 0 && (
                          <div className="text-[10px] text-[var(--muted)] mt-0.5">Max exposure: {maxExposureDriver}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-[var(--muted)] whitespace-nowrap">
                        {fmt.format(new Date(race.race_date + "T12:00:00"))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs text-white">
                        {summary.total_handle > 0 ? usd(summary.total_handle) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs text-[var(--muted)]">
                        {summary.num_bets > 0 ? summary.num_bets : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {summary.total_handle > 0 ? <PLCell value={summary.worst_case_pl} /> : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {summary.total_handle > 0 ? <PLCell value={summary.best_case_pl} /> : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {alertCount > 0
                          ? <span className="text-xs font-semibold text-amber-400">{alertCount}</span>
                          : <span className="text-xs text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/races/${race.id}/book`} className="text-xs text-[var(--accent)] hover:opacity-80 transition-opacity">
                          Book →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {upcomingRisks.length > 1 && totalHandle > 0 && (
                  <tfoot>
                    <tr className="border-t border-[var(--border)] bg-[var(--surface-raised)]">
                      <td colSpan={2} className="px-4 py-2.5 text-xs text-[var(--muted)] font-medium">Portfolio total</td>
                      <td className="px-4 py-2.5 text-right text-xs font-semibold text-white tabular-nums">{usd(totalHandle)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-[var(--muted)]">{openBets}</td>
                      <td className="px-4 py-2.5 text-right"><PLCell value={totalWorstCase} /></td>
                      <td className="px-4 py-2.5 text-right"><PLCell value={upcomingRisks.reduce((s, r) => s + r.summary.best_case_pl, 0)} /></td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>

        {/* Settled races */}
        {completeRisks.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-white mb-3">
              Recent Results
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">last {completeRisks.length} races</span>
            </h2>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Race", "Date", "Handle", "Bets", "Actual P&L", ""].map((h) => (
                      <th key={h} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${h === "Race" ? "text-left" : "text-right"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {completeRisks.map(({ race, summary }) => (
                    <tr key={race.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-semibold text-white">{race.name}</span>
                        <span className="ml-2 text-[10px] text-[var(--muted)]">{race.track_name}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-[var(--muted)] whitespace-nowrap">
                        {fmt.format(new Date(race.race_date + "T12:00:00"))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs text-white">
                        {summary.total_handle > 0 ? usd(summary.total_handle) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs text-[var(--muted)]">
                        {summary.num_bets > 0 ? summary.num_bets : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {summary.total_handle > 0 ? <PLCell value={summary.worst_case_pl} /> : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/races/${race.id}/book`} className="text-xs text-[var(--muted)] hover:text-white transition-colors">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </main>
    </div>
  );
}
