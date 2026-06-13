"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Nav } from "@/components/nav";
import { createTrackAction } from "@/app/actions";

export default function NewTrackPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      const result = await createTrackAction(new FormData(e.currentTarget));
      if (result.error) setError(result.error); else router.push("/tracks");
    } finally { setPending(false); }
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-xl px-6 py-10">
        <h1 className="text-2xl font-bold text-white mb-6">Add Track</h1>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5">
          {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Track Name *</label>
            <input name="name" required className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. Eldora Speedway" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Location</label>
            <input name="location" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. New Weston, OH" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Surface</label>
              <select name="surface_type" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
                <option value="Clay">Clay</option><option value="Red Clay">Red Clay</option>
                <option value="Loamy">Loamy</option><option value="Sandy">Sandy</option><option value="Slick Clay">Slick Clay</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Length (miles)</label>
              <input name="track_length" type="number" step="0.001" min="0" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. 0.5" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Notes</label>
            <textarea name="notes" rows={3} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none resize-none" placeholder="Track characteristics..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={pending} className="flex-1 rounded-lg bg-[var(--accent)] py-2.5 text-sm font-semibold text-black disabled:opacity-50 hover:opacity-90">{pending ? "Saving…" : "Add Track"}</button>
            <button type="button" onClick={() => router.back()} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--muted)] hover:text-white">Cancel</button>
          </div>
        </form>
      </main>
    </div>
  );
}
