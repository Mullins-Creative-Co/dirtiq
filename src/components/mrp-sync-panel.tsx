"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  closeBettingAction,
  findAndSetMrpEventIdAction,
  reopenBettingAction,
  setMrpEventIdAction,
  syncMrpLineupAction,
  syncMrpResultsAction,
  resetPrelimDataAction,
  type MrpEventLookupResult,
  type MrpSyncResult,
} from "@/app/actions";

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
  bettingStatus,
  raceStatus,
  isLive,
}: {
  raceId: number;
  mrpEventId: number | null;
  bettingStatus?: string | null;
  raceStatus?: string;
  isLive?: boolean;
}) {
  const router = useRouter();
  const [eventIdInput, setEventIdInput] = useState(initialEventId?.toString() ?? "");
  const [savingId, setSavingId] = useState(false);
  const [findingId, setFindingId] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [closing, setClosing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<MrpSyncResult | null>(null);
  const [lookupResult, setLookupResult] = useState<MrpEventLookupResult | null>(null);
  const [idSaved, setIdSaved] = useState(!!initialEventId);

  const currentEventId = initialEventId;
  const isSettled = raceStatus === "complete" || bettingStatus === "settled";
  const isCancelled = raceStatus === "cancelled" || bettingStatus === "void";
  const isOpen = !isSettled && !isLive && (bettingStatus ?? "open") === "open";

  function parseEventId(value: string) {
    const eventMatch = value.match(/myracepass\.com\/events\/(\d+)/i);
    if (eventMatch) return Number(eventMatch[1]);
    const numberMatch = value.match(/\d{4,}/);
    return numberMatch ? Number(numberMatch[0]) : NaN;
  }

  async function saveEventId() {
    const id = parseEventId(eventIdInput);
    if (isNaN(id) || id <= 0) return;
    setSavingId(true);
    await setMrpEventIdAction(raceId, id);
    setSavingId(false);
    setIdSaved(true);
    router.refresh();
  }

  async function findEventId() {
    setFindingId(true);
    setLookupResult(null);
    const r = await findAndSetMrpEventIdAction(raceId);
    setFindingId(false);
    setLookupResult(r);
    if (r.eventId) {
      setEventIdInput(String(r.eventId));
      setIdSaved(true);
    }
    if (r.linked) router.refresh();
  }

  async function linkCandidate(eventId: number) {
    setEventIdInput(String(eventId));
    setSavingId(true);
    const response = await setMrpEventIdAction(raceId, eventId);
    setSavingId(false);
    if (response.error) {
      setResult({ error: response.error });
      return;
    }
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

  async function syncResults() {
    setSettling(true);
    setResult(null);
    const r = await syncMrpResultsAction(raceId);
    setSettling(false);
    setResult(r);
    if (!r.error) router.refresh();
  }

  async function toggleBetting() {
    setClosing(true);
    setResult(null);
    const response = isOpen
      ? await closeBettingAction(raceId)
      : await reopenBettingAction(raceId);
    setClosing(false);
    if (response.error) {
      setResult({ error: response.error });
      return;
    }
    setResult({
      updated: 0,
      added: 0,
      warnings: [isOpen ? "Lines closed for this race." : "Lines reopened for this race."],
    });
    router.refresh();
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
            inputMode="numeric"
            placeholder="MRP ID or full URL"
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
        <button
          onClick={findEventId}
          disabled={findingId}
          className="w-full rounded-lg border border-[var(--accent)]/40 px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-colors disabled:opacity-40"
        >
          {findingId ? "Searching MRP…" : currentEventId ? "Recheck / Auto-Find MRP Event" : "Auto-Find MRP Event ID"}
        </button>
      </div>

      {lookupResult && (
        <div className={`rounded-xl px-4 py-3.5 space-y-2 text-xs ${lookupResult.error ? "bg-amber-500/10 border border-amber-500/20" : "bg-[var(--surface-raised)] border border-[var(--border)]"}`}>
          {lookupResult.error ? (
            <p className="text-amber-300">{lookupResult.error}</p>
          ) : (
            <p className="font-semibold text-white">
              Linked MRP #{lookupResult.eventId}: {lookupResult.trackName}
            </p>
          )}
          {lookupResult.eventName && lookupResult.eventName !== "Already linked" && (
            <p className="text-[var(--muted)]">{lookupResult.eventName}</p>
          )}
          {lookupResult.score !== undefined && (
            <p className="text-[var(--muted)]">
              Match score {lookupResult.score} {lookupResult.reasons?.length ? `- ${lookupResult.reasons.join(", ")}` : ""}
            </p>
          )}
          {lookupResult.candidates && lookupResult.candidates.length > 0 && (
            <div className="space-y-1 border-t border-[var(--border)] pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Top MRP candidates</div>
              {lookupResult.candidates.map((candidate) => (
                <button
                  key={candidate.eventId}
                  type="button"
                  onClick={() => linkCandidate(candidate.eventId)}
                  className="flex w-full justify-between gap-3 text-left text-[10px] hover:text-white"
                  disabled={savingId}
                >
                  <span className="min-w-0 truncate text-slate-400">
                    #{candidate.eventId} {candidate.trackName} - {candidate.eventName}
                  </span>
                  <span className="shrink-0 text-[var(--accent)]">{candidate.score}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Closeout</p>
            <p className="mt-1 text-xs text-slate-300">
              {isCancelled
                ? "Race is cancelled."
                : isSettled
                  ? "Race is complete and settled."
                  : isOpen
                    ? "Lines are open. Close them before the feature."
                    : "Lines are closed. Sync final MRP results when posted."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {!isSettled && !isCancelled ? (
            <button
              type="button"
              onClick={toggleBetting}
              disabled={closing}
              className={`flex-1 rounded-lg border px-4 py-2.5 text-xs font-bold transition-colors disabled:opacity-40 ${
                isOpen
                  ? "border-red-500/40 text-red-400 hover:bg-red-500/10"
                  : "border-green-500/40 text-green-400 hover:bg-green-500/10"
              }`}
            >
              {closing ? "Updating…" : isOpen ? "Close Lines" : "Reopen Lines"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={syncResults}
            disabled={settling || !currentEventId || isSettled || isCancelled}
            className="flex-1 rounded-lg bg-green-400 px-4 py-2.5 text-xs font-black text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {settling ? "Checking Results…" : "Sync Final / Close Race"}
          </button>
        </div>
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
                {result.scratched !== undefined && (
                  <span className={result.scratched > 0 ? "text-amber-400" : "text-[var(--muted)]"}>
                    {result.scratched} scratched
                  </span>
                )}
                {result.modelScored !== undefined && (
                  <span className={result.modelScored > 0 ? "text-green-400" : "text-[var(--muted)]"}>
                    {result.modelScored} model scores refreshed
                  </span>
                )}
              </div>

              {result.modelError && (
                <p className="text-amber-400">Model refresh failed: {result.modelError}</p>
              )}

              {result.settlement && (
                <p className="text-green-300">
                  Settled {result.settlement.synced}/{result.settlement.total}
                  {result.settlement.winner_name ? ` - winner ${result.settlement.winner_name}` : ""}.
                </p>
              )}

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
