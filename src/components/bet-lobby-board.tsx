"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { placePlayerBetAction } from "@/app/actions";
import type { PlayerAccount, PropType } from "@/lib/player-bets";

type LobbyBetLine = {
  race_id: number;
  race_name: string;
  race_date: string;
  division: string | null;
  track_name: string;
  prop_type: PropType;
  section: string;
  description: string;
  driver_id: number;
  driver_name: string;
  driver_b_id: number | null;
  driver_b_name: string | null;
  market_odds: string;
  entry_status: string | null;
  max_stake?: number;
  corridor_status?: "open" | "limited" | "closed";
  corridor_message?: string | null;
};

type SlipPick = LobbyBetLine & {
  id: string;
  stake: string;
};

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

function lineId(line: LobbyBetLine) {
  return [
    line.race_id,
    line.prop_type,
    line.driver_id,
    line.driver_b_id ?? "none",
    line.description,
    line.market_odds,
  ].join("|");
}

function stakeValue(value: string) {
  return Number.parseFloat(value) || 0;
}

function toWin(stake: number, odds: string) {
  const n = Number.parseInt(odds, 10);
  if (!Number.isFinite(n) || stake <= 0) return 0;
  return n > 0 ? (stake * n) / 100 : (stake * 100) / Math.abs(n);
}

export function BetLobbyBoard({
  account,
  lines,
}: {
  account: PlayerAccount | null;
  lines: LobbyBetLine[];
}) {
  const router = useRouter();
  const [slip, setSlip] = useState<SlipPick[]>([]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const totalStake = slip.reduce((sum, pick) => sum + stakeValue(pick.stake), 0);
  const totalProfit = slip.reduce(
    (sum, pick) => sum + toWin(stakeValue(pick.stake), pick.market_odds),
    0,
  );
  const slipOverMax = slip.some((pick) => pick.max_stake !== undefined && stakeValue(pick.stake) > pick.max_stake);

  function selected(line: LobbyBetLine) {
    return slip.some((pick) => pick.id === lineId(line));
  }

  function toggle(line: LobbyBetLine) {
    setFeedback(null);
    const id = lineId(line);
    setSlip((current) =>
      current.some((pick) => pick.id === id)
        ? current.filter((pick) => pick.id !== id)
        : [...current, { ...line, id, stake: "" }],
    );
  }

  function setStake(id: string, stake: string) {
    setSlip((current) => current.map((pick) => (pick.id === id ? { ...pick, stake } : pick)));
  }

  function bumpStake(id: string, amount: number) {
    setSlip((current) =>
      current.map((pick) => {
        if (pick.id !== id) return pick;
        const nextStake = (Number.parseFloat(pick.stake) || 0) + amount;
        const maxStake = pick.max_stake ?? 50;
        return { ...pick, stake: Math.min(nextStake, maxStake).toFixed(2) };
      }),
    );
  }

  async function placeTickets() {
    if (!account) {
      setFeedback({ ok: false, message: "Enter your name first." });
      return;
    }
    if (slip.length === 0) return;

    const missingStake = slip.find((pick) => stakeValue(pick.stake) <= 0);
    if (missingStake) {
      setFeedback({ ok: false, message: `Add a stake for ${missingStake.driver_name}.` });
      return;
    }
    if (totalStake > account.balance) {
      setFeedback({ ok: false, message: `Insufficient balance. You have ${usd(account.balance)}.` });
      return;
    }
    const overMax = slip.find((pick) => pick.max_stake !== undefined && stakeValue(pick.stake) > pick.max_stake);
    if (overMax) {
      setFeedback({ ok: false, message: `${overMax.description} is capped at ${usd(overMax.max_stake ?? 0)}.` });
      return;
    }

    setPending(true);
    setFeedback(null);
    for (const pick of slip) {
      const result = await placePlayerBetAction({
        account_id: account.id,
        race_id: pick.race_id,
        prop_type: pick.prop_type,
        description: pick.description,
        driver_id: pick.driver_id,
        driver_b_id: pick.driver_b_id,
        american_odds: pick.market_odds,
        stake: stakeValue(pick.stake),
      });
      if (result.error) {
        setPending(false);
        setFeedback({ ok: false, message: result.error });
        router.refresh();
        return;
      }
    }

    setPending(false);
    setFeedback({
      ok: true,
      message: `${slip.length} winner ticket${slip.length === 1 ? "" : "s"} placed.`,
    });
    setSlip([]);
    router.refresh();
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="border border-white/10 bg-white/[0.04]">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-xl font-black text-white">Protected Odds & Props</h2>
        </div>
        <div className="grid divide-y divide-white/10">
          {lines.map((line) => {
            const isSelected = selected(line);
            return (
              <button
                key={`${line.race_id}-${line.driver_id}-${line.market_odds}`}
                type="button"
                onClick={() => toggle(line)}
                className={`grid gap-3 px-5 py-4 text-left transition sm:grid-cols-[1fr_auto] ${
                  isSelected ? "bg-[var(--accent)]/10" : "hover:bg-white/[0.03]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border border-red-400/35 bg-red-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-red-100">
                      {line.section}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {line.entry_status ?? "expected"}
                    </span>
                    {line.corridor_status && line.corridor_status !== "open" && (
                      <span className="border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-100">
                        {line.corridor_status === "closed" ? "Capped" : line.corridor_message ?? "Limited"}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-base font-black leading-6 text-white">
                    {line.description}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {line.race_name} · {line.track_name} · {line.division ?? "Late Models"}
                  </p>
                  {line.max_stake !== undefined && (
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-amber-200">
                      Max stake {usd(line.max_stake)}
                    </p>
                  )}
                </div>
                <div
                  className={`self-center border px-5 py-3 text-center text-lg font-black tabular-nums ${
                    isSelected
                      ? "border-[var(--accent)] bg-[var(--accent)] text-black"
                      : "border-white/10 bg-white/[0.06] text-amber-300"
                  }`}
                >
                  {line.market_odds}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-raised)] px-5 py-4">
          <h2 className="text-sm font-black text-white">Ticket Slip</h2>
          <span className="bg-[var(--accent)] px-2 py-1 text-[10px] font-black text-black">
            {slip.length}
          </span>
        </div>

        {!account ? (
          <div className="px-5 py-10 text-sm text-[var(--muted)]">Open a wallet to place play-money tickets.</div>
        ) : slip.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--muted)]">Select winner prices to build your slip.</div>
        ) : (
          <div className="space-y-4 p-5">
            {slip.map((pick) => {
              const stake = stakeValue(pick.stake);
              return (
                <div key={pick.id} className="border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">
                        {pick.race_name} · {pick.section}
                      </div>
                      <div className="text-sm font-black text-white">{pick.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(pick)}
                      className="text-xs text-[var(--muted)] hover:text-white"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 text-2xl font-black tabular-nums text-[var(--accent)]">
                    {pick.market_odds}
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-1.5">
                    {[5, 10, 25, 50].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => bumpStake(pick.id, amount)}
                        className="border border-[var(--border)] bg-[var(--surface-raised)] py-2 text-xs font-semibold text-white hover:border-[var(--accent)]"
                      >
                        +${amount}
                      </button>
                    ))}
                  </div>
                  <div className="relative mt-3">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted)]">
                      $
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={pick.stake}
                      onChange={(event) => setStake(pick.id, event.target.value)}
                      className="w-full border border-[var(--border)] bg-[var(--surface-raised)] py-3 pl-7 pr-3 text-sm font-semibold text-white focus:border-[var(--accent)] focus:outline-none"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-[var(--muted)]">To win</span>
                    <span className="font-bold text-green-400">+{usd(toWin(stake, pick.market_odds))}</span>
                  </div>
                  {pick.max_stake !== undefined && (
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-[var(--muted)]">Max stake</span>
                      <span className="font-bold text-amber-200">{usd(pick.max_stake)}</span>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="bg-[var(--surface-raised)] px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Total stake</span>
                <span className="font-black text-white">{usd(totalStake)}</span>
              </div>
              <div className="mt-2 flex justify-between">
                <span className="text-[var(--muted)]">Max profit</span>
                <span className="font-black text-green-400">+{usd(totalProfit)}</span>
              </div>
            </div>

            {feedback && (
              <div className={`px-4 py-3 text-xs ${feedback.ok ? "border border-green-500/20 bg-green-500/10 text-green-400" : "border border-red-500/20 bg-red-500/10 text-red-400"}`}>
                {feedback.message}
              </div>
            )}

            <button
              type="button"
              onClick={placeTickets}
              disabled={pending || totalStake <= 0 || totalStake > account.balance || slipOverMax}
              className="w-full bg-[var(--accent)] py-3.5 text-sm font-black text-black disabled:opacity-40"
            >
              {pending
                ? "Placing..."
                : slipOverMax
                  ? "Stake Above Max"
                : totalStake > account.balance
                  ? "Insufficient Balance"
                  : `Place ${slip.length} Ticket${slip.length === 1 ? "" : "s"} - ${usd(totalStake)}`}
            </button>
          </div>
        )}
      </aside>
    </section>
  );
}
