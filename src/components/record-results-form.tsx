"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordResultsAction } from "@/app/actions";

type Entry = { race_id: number; driver_id: number; driver_name: string; finishing_position: number | null; dnf: number };

export function RecordResultsForm({ raceId, entries }: { raceId: number; entries: Entry[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<number, { pos: string; dnf: boolean }>>(
    Object.fromEntries(entries.map((e) => [e.driver_id, { pos: e.finishing_position?.toString() ?? "", dnf: e.dnf === 1 }]))
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      const payload = entries.map((entry) => ({
        driver_id: entry.driver_id,
        finishing_position: results[entry.driver_id]?.dnf ? undefined : parseInt(results[entry.driver_id]?.pos ?? "", 10) || undefined,
        dnf: results[entry.driver_id]?.dnf ?? false,
      }));
      const result = await recordResultsAction({ race_id: raceId, results: payload });
      if (result.error) setError(result.error); else router.refresh();
    } finally { setPending(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <div key={entry.driver_id} className="flex items-center gap-2">
            <span className="flex-1 text-xs text-white truncate">{entry.driver_name}</span>
            <input type="number" min="1" placeholder="Pos" disabled={results[entry.driver_id]?.dnf}
              value={results[entry.driver_id]?.pos ?? ""}
              onChange={(ev) => setResults((p) => ({ ...p, [entry.driver_id]: { ...p[entry.driver_id], pos: ev.target.value } }))}
              className="w-14 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white disabled:opacity-40 focus:border-[var(--accent)] focus:outline-none" />
            <label className="flex items-center gap-1 text-xs text-[var(--muted)] cursor-pointer">
              <input type="checkbox" checked={results[entry.driver_id]?.dnf ?? false}
                onChange={(ev) => setResults((p) => ({ ...p, [entry.driver_id]: { ...p[entry.driver_id], dnf: ev.target.checked, pos: "" } }))}
                className="accent-[var(--accent)]" />
              DNF
            </label>
          </div>
        ))}
      </div>
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-green-600 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-green-500">
        {pending ? "Saving…" : "Save Results & Complete Race"}
      </button>
    </form>
  );
}
