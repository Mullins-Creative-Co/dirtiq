"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type RefreshReport = {
  raceId: number;
  raceName: string;
  mode: "settled" | "live-lineup" | "waiting" | "error";
  entries?: number | null;
  added?: number | null;
  updated?: number | null;
  synced?: number | null;
  total?: number | null;
  sessions?: Array<{ name: string; type: string; count: number }> | null;
  model?: {
    scored?: number;
    modelSeries?: string | null;
    modelSlug?: string | null;
    error?: string;
  } | null;
  topLines?: Array<{
    driverName: string;
    odds: string;
    probability: number;
    reasons?: string[];
    warnings?: string[];
  }> | null;
  warnings?: string[];
  error?: string;
};

type RefreshResponse = {
  ok?: boolean;
  checked?: number;
  generatedAt?: string;
  report?: RefreshReport[];
  error?: string;
};

function modeLabel(mode: RefreshReport["mode"]) {
  if (mode === "settled") return "Settled";
  if (mode === "live-lineup") return "Live data";
  if (mode === "waiting") return "Waiting";
  return "Needs check";
}

export function LiveSyncControl() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [autoSync, setAutoSync] = useState(true);
  const [result, setResult] = useState<RefreshResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const reports = result?.report ?? [];
    const live = reports.filter((row) => row.mode === "live-lineup").length;
    const settled = reports.filter((row) => row.mode === "settled").length;
    const waiting = reports.filter((row) => row.mode === "waiting").length;
    if (!reports.length) return "Ready to sync";
    return `${live} live / ${settled} settled / ${waiting} waiting`;
  }, [result]);

  const runSync = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/nightly-refresh", { cache: "no-store" });
      const json = (await response.json()) as RefreshResponse;
      if (!response.ok || json.error) throw new Error(json.error ?? "Sync failed");
      setResult(json);
      startTransition(() => router.refresh());
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Sync failed");
    }
  }, [router]);

  useEffect(() => {
    if (!autoSync) return;
    const id = window.setInterval(() => {
      void runSync();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [autoSync, runSync]);

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent)]">Race-night sync</p>
        <h1 className="mt-1 text-2xl font-black uppercase leading-tight text-white">Live Control</h1>
      </div>

      <div className="space-y-4 p-4">
        <button
          type="button"
          onClick={() => void runSync()}
          disabled={pending}
          className="w-full bg-[var(--accent)] px-4 py-4 text-sm font-black uppercase tracking-[0.12em] text-black disabled:opacity-50"
        >
          {pending ? "Syncing..." : "Sync MRP Now"}
        </button>

        <label className="flex items-center justify-between gap-3 border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
          <span>
            <span className="block text-sm font-bold text-white">Auto-sync while open</span>
            <span className="block text-xs text-[var(--muted)]">Runs every 60 seconds on this phone page.</span>
          </span>
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(event) => setAutoSync(event.target.checked)}
            className="h-5 w-5 accent-[var(--accent)]"
          />
        </label>

        <div className="grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)]">
          <div className="bg-[var(--surface-raised)] px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Status</p>
            <p className="mt-1 text-sm font-black text-white">{summary}</p>
          </div>
          <div className="bg-[var(--surface-raised)] px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Last check</p>
            <p className="mt-1 text-sm font-black text-white">
              {result?.generatedAt ? new Date(result.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Not yet"}
            </p>
          </div>
        </div>

        {error && (
          <div className="border border-[var(--racing-red)]/30 bg-[var(--racing-red)]/10 px-3 py-3 text-sm text-[var(--racing-red)]">
            {error}
          </div>
        )}

        {result?.report && result.report.length > 0 && (
          <div className="space-y-2">
            {result.report.map((row) => (
              <div key={row.raceId} className="border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-bold leading-5 text-white">{row.raceName}</p>
                  <span className="shrink-0 border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[var(--accent)]">
                    {modeLabel(row.mode)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {row.mode === "settled"
                    ? `${row.synced ?? 0}/${row.total ?? 0} result rows matched`
                    : row.mode === "live-lineup"
                      ? `${row.entries ?? 0} late-model entries, ${row.updated ?? 0} updated`
                      : row.error ?? row.warnings?.[0] ?? "No MRP sessions yet"}
                </p>
                {row.sessions && row.sessions.length > 0 && (
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--muted)]">
                    {row.sessions.map((session) => `${session.type} ${session.count}`).join(" / ")}
                  </p>
                )}
                {row.model && (
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                    {row.model.error
                      ? `XGB needs check: ${row.model.error}`
                      : `XGB refreshed · ${row.model.scored ?? 0} scored${row.model.modelSeries ? ` · ${row.model.modelSeries}` : ""}`}
                  </p>
                )}
                {row.topLines && row.topLines.length > 0 && (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Repriced favorite</p>
                    <p className="mt-1 text-sm font-black text-white">
                      {row.topLines[0].driverName} · {row.topLines[0].odds} · {Math.round(row.topLines[0].probability * 1000) / 10}%
                    </p>
                    {(row.topLines[0].reasons?.[0] || row.topLines[0].warnings?.[0]) && (
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        {row.topLines[0].reasons?.[0] ?? row.topLines[0].warnings?.[0]}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
