import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { fetchWooRecaps } from "@/lib/woo-import";
import { ImportEventForm } from "@/components/import-event-form";
import { getDb } from "@/lib/db";

export default async function ImportPage() {
  await connection();

  // Load existing races for mapping dropdown
  const db = getDb();
  const existingRaces = db
    .prepare(
      `SELECT r.id, r.name, r.race_date, t.name AS track_name
       FROM races r JOIN tracks t ON t.id = r.track_id
       ORDER BY r.race_date DESC LIMIT 50`
    )
    .all() as Array<{ id: number; name: string; race_date: string; track_name: string }>;

  // Try to fetch recaps list
  let events: Awaited<ReturnType<typeof fetchWooRecaps>> = [];
  let recapsError: string | null = null;
  try {
    events = await fetchWooRecaps("latemodels");
  } catch (e) {
    recapsError = e instanceof Error ? e.message : "Failed to load recaps";
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Nav />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-white mb-1">WoO Import</h1>
          <p className="text-sm text-[var(--muted)]">
            Import race results from{" "}
            <a href="https://worldofoutlaws.com/recaps/" target="_blank" rel="noreferrer"
              className="text-[var(--accent)] hover:underline">
              worldofoutlaws.com/recaps/
            </a>
          </p>
        </div>

        {/* Manual event URL import */}
        <section className="mb-10 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)] mb-4">Import by Event URL</h2>
          <ImportEventForm existingRaces={existingRaces} />
        </section>

        {/* Recaps list */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)] mb-4">
            Recent Recaps
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
                // Check if already imported (rough match by name similarity)
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
                      <ImportEventForm
                        eventId={ev.event_id}
                        existingRaces={existingRaces}
                        compact
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Link to WoO recaps in new tab */}
        <div className="mt-8 text-center">
          <a
            href="https://worldofoutlaws.com/recaps/"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--muted)] hover:text-white transition-colors"
          >
            Browse all WoO recaps →
          </a>
        </div>
      </main>
    </div>
  );
}
