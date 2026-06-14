"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Nav } from "@/components/nav";
import { createRaceAction, listTracksAction } from "@/app/actions";

type Track = { id: number; name: string; location: string | null };

export default function NewRacePage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => { listTracksAction().then(setTracks); }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      const result = await createRaceAction(new FormData(e.currentTarget));
      if (result.error) setError(result.error); else router.push(`/races/${result.id}`);
    } finally { setPending(false); }
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-xl px-4 sm:px-6 py-10">
        <h1 className="text-2xl font-bold text-white mb-6">New Race</h1>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5">
          {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          {tracks.length === 0 && <p className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-400">No tracks yet. <a href="/tracks/new" className="underline">Add a track first</a>.</p>}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Race Name *</label>
            <input name="name" required className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. Friday Night Feature" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Track *</label>
              <select name="track_id" required className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
                <option value="">Select track…</option>
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}{t.location ? ` – ${t.location}` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Date *</label>
              <input name="race_date" type="date" required className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Division</label>
              <select name="division" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
                <option value="Open">Open / Late Model</option><option value="Modified">Modified</option>
                <option value="Sprint">Sprint Car</option><option value="UMP">UMP Modified</option><option value="Street Stock">Street Stock</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Track Condition</label>
              <select name="track_condition" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
                <option value="Tacky">Tacky</option><option value="Dry Slick">Dry Slick</option>
                <option value="Heavy">Heavy</option><option value="Muddy">Muddy</option>
                <option value="Cushion">Cushion</option><option value="Groomed">Groomed</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={pending || tracks.length === 0} className="flex-1 rounded-lg bg-[var(--accent)] py-2.5 text-sm font-semibold text-black disabled:opacity-50 hover:opacity-90">{pending ? "Creating…" : "Create Race"}</button>
            <button type="button" onClick={() => router.back()} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--muted)] hover:text-white">Cancel</button>
          </div>
        </form>
      </main>
    </div>
  );
}
