"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { runSimulationAction, clearSimBetsAction, simulateWinnerAction } from "@/app/actions";

export function SimControls({ raceId, hasOpenBets }: { raceId: number; hasOpenBets: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"run" | "clear" | "settle" | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function handle(action: "run" | "clear" | "settle") {
    setPending(action);
    setMessage(null);

    if (action === "run") {
      const result = await runSimulationAction(raceId);
      if (result.error) {
        setMessage({ text: result.error, ok: false });
      } else {
        setMessage({
          text: `Simulation complete — ${result.placed} bets placed, ${result.blocked} blocked by limits.`,
          ok: true,
        });
        router.refresh();
      }
    } else if (action === "clear") {
      const result = await clearSimBetsAction(raceId);
      if (result.error) setMessage({ text: result.error, ok: false });
      else { setMessage({ text: "Simulation cleared.", ok: true }); router.refresh(); }
    } else if (action === "settle") {
      const result = await simulateWinnerAction(raceId);
      if (result.error) setMessage({ text: result.error, ok: false });
      else {
        setMessage({ text: `${result.driverName} wins! Bets settled.`, ok: true });
        router.refresh();
      }
    }

    setPending(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handle("run")}
          disabled={pending !== null}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {pending === "run" ? "Running…" : "Run Simulation"}
        </button>
        {hasOpenBets && (
          <button
            onClick={() => handle("settle")}
            disabled={pending !== null}
            className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm font-semibold text-green-400 hover:bg-green-500/20 disabled:opacity-40 transition-colors"
          >
            {pending === "settle" ? "Settling…" : "Simulate Winner"}
          </button>
        )}
        <button
          onClick={() => handle("clear")}
          disabled={pending !== null}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-medium text-[var(--muted)] hover:text-white hover:border-red-500/40 disabled:opacity-40 transition-colors"
        >
          {pending === "clear" ? "Clearing…" : "Clear All"}
        </button>
      </div>
      {message && (
        <p className={`text-xs ${message.ok ? "text-green-400" : "text-red-400"}`}>{message.text}</p>
      )}
    </div>
  );
}
