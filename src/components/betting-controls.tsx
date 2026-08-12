"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelRaceAction,
  closeBettingAction,
  reopenBettingAction,
  syncMrpResultsAction,
  type MrpSyncResult,
} from "@/app/actions";

export function BettingControls({
  raceId,
  bettingStatus,
  raceStatus,
  isLive,
  hasMrpEvent,
}: {
  raceId: number;
  bettingStatus: string | null;
  raceStatus: string;
  isLive: boolean;
  hasMrpEvent: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<MrpSyncResult | null>(null);

  const isSettled = raceStatus === "complete" || bettingStatus === "settled";
  const isCancelled = raceStatus === "cancelled" || bettingStatus === "void";
  const isOpen = !isSettled && !isLive && (bettingStatus ?? "open") === "open";

  function run(action: "close" | "reopen") {
    setResult(null);
    startTransition(async () => {
      const response = action === "close"
        ? await closeBettingAction(raceId)
        : await reopenBettingAction(raceId);
      if (response.error) setResult({ error: response.error });
      router.refresh();
    });
  }

  async function syncResults() {
    setSyncing(true);
    setResult(null);
    const response = await syncMrpResultsAction(raceId);
    setResult(response);
    setSyncing(false);
    if (!response.error) router.refresh();
  }

  function cancelRace() {
    if (!window.confirm("Mark this race cancelled and void open bets? This removes it from active betting.")) {
      return;
    }

    setResult(null);
    startTransition(async () => {
      const response = await cancelRaceAction(raceId);
      if (response.error) {
        setResult({ error: response.error });
        return;
      }
      setResult({
        event_name: "Race cancelled",
        updated: response.voided ?? 0,
        added: 0,
        warnings: [`Voided ${response.voided ?? 0} open bets.`],
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Race Closeout</p>
        <p className="mt-1 text-xs text-slate-300">
          {isCancelled
            ? "Race is cancelled and open bets are void."
            : isSettled
              ? "Race is complete and settlement is closed."
              : isOpen
                ? "Betting is open. Close it before the feature starts."
                : "Betting is closed. Sync final results when MRP is official."}
        </p>
      </div>
      <div className="flex gap-2 flex-wrap">
        {isOpen ? (
          <button
            type="button"
            onClick={() => run("close")}
            disabled={pending}
            className="flex-1 rounded-lg border border-red-500/40 px-4 py-2.5 text-xs font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
          >
            {pending ? "Closing..." : "Close Betting"}
          </button>
        ) : !isSettled ? (
          <button
            type="button"
            onClick={() => run("reopen")}
            disabled={pending}
            className="flex-1 rounded-lg border border-green-500/40 px-4 py-2.5 text-xs font-bold text-green-400 hover:bg-green-500/10 disabled:opacity-40 transition-colors"
          >
            {pending ? "Reopening..." : "Reopen Betting"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={syncResults}
          disabled={syncing || !hasMrpEvent || isSettled || isCancelled}
          className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-black text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {syncing ? "Settling..." : "Sync Final Results"}
        </button>
        {!isSettled && !isCancelled ? (
          <button
            type="button"
            onClick={cancelRace}
            disabled={pending}
            className="flex-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
          >
            {pending ? "Cancelling..." : "Cancel / Void"}
          </button>
        ) : null}
      </div>

      {!hasMrpEvent && (
        <p className="text-[10px] text-amber-400">Link an MRP Event ID before syncing final results.</p>
      )}

      {result && (
        <div className={`rounded-xl px-4 py-3 text-xs space-y-2 ${result.error ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-green-500/10 border border-green-500/20 text-green-300"}`}>
          {result.error ? (
            <p>{result.error}</p>
          ) : (
            <>
              <p className="font-semibold">
                Settled {result.settlement?.synced ?? result.updated ?? 0} of {result.settlement?.total ?? 0} results
                {result.settlement?.winner_name ? ` - winner ${result.settlement.winner_name}` : ""}.
              </p>
              {result.warnings?.map((warning, index) => (
                <p key={index} className="text-amber-300">{warning}</p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
