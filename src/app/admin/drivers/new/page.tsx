"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Nav } from "@/components/nav";
import { createDriverAction } from "@/app/actions";

export default function NewDriverPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      const result = await createDriverAction(new FormData(e.currentTarget));
      if (result.error) setError(result.error); else router.push("/admin/drivers");
    } finally { setPending(false); }
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-xl px-4 sm:px-6 py-10">
        <h1 className="text-2xl font-bold text-white mb-6">Add Driver</h1>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5">
          {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Name *</label>
            <input name="name" required className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. Bobby Pierce" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Car Number</label>
              <input name="car_number" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. 32" />
            </div>
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
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">Hometown</label>
            <input name="hometown" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" placeholder="e.g. Oakwood, IL" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={pending} className="flex-1 rounded-lg bg-[var(--accent)] py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90">{pending ? "Saving…" : "Add Driver"}</button>
            <button type="button" onClick={() => router.back()} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--muted)] hover:text-white">Cancel</button>
          </div>
        </form>
      </main>
    </div>
  );
}
