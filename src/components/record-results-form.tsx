"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordResultsAction } from "@/app/actions";

type Entry = { race_id: number; driver_id: number; driver_name: string; finishing_position: number | null; laps_led: number; dnf: number };
type RowState = { pos: string; laps: string; dnf: boolean };

export function RecordResultsForm({ raceId, entries }: { raceId: number; entries: Entry[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<number, RowState>>(
    Object.fromEntries(entries.map((e) => [e.driver_id, {
      pos: e.finishing_position?.toString() ?? "",
      laps: e.laps_led > 0 ? e.laps_led.toString() : "",
      dnf: e.dnf === 1,
    }]))
  );

  function set(id: number, field: keyof RowState, value: string | boolean) {
    setResults((p) => ({ ...p, [id]: { ...p[id], [field]: value } }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      const payload = entries.map((entry) => {
        const r = results[entry.driver_id];
        return {
          driver_id: entry.driver_id,
          finishing_position: r.dnf ? undefined : parseInt(r.pos, 10) || undefined,
          laps_led: parseInt(r.laps, 10) || undefined,
          dnf: r.dnf,
        };
      });
      const result = await recordResultsAction({ race_id: raceId, results: payload });
      if (result.error) setError(result.error); else router.refresh();
    } finally { setPending(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_44px_52px_42px] gap-1.5 px-1">
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Driver</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">Pos</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">Laps Led</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">DNF</span>
      </div>

      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {entries.map((entry) => {
          const r = results[entry.driver_id];
          return (
            <div key={entry.driver_id} className="grid grid-cols-[1fr_44px_52px_42px] gap-1.5 items-center">
              <span className="text-xs text-white truncate">{entry.driver_name}</span>
              <input type="number" min="1" placeholder="1" disabled={r.dnf}
                value={r.pos}
                onChange={(ev) => set(entry.driver_id, "pos", ev.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white text-right tabular-nums disabled:opacity-40 placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none" />
              <input type="number" min="0" placeholder="0" disabled={r.dnf}
                value={r.laps}
                onChange={(ev) => set(entry.driver_id, "laps", ev.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white text-right tabular-nums disabled:opacity-40 placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none" />
              <div className="flex justify-center">
                <input type="checkbox" checked={r.dnf}
                  onChange={(ev) => set(entry.driver_id, "dnf", ev.target.checked)}
                  className="accent-red-500 w-4 h-4 cursor-pointer" />
              </div>
            </div>
          );
        })}
      </div>

      <button type="submit" disabled={pending} className="w-full rounded-lg bg-green-600 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-green-500">
        {pending ? "Saving…" : "Save Results & Complete Race"}
      </button>
    </form>
  );
}
