"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setRiskLimitsAction } from "@/app/actions";
import type { RiskLimits } from "@/lib/book";

export function RiskLimitsForm({ raceId, limits }: { raceId: number; limits: RiskLimits }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxPayout, setMaxPayout] = useState(limits.max_payout_per_driver?.toString() ?? "");
  const [maxBet, setMaxBet] = useState(limits.max_bet_size?.toString() ?? "");
  const [alertPct, setAlertPct] = useState(Math.round(limits.alert_handle_pct * 100).toString());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setSaved(false);
    setError(null);
    const result = await setRiskLimitsAction({
      race_id: raceId,
      max_payout_per_driver: maxPayout ? parseFloat(maxPayout) : null,
      max_bet_size: maxBet ? parseFloat(maxBet) : null,
      alert_handle_pct: Math.min(Math.max(parseFloat(alertPct) / 100, 0.05), 1),
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {saved && <p className="text-xs text-green-400">Limits saved.</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="space-y-1.5">
        <label className="block text-xs text-[var(--muted)]">Max payout / driver ($)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="Unlimited"
          value={maxPayout}
          onChange={(e) => setMaxPayout(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
        />
        <p className="text-[10px] text-[var(--muted)]">Bets that would exceed this payout are rejected.</p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs text-[var(--muted)]">Max bet size ($)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="Unlimited"
          value={maxBet}
          onChange={(e) => setMaxBet(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs text-[var(--muted)]">Alert threshold (%)</label>
        <input
          type="number"
          min="5"
          max="100"
          step="1"
          value={alertPct}
          onChange={(e) => setAlertPct(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
        />
        <p className="text-[10px] text-[var(--muted)]">Flag when a driver holds more than this share of handle.</p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-[var(--accent)] hover:text-white transition-colors"
      >
        {pending ? "Saving…" : "Save Limits"}
      </button>
    </form>
  );
}
