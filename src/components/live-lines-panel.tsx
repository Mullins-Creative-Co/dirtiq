"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePreRaceDataAction, resetPrelimDataAction } from "@/app/actions";

type Entry = {
  driver_id: number;
  driver_name: string;
  car_number: string | null;
  heat_position: number | null;
  qualifying_time: number | null;
  starting_position: number | null;
};

export function LiveLinesPanel({
  raceId,
  entries,
}: {
  raceId: number;
  entries: Entry[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);

  type RowState = { heat: string; start: string };
  const [rows, setRows] = useState<Record<number, RowState>>(
    Object.fromEntries(
      entries.map((e) => [
        e.driver_id,
        {
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

  async function handleRefresh() {
    setRefreshing(true);
    router.refresh();
    // Give the server a moment before clearing the state
    setTimeout(() => setRefreshing(false), 800);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const payload = entries.map((e) => {
      const r = rows[e.driver_id];
      const heat = parseInt(r.heat, 10);
      const start = parseInt(r.start, 10);
      return {
        driver_id: e.driver_id,
        qualifying_time: e.qualifying_time ?? undefined,
        heat_position: !isNaN(heat) ? heat : undefined,
        starting_position: !isNaN(start) ? start : undefined,
      };
    });
    await updatePreRaceDataAction({ race_id: raceId, entries: payload });
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  async function handleReset() {
    setResetting(true);
    await resetPrelimDataAction(raceId);
    setResetting(false);
    setRows(Object.fromEntries(entries.map((e) => [e.driver_id, { heat: "", start: "" }])));
    setSaved(false);
    router.refresh();
  }

  const filledCount = entries.filter((e) => rows[e.driver_id]?.heat || rows[e.driver_id]?.start).length;

  return (
    <div className="rounded-2xl border border-blue-500/25 bg-[var(--surface)] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-sm font-semibold text-white">Live Lines</span>
          </span>
          {filledCount > 0 && (
            <span className="text-[10px] text-blue-400 font-medium">
              {filledCount}/{entries.length} prelim data
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-white hover:border-white transition-colors disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "↺ Refresh Lines"}
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-white hover:border-white transition-colors"
          >
            {open ? "Hide Editor" : "Edit Positions"}
          </button>
        </div>
      </div>

      {/* Inline editor */}
      {open && (
        <div className="border-t border-[var(--border)] px-5 py-4 space-y-3">
          <div className="text-[10px] text-[var(--muted)]">
            Update heat finish and feature starting position — odds recalculate on save.{" "}
            <span className="text-blue-400">
              Heat position has the biggest impact (0.20 weight when ≥25% of field has data).
            </span>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_56px_56px] gap-1.5 px-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Driver</span>
            <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-center">Heat</span>
            <span className="text-[10px] uppercase tracking-widest text-[var(--muted)] text-center">Start</span>
          </div>

          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {entries.map((entry) => {
              const r = rows[entry.driver_id] ?? { heat: "", start: "" };
              const hasData = r.heat || r.start;
              return (
                <div
                  key={entry.driver_id}
                  className={`grid grid-cols-[1fr_56px_56px] gap-1.5 items-center rounded-lg px-2 py-1.5 transition-colors ${hasData ? "bg-blue-500/5" : ""}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {entry.car_number && (
                      <span className="text-[10px] font-mono text-amber-400 shrink-0">#{entry.car_number}</span>
                    )}
                    <span className="text-xs text-white truncate">{entry.driver_name}</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    placeholder="—"
                    value={r.heat}
                    onChange={(ev) => set(entry.driver_id, "heat", ev.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white text-center tabular-nums placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    type="number"
                    min="1"
                    max="30"
                    placeholder="—"
                    value={r.start}
                    onChange={(ev) => set(entry.driver_id, "start", ev.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-white text-center tabular-nums placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-600 py-2.5 text-xs font-bold text-white disabled:opacity-50 hover:bg-blue-500 active:scale-[.98] transition-all"
            >
              {saving ? "Saving…" : saved ? "Saved ✓ — Lines Updated" : "Save & Recalculate Lines"}
            </button>
            <button
              onClick={handleReset}
              disabled={resetting}
              title="Clear heat positions and QT times — resets to historical-only odds"
              className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-xs font-semibold text-[var(--muted)] hover:text-red-400 hover:border-red-900/50 transition-colors disabled:opacity-40"
            >
              {resetting ? "…" : "Reset"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
