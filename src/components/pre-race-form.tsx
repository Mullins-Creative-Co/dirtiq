"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePreRaceDataAction } from "@/app/actions";

type Entry = {
  race_id: number;
  driver_id: number;
  driver_name: string;
  qualifying_time: number | null;
  heat_position: number | null;
  starting_position: number | null;
};

type RowState = {
  qt: string;
  heat: string;
  start: string;
};

export function PreRaceDataForm({ raceId, entries }: { raceId: number; entries: Entry[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Record<number, RowState>>(
    Object.fromEntries(
      entries.map((e) => [
        e.driver_id,
        {
          qt: e.qualifying_time?.toString() ?? "",
          heat: e.heat_position?.toString() ?? "",
          start: e.starting_position?.toString() ?? "",
        },
      ])
    )
  );

  function set(driverId: number, field: keyof RowState, value: string) {
    setRows((prev) => ({ ...prev, [driverId]: { ...prev[driverId], [field]: value } }));
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const payload = entries.map((entry) => {
        const r = rows[entry.driver_id];
        const qt = parseFloat(r.qt);
        const heat = parseInt(r.heat, 10);
        const start = parseInt(r.start, 10);
        return {
          driver_id: entry.driver_id,
          qualifying_time: !isNaN(qt) ? qt : undefined,
          heat_position: !isNaN(heat) ? heat : undefined,
          starting_position: !isNaN(start) ? start : undefined,
        };
      });
      const result = await updatePreRaceDataAction({ race_id: raceId, entries: payload });
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  const filledCount = entries.filter((e) => {
    const r = rows[e.driver_id];
    return r.qt || r.heat || r.start;
  }).length;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_60px_52px_52px] gap-1.5 px-1">
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Driver</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">QT</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">Heat</span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-right">Start</span>
      </div>

      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {entries.map((entry) => {
          const r = rows[entry.driver_id];
          return (
            <div key={entry.driver_id} className="grid grid-cols-[1fr_60px_52px_52px] gap-1.5 items-center">
              <span className="text-xs text-white truncate">{entry.driver_name}</span>

              {/* Qualifying time — e.g. 14.872 */}
              <input
                type="number"
                step="0.001"
                min="0"
                placeholder="14.872"
                value={r.qt}
                onChange={(ev) => set(entry.driver_id, "qt", ev.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white text-right tabular-nums placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
              />

              {/* Heat finish position */}
              <input
                type="number"
                min="1"
                max="12"
                placeholder="3"
                value={r.heat}
                onChange={(ev) => set(entry.driver_id, "heat", ev.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white text-right tabular-nums placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
              />

              {/* Feature starting position */}
              <input
                type="number"
                min="1"
                placeholder="5"
                value={r.start}
                onChange={(ev) => set(entry.driver_id, "start", ev.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white text-right tabular-nums placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {filledCount > 0 && (
          <span className="text-[10px] text-[var(--muted)]">{filledCount}/{entries.length} filled</span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 hover:opacity-90"
        >
          {pending ? "Saving…" : saved ? "Saved ✓" : "Save Pre-Race Data"}
        </button>
      </div>
    </form>
  );
}
