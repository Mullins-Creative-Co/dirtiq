import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { listTracks } from "@/lib/tracks";
import { getDb } from "@/lib/db";

export default async function TracksPage() {
  await connection();
  const tracks = listTracks().map((t) => ({
    ...t,
    race_count: (getDb().prepare("SELECT COUNT(*) AS cnt FROM races WHERE track_id = ?").get(t.id) as { cnt: number }).cnt,
  }));
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Tracks <span className="text-sm font-normal text-[var(--muted)]">({tracks.length})</span></h1>
          <Link href="/tracks/new" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90">+ Add Track</Link>
        </div>
        {tracks.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
            <p className="text-[var(--muted)]">No tracks yet.</p>
            <Link href="/tracks/new" className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline">Add your first track</Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tracks.map((t) => (
              <div key={t.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3">
                <div>
                  <p className="font-semibold text-white">{t.name}</p>
                  {t.location && <p className="text-xs text-[var(--muted)] mt-0.5">{t.location}</p>}
                </div>
                <div className="flex gap-4 text-xs">
                  <div><p className="text-[var(--muted)] uppercase tracking-widest">Surface</p><p className="mt-0.5 font-medium text-amber-400">{t.surface_type}</p></div>
                  {t.track_length && <div><p className="text-[var(--muted)] uppercase tracking-widest">Length</p><p className="mt-0.5 font-medium text-white">{t.track_length} mi</p></div>}
                  <div><p className="text-[var(--muted)] uppercase tracking-widest">Races</p><p className="mt-0.5 font-medium text-white">{t.race_count}</p></div>
                </div>
                {t.notes && <p className="text-xs text-[var(--muted)]">{t.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
