"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setMrpEventIdAction, syncMrpLineupAction, resetPrelimDataAction, type MrpSyncResult } from "@/app/actions";

const SESSION_TYPE_LABEL: Record<string, string> = {
  qualifying: "QT",
  heat: "Heat",
  bmain: "B-Main",
  feature: "Feature",
  unknown: "Session",
};

export function MrpSyncPanel({
  raceId,
  mrpEventId: initialEventId,
}: {
  raceId: number;
  mrpEventId: number | null;
}) {
  const router = useRouter();
  const [eventIdInput, setEventIdInput] = useState(initialEventId?.toString() ?? "");
  const [savingId, setSavingId] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<MrpSyncResult | null>(null);
  const [idSaved, setIdSaved] = useState(!!initialEventId);

  const currentEventId = initialEventId;

  async function saveEventId() {
    const id = parseInt(eventIdInput, 10);
    if (isNaN(id) || id <= 0) return;
    setSavingId(true);
    await setMrpEventIdAction(raceId, id);
    setSavingId(false);
    setIdSaved(true);
    router.refresh();
  }

  async function syncLineup() {
    setSyncing(true);
    setResult(null);
    const r = await syncMrpLineupAction(raceId);
    setSyncing(false);
    setResult(r);
    if (!r.error) router.refresh();
  }

  async function resetPrelim() {
    setResetting(true);
    setResult(null);
    await resetPrelimDataAction(raceId);
    setResetting(false);
    setResult({ updated: 0, added: 0, warnings: ["Prelim data (QT + heat positions) cleared. Lines reset to historical baseline."] });
    router.refresh();
  }

  return (
    <div className="space-y-4">

      {/* Event ID row */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-[var(--muted)]">MRP Event ID</label>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="e.g. 597630"
            value={eventIdInput}
            onChange={(e) => { setEventIdInput(e.target.value); setIdSaved(false); }}
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white tabular-nums placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={saveEventId}
            disabled={savingId || !eventIdInput || idSaved}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-white hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
          >
            {savingId ? "Saving…" : idSaved ? "Linked ✓" : "Link"}
          </button>
        </div>
        <p className="text-[10px] text-[var(--muted)]">
          Find this in the MyRacePass URL:{" "}
          <span className="font-mono text-slate-400">myracepass.com/events/<span className="text-[var(--accent)]">597630</span>/races</span>
        </p>
      </div>

      {/* Sync buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={syncLineup}
          disabled={syncing || !currentEventId}
          className="flex-1 rounded-lg bg-[var(--accent)] py-2.5 text-xs font-bold text-black disabled:opacity-40 hover:opacity-90 active:scale-[.98] transition-all"
        >
          {syncing ? "Syncing from MRP…" : "↓ Sync Lineup from MRP"}
        </button>
        <button
          onClick={resetPrelim}
          disabled={resetting}
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-xs font-semibold text-[var(--muted)] hover:text-red-400 hover:border-red-900/50 transition-colors disabled:opacity-40"
        >
          {resetting ? "Resetting…" : "Reset to Historical"}
        </button>
      </div>

      {!currentEventId && (
        <p className="text-[10px] text-amber-400">Enter and link an MRP Event ID above to enable sync.</p>
      )}

      {/* Result display */}
      {result && (
        <div className={`rounded-xl px-4 py-3.5 space-y-2 text-xs ${result.error ? "bg-red-500/10 border border-red-500/20" : "bg-[var(--surface-raised)] border border-[var(--border)]"}`}>
          {result.error ? (
            <p className="text-red-400">{result.error}</p>
          ) : (
            <>
              {result.event_name && (
                <p className="font-semibold text-white">{result.event_name}</p>
              )}

              {/* Session breakdown */}
              {result.sessions && result.sessions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {result.sessions.map((s, i) => (
                    <span key={i} className="rounded-md bg-[var(--surface)] border border-[var(--border)] px-2 py-1">
                      <span className="text-[var(--accent)] font-semibold">{SESSION_TYPE_LABEL[s.type] ?? s.type}</span>
                      {" "}<span className="text-[var(--muted)]">{s.name}</span>
                      {" "}<span className="text-white">{s.count}d</span>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-4 text-[var(--muted)]">
                {result.added !== undefined && result.added > 0 && (
                  <span className="text-green-400">+{result.added} drivers added</span>
                )}
                {result.updated !== undefined && (
                  <span>{result.updated} entries updated</span>
                )}
              </div>

              {result.warnings?.map((w, i) => (
                <p key={i} className="text-amber-400">{w}</p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
