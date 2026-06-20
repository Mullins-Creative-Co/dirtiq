import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { fetchWooRecaps } from "@/lib/woo-import";
import { ImportEventForm } from "@/components/import-event-form";
import { ImportStandingsForm } from "@/components/import-standings-form";
import { getDb } from "@/lib/db";

export default async function ImportPage() {
  await connection();

  const db = getDb();
  const existingRaceRows = db
    .prepare(
      `SELECT r.id, r.name, r.race_date, t.name AS track_name
       FROM races r JOIN tracks t ON t.id = r.track_id
       ORDER BY r.race_date DESC LIMIT 50`
    )
    .all() as Array<{ id: number; name: string; race_date: string; track_name: string }>;
  const existingRaces = existingRaceRows.map((race) => ({
    id: race.id,
    name: race.name,
    race_date: race.race_date,
    track_name: race.track_name,
  }));

  let events: Awaited<ReturnType<typeof fetchWooRecaps>> = [];
  let recapsError: string | null = null;
  try {
    events = await fetchWooRecaps("latemodels");
  } catch (e) {
    recapsError = e instanceof Error ? e.message : "Failed to load recaps";
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-10 space-y-10">

        <div>
          <h1 className="text-2xl font-black text-white mb-1">Data Imports</h1>
          <p className="text-sm text-[var(--muted)]">
            Refresh race results, standings, and model inputs for the 2026 WoO Late Models and Lucas Oil LMDS boards.
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            After importing, use <Link href="/admin/maintenance" className="text-[var(--accent)] hover:underline">Maintenance</Link>{" "}
            to audit model routing, retrain separated models, and refresh prediction caches.
          </p>
        </div>

        {/* ── WoO Section ────────────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-xs font-black uppercase tracking-[0.2em] text-[var(--muted)]">World of Outlaws Late Models</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>

          {/* WoO Season Points Standings */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)] mb-1">
              Season Points Standings
            </h2>
            <p className="text-xs text-[var(--muted)] mb-4">
              Bulk-import WoO driver stats from{" "}
              <a
                href="https://worldofoutlaws.com/series-points/?series=latemodels"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                worldofoutlaws.com/series-points
              </a>
              . Seeds <strong className="text-white">driver_season_stats</strong> for all drivers.
            </p>
            <ImportStandingsForm />
          </div>

          {/* WoO Event URL import */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)] mb-4">
              Import by Event URL
            </h2>
            <ImportEventForm existingRaces={existingRaces} />
          </div>

          {/* WoO Recaps list */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)] mb-4">
              Recent WoO Recaps
              {events.length > 0 && (
                <span className="ml-2 font-normal normal-case text-xs">({events.length} events)</span>
              )}
            </h2>

            {recapsError ? (
              <div className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
                {recapsError} — WoO may require browser rendering. Use the URL input above instead.
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--muted)]">
                No events found. Try pasting a URL above.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                {events.map((ev) => {
                  const alreadyImported = existingRaces.some((r) =>
                    r.name.toLowerCase().includes(ev.track.toLowerCase().split(" ")[0]?.toLowerCase() ?? "xxx")
                  );
                  return (
                    <div key={ev.event_id} className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <div className="font-semibold text-white text-sm truncate">{ev.name}</div>
                        <div className="text-xs text-[var(--muted)] mt-0.5">
                          {ev.track && <span>{ev.track}</span>}
                          {ev.date && <span className="ml-2">{ev.date}</span>}
                          <span className="ml-2 font-mono">#{ev.event_id}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {alreadyImported && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] bg-[var(--surface-raised)] px-2 py-0.5 rounded">
                            imported
                          </span>
                        )}
                        <ImportEventForm eventId={ev.event_id} existingRaces={existingRaces} compact />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 text-center">
              <a
                href="https://worldofoutlaws.com/recaps/"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-[var(--muted)] hover:text-white transition-colors"
              >
                Browse all WoO recaps →
              </a>
            </div>
          </div>
        </section>

        {/* ── Lucas Oil Section ───────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-xs font-black uppercase tracking-[0.2em] text-[var(--muted)]">Lucas Oil Late Model Dirt Series</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)] mb-1">
                CSV Import (Historical Results)
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Lucas Oil results are imported via a local Python script from a CSV export. Run this
                from the project root after placing your CSV file at{" "}
                <code className="text-amber-400">LOLMDS_Results_2020-2026_v2.csv</code>.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 font-mono text-xs text-slate-300">
              python3 scripts/import-lucas-csv.py
            </div>

            <p className="text-xs text-[var(--muted)]">
              To import a different file:{" "}
              <code className="text-amber-400">python3 scripts/import-lucas-csv.py /path/to/file.csv</code>
              <br />
              The script seeds <strong className="text-white">drivers</strong>,{" "}
              <strong className="text-white">races</strong>,{" "}
              <strong className="text-white">race_entries</strong>, and{" "}
              <strong className="text-white">driver_season_stats</strong> for the Lucas Oil LMDS series.
            </p>

            <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-400">
              After import, refresh the separated model artifacts and upcoming prediction caches:
              <span className="block mt-1 font-mono text-amber-300">npm run models:refresh</span>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
