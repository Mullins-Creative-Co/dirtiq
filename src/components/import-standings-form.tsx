"use client";
import { useState } from "react";
import { importWooStandingsAction } from "@/app/actions";

type Result = {
  total: number;
  created: number;
  matched: number;
  warnings: string[];
};

export function ImportStandingsForm() {
  const [season, setSeason] = useState(new Date().getFullYear().toString());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    const yr = parseInt(season, 10);
    if (isNaN(yr) || yr < 2018 || yr > 2030) {
      setError("Enter a valid season year (2018–2030).");
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    const res = await importWooStandingsAction(yr);
    setLoading(false);
    if (res.error) {
      setError(res.error);
    } else {
      setResult({ total: res.total, created: res.created, matched: res.matched, warnings: res.warnings });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">
        Imports the WoO Late Models series points standings for a given season. Updates driver records and upserts{" "}
        <code className="text-amber-400">driver_season_stats</code> (starts, wins, top-5s, top-10s, points position).
      </p>

      <div className="flex items-end gap-3">
        <label className="space-y-1 flex-1 max-w-xs">
          <span className="text-xs text-[var(--muted)] uppercase tracking-widest">Season</span>
          <input
            type="number"
            min={2018}
            max={2030}
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white tabular-nums focus:border-[var(--accent)] focus:outline-none"
          />
        </label>
        <button
          onClick={handleImport}
          disabled={loading}
          className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? "Importing…" : "Import Standings"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-green-900/50 bg-green-950/20 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-green-400">
            {result.total === 0
              ? "No entries found — the page may require JavaScript rendering."
              : `Imported ${result.total} drivers (${result.matched} matched, ${result.created} created)`}
          </p>
          {result.warnings.length > 0 && (
            <ul className="space-y-1">
              {result.warnings.slice(0, 10).map((w, i) => (
                <li key={i} className="text-xs text-amber-400">{w}</li>
              ))}
              {result.warnings.length > 10 && (
                <li className="text-xs text-[var(--muted)]">…and {result.warnings.length - 10} more</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
