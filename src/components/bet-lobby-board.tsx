"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { placePlayerBetAction } from "@/app/actions";
import type { PlayerAccount, PropType } from "@/lib/player-bets";
import type { PricingStage } from "@/lib/book-pricing";

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
  line_stage: PricingStage;
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
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 style={{ fontFamily: "var(--font-display)" }} className="text-lg font-bold text-white">Featured Odds & Props</h2>
          <span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
            {lines.length} lines
          </span>
        </div>
        <div className="grid divide-y divide-[var(--border)]">
          {lines.map((line) => {
            const isSelected = selected(line);
            return (
              <div
                key={`${line.race_id}-${line.driver_id}-${line.market_odds}`}
                className={`grid items-center gap-3 px-5 py-4 transition-colors sm:grid-cols-[1fr_auto] ${
                  isSelected ? "bg-[var(--accent)]/[0.07]" : "hover:bg-[var(--surface-raised)]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--racing-red)]/35 bg-[var(--racing-red)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--racing-red)]">
                      {line.section}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                      {line.entry_status ?? "expected"}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                      line.line_stage === "race-night"
                        ? "border-[var(--racing-green)]/40 bg-[var(--racing-green)]/10 text-[var(--racing-green)]"
                        : line.line_stage === "confirmed"
                          ? "border-[var(--info)]/35 bg-[var(--info)]/10 text-[var(--info)]"
                          : "border-[var(--steel)]/30 bg-[var(--steel)]/10 text-[var(--steel)]"
                    }`}>
                      {line.line_stage === "race-night" ? "Race-night model" : line.line_stage === "confirmed" ? "Confirmed field" : "Pre-race model"}
                    </span>
                    {line.corridor_status && line.corridor_status !== "open" && (
                      <span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                        {line.corridor_status === "closed" ? "Capped" : line.corridor_message ?? "Limited"}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-base font-bold leading-6 text-white">
                    {line.description}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {line.race_name} · {line.track_name} · {line.division ?? "Late Models"}
                  </p>
                  {line.max_stake !== undefined && (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]/80">
                      Max stake {usd(line.max_stake)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggle(line)}
                  data-selected={isSelected}
                  className="odds-pill min-w-[5.5rem] self-center px-5 py-3 text-center text-lg font-extrabold"
                >
                  {line.market_odds}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="panel h-fit overflow-hidden xl:sticky xl:top-24">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-raised)] px-5 py-4">
          <h2 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold text-white">Ticket Slip</h2>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-black text-white">
            {slip.length}
          </span>
        </div>

        {!account ? (
          <div className="px-5 py-12 text-center text-sm text-[var(--muted)]">Open a wallet to place play-money tickets.</div>
        ) : slip.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-[var(--muted)]">Tap odds to build your slip.</div>
        ) : (
          <div className="space-y-4 p-5">
            {slip.map((pick) => {
              const stake = stakeValue(pick.stake);
              return (
                <div key={pick.id} className="rounded-md border border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                        {pick.race_name} · {pick.section}
                      </div>
                      <div className="text-sm font-bold text-white">{pick.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(pick)}
                      className="shrink-0 text-xs text-[var(--muted)] transition-colors hover:text-white"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 text-2xl font-extrabold tabular-nums text-[var(--accent)]">
                    {pick.market_odds}
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-1.5">
                    {[5, 10, 25, 50].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => bumpStake(pick.id, amount)}
                        className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] py-2 text-xs font-semibold text-white transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
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
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] py-3 pl-7 pr-3 text-sm font-semibold text-white tabular-nums focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-[var(--muted)]">To win</span>
                    <span className="font-bold text-[var(--racing-green)]">+{usd(toWin(stake, pick.market_odds))}</span>
                  </div>
                  {pick.max_stake !== undefined && (
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-[var(--muted)]">Max stake</span>
                      <span className="font-bold text-[var(--accent)]">{usd(pick.max_stake)}</span>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="rounded-md bg-[var(--surface-raised)] px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Total stake</span>
                <span className="font-bold tabular-nums text-white">{usd(totalStake)}</span>
              </div>
              <div className="mt-2 flex justify-between">
                <span className="text-[var(--muted)]">Max profit</span>
                <span className="font-bold tabular-nums text-[var(--racing-green)]">+{usd(totalProfit)}</span>
              </div>
            </div>

            {feedback && (
              <div className={`rounded-md px-4 py-3 text-xs ${feedback.ok ? "border border-[var(--racing-green)]/25 bg-[var(--racing-green)]/10 text-[var(--racing-green)]" : "border border-[var(--racing-red)]/25 bg-[var(--racing-red)]/10 text-[var(--racing-red)]"}`}>
                {feedback.message}
              </div>
            )}

            <button
              type="button"
              onClick={placeTickets}
              disabled={pending || totalStake <= 0 || totalStake > account.balance || slipOverMax}
              className="btn-accent w-full py-3.5 text-sm font-extrabold uppercase tracking-wide"
            >
              {pending
                ? "Placing..."
                : slipOverMax
                  ? "Stake Above Max"
                : totalStake > account.balance
                  ? "Insufficient Balance"
                  : `Place ${slip.length} Ticket${slip.length === 1 ? "" : "s"} · ${usd(totalStake)}`}
            </button>
          </div>
        )}
      </aside>
    </section>
  );
}
