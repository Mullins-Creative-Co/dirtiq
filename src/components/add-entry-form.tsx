"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addEntryAction } from "@/app/actions";

type Driver = { id: number; name: string; car_number: string | null };

export function AddEntryForm({ raceId, drivers }: { raceId: number; drivers: Driver[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      const fd = new FormData(e.currentTarget);
      fd.append("race_id", String(raceId));
      const result = await addEntryAction(fd);
      if (result.error) setError(result.error);
      else { (e.target as HTMLFormElement).reset(); router.refresh(); }
    } finally { setPending(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <select name="driver_id" required className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none">
        <option value="">Select driver…</option>
        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.car_number ? ` (#${d.car_number})` : ""}</option>)}
      </select>
      <div className="flex gap-2">
        <input name="starting_position" type="number" min="1" placeholder="Start pos." className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" />
        <button type="submit" disabled={pending} className="flex-1 rounded-lg bg-[var(--accent)] py-2 text-sm font-semibold text-black disabled:opacity-50 hover:opacity-90">{pending ? "Adding…" : "Add to Field"}</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input name="engine_builder" placeholder="Engine builder" className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" />
        <input name="tire_compound" placeholder="Tire compound" className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" />
        <input name="crew_chief" placeholder="Crew chief" className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" />
      </div>
    </form>
  );
}
