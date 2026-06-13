"use client";
import { useState, useTransition } from "react";
import { importWooEventAction } from "@/app/actions";

type Race = { id: number; name: string; race_date: string; track_name: string };

type Props = {
  existingRaces: Race[];
  eventId?: string;   // pre-fill (from recaps list)
  compact?: boolean;  // inline row mode
};

export function ImportEventForm({ existingRaces, eventId: prefillId, compact }: Props) {
  const [url, setUrl] = useState(prefillId ? `https://worldofoutlaws.com/results/?event=${prefillId}&series=latemodels` : "");
  const [targetRaceId, setTargetRaceId] = useState<string>("");
  const [result, setResult] = useState<{
    error?: string;
    raceId?: number;
    matched?: number;
    created?: number;
    updated?: number;
    warnings?: string[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const eventInput = url.trim() || prefillId || "";
    if (!eventInput) return;
    setResult(null);
    startTransition(async () => {
      const res = await importWooEventAction({
        eventId: eventInput,
        targetRaceId: targetRaceId ? parseInt(targetRaceId, 10) : undefined,
      });
      setResult(res);
    });
  }

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1">
        {result?.error && (
          <div className="text-xs text-red-400 max-w-xs text-right">{result.error}</div>
        )}
        {result?.raceId && !result.error && (
          <a href={`/races/${result.raceId}`}
            className="text-xs text-green-400 hover:underline">
            {result.updated} entries imported →
          </a>
        )}
        {!result?.raceId && (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <select
              value={targetRaceId}
              onChange={(e) => setTargetRaceId(e.target.value)}
              className="text-xs bg-[var(--surface-raised)] border border-[var(--border)] rounded px-2 py-1 text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="">Auto-match race</option>
              {existingRaces.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.race_date.slice(0, 10)})
                </option>
              ))}
              <option value="-1">Create new race</option>
            </select>
            <button
              type="submit"
              disabled={pending}
              className="text-xs font-semibold bg-[var(--accent)] text-black px-3 py-1 rounded hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {pending ? "Importing…" : "Import"}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5">
          WoO Event URL or Event ID
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://worldofoutlaws.com/results/?event=597627&series=latemodels"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <p className="mt-1 text-xs text-[var(--muted)]">
          Paste the URL from the WoO results page, or just the event ID number.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5">
          Map to existing race <span className="font-normal">(optional — auto-detects by date/track)</span>
        </label>
        <select
          value={targetRaceId}
          onChange={(e) => setTargetRaceId(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
        >
          <option value="">Auto-detect / create new</option>
          {existingRaces.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} — {r.track_name} ({r.race_date.slice(0, 10)})
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || (!url.trim() && !prefillId)}
          className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {pending ? "Importing…" : "Import Results"}
        </button>

        {result?.error && (
          <span className="text-sm text-red-400">{result.error}</span>
        )}
      </div>

      {result && !result.error && result.raceId && (
        <div className="rounded-xl border border-green-900/50 bg-green-950/20 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-green-400">Import complete</span>
            <a
              href={`/races/${result.raceId}`}
              className="text-sm font-semibold text-[var(--accent)] hover:underline"
            >
              View race →
            </a>
          </div>
          <div className="text-xs text-[var(--muted)] flex gap-4">
            <span>{result.matched} drivers matched</span>
            <span>{result.created} drivers created</span>
            <span>{result.updated} entries imported</span>
          </div>
          {result.warnings && result.warnings.length > 0 && (
            <details className="text-xs text-amber-400 cursor-pointer">
              <summary>{result.warnings.length} warnings</summary>
              <ul className="mt-1 pl-4 space-y-0.5 list-disc">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </form>
  );
}
