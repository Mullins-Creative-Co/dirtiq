import { connection } from "next/server";
import Link from "next/link";

import { Nav } from "@/components/nav";
import { getMaintenanceStatus, getProductionChecklist } from "@/lib/maintenance";

const commands = [
  {
    label: "Audit routing",
    command: "npm run models:audit",
    detail: "Shows which model every upcoming race will use before you score anything.",
  },
  {
    label: "Train all models",
    command: "npm run models:train",
    detail: "Retrains Lucas, WoO, Crown Combined, and DIRTcar Summer Nationals artifacts from the current database.",
  },
  {
    label: "Score upcoming",
    command: "npm run models:score",
    detail: "Caches predictions for upcoming races that already have entries.",
  },
  {
    label: "Full refresh",
    command: "npm run models:refresh",
    detail: "Retrains all models, scores upcoming races, then prints the routing audit.",
  },
];

const lanes = [
  {
    label: "Lucas Oil results",
    destination: "races, race_entries, driver_season_stats",
    command: "python3 scripts/import-lucas-csv.py /path/to/lucas.csv",
  },
  {
    label: "WoO results",
    destination: "races, race_entries, driver_season_stats",
    command: "node scripts/import-csv.mjs",
  },
  {
    label: "Driver metrics",
    destination: "driver_model_metrics",
    command: "node scripts/import-driver-model-metrics.mjs /path/to/file.txt \"Lucas Oil LMDS\"",
  },
  {
    label: "Equipment",
    destination: "driver_equipment_profiles",
    command: "node scripts/import-driver-equipment.mjs /path/to/equipment.csv",
  },
  {
    label: "Summer Nationals results",
    destination: "races, race_entries, driver_season_stats",
    command: "npm run import:summer-nationals",
  },
];

function badgeClass(modelSeries: string) {
  if (modelSeries.includes("Crown")) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (modelSeries.includes("Lucas")) return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  if (modelSeries.includes("Summer")) return "border-orange-500/30 bg-orange-500/10 text-orange-300";
  return "border-green-500/30 bg-green-500/10 text-green-300";
}

function statusClass(status: "done" | "pending" | "blocked") {
  if (status === "done") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (status === "blocked") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

export default async function MaintenancePage() {
  await connection();
  const status = getMaintenanceStatus(30);
  const production = getProductionChecklist(874);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-10 space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-white">Maintenance</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Keep new data flowing into the right tables, retrain separated models,
              and verify each race routes to the right prediction cache before lines go live.
            </p>
          </div>
          <Link
            href="/admin/testing"
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)] hover:text-white"
          >
            Testing checklist
          </Link>
        </div>

        {production && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                    Production checklist
                  </p>
                  <h2 className="mt-1 text-xl font-black text-white">{production.raceName}</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {production.trackName} · {production.raceDate} · {production.division ?? "Late Models"}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] text-center">
                  {[
                    { label: "Active", value: production.activeEntries },
                    { label: "Scratched", value: production.scratchedEntries },
                    { label: "Lines", value: production.lineCount },
                  ].map((item) => (
                    <div key={item.label} className="bg-[var(--surface-raised)] px-4 py-2">
                      <p className="text-lg font-black text-white">{item.value}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="border-b border-[var(--border)] p-5 lg:border-b-0 lg:border-r">
                <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)]">Updated Todo</h3>
                <div className="mt-4 space-y-3">
                  {production.items.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href ?? "/admin/maintenance"}
                      className="block rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 hover:border-[var(--accent)]/50 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${statusClass(item.status)}`}>
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.detail}</p>
                    </Link>
                  ))}
                </div>

                <h3 className="mt-6 text-sm font-bold uppercase tracking-widest text-[var(--muted)]">Next Actions</h3>
                <div className="mt-4 space-y-3">
                  {production.nextActions.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href ?? "/admin/maintenance"}
                      className="block rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 hover:border-[var(--accent)]/50 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${statusClass(item.status)}`}>
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.detail}</p>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="p-5">
                <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)]">
                  Night 1 Likely Contenders
                </h3>
                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
                  {production.topLines.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No published lines yet.</p>
                  ) : (
                    production.topLines.map((line) => (
                      <div key={`${line.driverName}-${line.marketOdds}`} className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 last:border-0">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-white">{line.driverName}</p>
                            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                              {line.entryStatus}
                            </p>
                          </div>
                          <span className="font-mono text-sm font-black text-amber-300">{line.marketOdds}</span>
                        </div>
                        {line.rationale && (
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{line.rationale}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <Link href={`/admin/races/${production.raceId}/prediction`} className="rounded-lg border border-[var(--border)] px-4 py-2 text-center text-sm font-semibold text-[var(--muted)] hover:text-white">
                    Reasoning
                  </Link>
                  <Link href={`/admin/races/${production.raceId}/book`} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-center text-sm font-bold text-black hover:opacity-90">
                    Odds / Lines
                  </Link>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: "Upcoming", value: status.counts.upcoming, detail: "shown below" },
            { label: "With Entries", value: status.counts.upcomingWithEntries, detail: "ready to score" },
            { label: "Cached", value: status.counts.cached, detail: "model predictions exist" },
            { label: "Lucas / WoO", value: `${status.counts.lucas}/${status.counts.woo}`, detail: "series routes" },
            { label: "Crown / Summer", value: `${status.counts.crown}/${status.counts.summer}`, detail: "separate routes" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                {stat.label}
              </p>
              <p className="mt-2 text-2xl font-black text-white">{stat.value}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{stat.detail}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_420px]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-base font-bold text-white">Upcoming Race Routing</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Crown jewel names route to the combined model even when the sanction is Lucas or WoO.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Date", "Race", "Entries", "Model", "Reason", "Cache", ""].map((head) => (
                      <th
                        key={head}
                        className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${
                          ["Race", "Model", "Reason"].includes(head) ? "text-left" : "text-right"
                        }`}
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {status.routes.map((route) => (
                    <tr key={route.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3 text-right text-xs text-[var(--muted)]">{route.raceDate}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-white">{route.name}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">{route.division}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-mono text-white">{route.entries}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${badgeClass(route.modelSeries)}`}>
                          {route.modelSeries}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">{route.modelReason}</td>
                      <td className={`px-4 py-3 text-right text-xs font-bold ${route.cacheExists ? "text-green-300" : "text-amber-300"}`}>
                        {route.cacheExists ? "cached" : "needed"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/races/${route.id}/prediction`} className="text-xs text-[var(--accent)] hover:underline">
                          prediction
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-5">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="text-base font-bold text-white">Maintenance Commands</h2>
              <div className="mt-4 space-y-3">
                {commands.map((item) => (
                  <div key={item.command} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <p className="text-xs font-bold text-white">{item.label}</p>
                    <p className="mt-1 font-mono text-[11px] text-amber-300">{item.command}</p>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="text-base font-bold text-white">Data Lanes</h2>
              <div className="mt-4 space-y-3">
                {lanes.map((lane) => (
                  <div key={lane.label} className="border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
                    <p className="text-xs font-bold text-white">{lane.label}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{lane.destination}</p>
                    <p className="mt-2 break-all font-mono text-[11px] text-amber-300">{lane.command}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
