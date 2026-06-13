"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { placeBetAction } from "@/app/actions";

type OddsEntry = { driver_id: number; driver_name: string; american_odds: string };

function payoutPreview(stake: number, odds: string): number | null {
  const n = parseInt(odds, 10);
  if (isNaN(n) || stake <= 0) return null;
  const mult = n > 0 ? n / 100 : 100 / Math.abs(n);
  return stake + stake * mult;
}

export function PlaceBetForm({ raceId, oddsEntries }: { raceId: number; oddsEntries: OddsEntry[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [bettor, setBettor] = useState("");
  const [driverId, setDriverId] = useState<number | "">(oddsEntries[0]?.driver_id ?? "");
  const [stake, setStake] = useState("");

  const selected = oddsEntries.find((o) => o.driver_id === Number(driverId));
  const stakeNum = parseFloat(stake);
  const payout = selected && stakeNum > 0 ? payoutPreview(stakeNum, selected.american_odds) : null;
  const profit = payout !== null ? payout - stakeNum : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !stakeNum || stakeNum <= 0) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await placeBetAction({
        race_id: raceId,
        driver_id: selected.driver_id,
        bettor_name: bettor || undefined,
        amount: stakeNum,
        american_odds: selected.american_odds,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`Bet placed on ${selected.driver_name} at ${selected.american_odds}`);
        setStake("");
        setBettor("");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-green-400">{success}</p>}

      <div className="space-y-2">
        <label className="block text-xs text-[var(--muted)]">Bettor (optional)</label>
        <input
          type="text"
          placeholder="Name or ticket #"
          value={bettor}
          onChange={(e) => setBettor(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs text-[var(--muted)]">Driver</label>
        <select
          value={driverId}
          onChange={(e) => setDriverId(Number(e.target.value))}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
        >
          {oddsEntries.map((o) => (
            <option key={o.driver_id} value={o.driver_id}>
              {o.driver_name} ({o.american_odds})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="block text-xs text-[var(--muted)]">Stake ($)</label>
        <input
          type="number"
          min="0.01"
          step="0.01"
          placeholder="20.00"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white tabular-nums placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {/* Payout preview */}
      {payout !== null && (
        <div className="rounded-lg bg-[var(--surface-raised)] px-4 py-3 flex items-center justify-between text-sm">
          <span className="text-[var(--muted)]">To win</span>
          <span className="text-green-400 font-bold tabular-nums">+${profit!.toFixed(2)}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !selected || !stakeNum || stakeNum <= 0}
        className="w-full rounded-lg bg-[var(--accent)] py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90"
      >
        {pending ? "Placing…" : "Place Bet"}
      </button>
    </form>
  );
}
