"use client";
import Link from "next/link";
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
      if (result.error) setError(result.error); else router.push(`/admin/races/${result.id}`);
    } finally { setPending(false); }
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-xl px-4 sm:px-6 py-10">
        <h1 className="text-2xl font-bold text-white mb-6">New Race</h1>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5">
          {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          {tracks.length === 0 && <p className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-400">No tracks yet. <Link href="/admin/tracks/new" className="underline">Add a track first</Link>.</p>}
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
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Series / Division</label>
              <select name="division" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
                <option value="WoO Late Models">WoO Late Models</option>
                <option value="Lucas Oil LMDS">Lucas Oil LMDS</option>
                <option value="Crown Jewel / Combined">Crown Jewel / Combined</option>
                <option value="DIRTcar Summer Nationals">DIRTcar Summer Nationals</option>
                <option value="Independent">Independent / Open Late Model</option>
              </select>
              <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                Sprint cars and modifieds are hidden from active model targets until their own data and model features exist.
              </p>
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Time of Day</label>
              <select name="time_of_day" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
                <option value="night">Night</option>
                <option value="afternoon">Afternoon</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Distance (laps)</label>
              <input name="distance" type="number" min="1" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. 50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Temp (°F)</label>
              <input name="temperature_f" type="number" step="1" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. 78" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Humidity (%)</label>
              <input name="humidity_pct" type="number" step="1" min="0" max="100" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. 55" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Precip last 48h (in)</label>
              <input name="precip_48h_in" type="number" step="0.01" min="0" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. 0.25" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Water Truck Runs</label>
              <input name="water_truck_runs" type="number" step="1" min="0" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. 3" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Groove Stage</label>
            <select name="groove_stage" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
              <option value="">Unknown</option>
              <option value="fresh">Fresh prep</option>
              <option value="early">Early rubber</option>
              <option value="mid">Mid-groove development</option>
              <option value="cushion">Cushion forming</option>
              <option value="slick">Slick/locked down</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={pending || tracks.length === 0} className="flex-1 rounded-lg bg-[var(--accent)] py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90">{pending ? "Creating…" : "Create Race"}</button>
            <button type="button" onClick={() => router.back()} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--muted)] hover:text-white">Cancel</button>
          </div>
        </form>
      </main>
    </div>
  );
}
