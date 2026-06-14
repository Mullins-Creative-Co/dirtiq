"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { placeManualSimBetAction } from "@/app/actions";

export type OddsEntry = {
  driverId: number;
  driverName: string;
  carNumber: string | null;
  americanOdds: string;
  impliedProbability: number;
};

export type BettorEntry = {
  id: number;
  name: string;
  persona: string;
  bankroll: number;
};

function toWin(stake: number, odds: string): number {
  const n = parseInt(odds, 10);
  if (isNaN(n) || stake <= 0) return 0;
  return n > 0 ? (stake * n) / 100 : (stake * 100) / Math.abs(n);
}

const PERSONA_COLOR: Record<string, string> = {
  square:       "text-blue-400",
  chalk_chaser: "text-amber-400",
  contrarian:   "text-purple-400",
  sharp:        "text-green-400",
  small_stakes: "text-slate-400",
  high_roller:  "text-red-400",
};

export function SimBettingBoard({
  raceId,
  odds,
  bettors,
}: {
  raceId: number;
  odds: OddsEntry[];
  bettors: BettorEntry[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<OddsEntry | null>(null);
  const [bettorId, setBettorId] = useState<number>(bettors[0]?.id ?? 1);
  const [stake, setStake] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const stakeNum = parseFloat(stake) || 0;
  const profit = selected ? toWin(stakeNum, selected.americanOdds) : 0;
  const totalReturn = stakeNum + profit;

  function select(o: OddsEntry) {
    if (selected?.driverId === o.driverId) {
      setSelected(null);
    } else {
      setSelected(o);
      setFeedback(null);
    }
  }

  function addAmount(n: number) {
    setStake((prev) => ((parseFloat(prev) || 0) + n).toFixed(2));
  }

  async function placeBet() {
    if (!selected || stakeNum <= 0) return;
    setPending(true);
    setFeedback(null);
    const result = await placeManualSimBetAction({
      race_id: raceId,
      bettor_id: bettorId,
      driver_id: selected.driverId,
      driver_name: selected.driverName,
      amount: stakeNum,
      american_odds: selected.americanOdds,
    });
    setPending(false);

    if (result.error) {
      setFeedback({ ok: false, msg: result.error });
    } else if (result.blocked) {
      setFeedback({ ok: false, msg: result.blocked_reason ?? "Bet blocked by risk limits." });
    } else {
      setFeedback({ ok: true, msg: `Bet placed on ${selected.driverName} at ${selected.americanOdds}` });
      setStake("");
      setSelected(null);
      router.refresh();
    }
  }

  const maxProb = Math.max(...odds.map((o) => o.impliedProbability), 0.01);

  return (
    <div className="grid xl:grid-cols-[1fr_340px] gap-5 items-start">

      {/* ── Odds Board ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Race Winner</span>
          <span className="text-[10px] text-[var(--muted)]">{odds.length} drivers</span>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          {odds.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-[var(--muted)]">
              No drivers in field — add entries on the race page first.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {odds.map((o, i) => {
                const isSelected = selected?.driverId === o.driverId;
                const barWidth = Math.round((o.impliedProbability / maxProb) * 100);
                const isFav = i === 0;

                return (
                  <div
                    key={o.driverId}
                    onClick={() => select(o)}
                    className={`flex items-center gap-4 px-4 py-3.5 cursor-pointer transition-colors
                      ${isSelected ? "bg-[var(--accent)]/10" : "hover:bg-[var(--surface-raised)]"}`}
                  >
                    {/* Rank */}
                    <span className="text-xs text-slate-600 w-4 shrink-0 text-right">{i + 1}</span>

                    {/* Driver */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm truncate">{o.driverName}</span>
                        {isFav && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--accent)] border border-[var(--accent)]/40 rounded px-1.5 py-0.5 shrink-0">
                            Fav
                          </span>
                        )}
                        {o.carNumber && (
                          <span className="text-[10px] text-[var(--muted)] shrink-0">#{o.carNumber}</span>
                        )}
                      </div>
                      {/* Win-probability bar */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 rounded-full bg-[var(--border)] overflow-hidden max-w-32">
                          <div
                            className={`h-full rounded-full transition-all ${isSelected ? "bg-[var(--accent)]" : "bg-slate-600"}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-[var(--muted)] tabular-nums">
                          {(o.impliedProbability * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Odds chip */}
                    <button
                      onClick={(e) => { e.stopPropagation(); select(o); }}
                      className={`rounded-xl px-4 py-2.5 text-sm font-bold tabular-nums shrink-0 transition-all
                        ${isSelected
                          ? "bg-[var(--accent)] text-black shadow-lg shadow-amber-500/20 scale-105"
                          : "bg-[var(--surface-raised)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black hover:scale-105"
                        }`}
                    >
                      {o.americanOdds}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Bet Slip ── */}
      <div className="sticky top-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">

          {/* Slip header */}
          <div className="px-5 py-4 bg-[var(--surface-raised)] border-b border-[var(--border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">Bet Slip</span>
              {selected && (
                <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-black text-[10px] font-bold flex items-center justify-center">
                  1
                </span>
              )}
            </div>
            {selected && (
              <button
                onClick={() => { setSelected(null); setStake(""); setFeedback(null); }}
                className="text-xs text-[var(--muted)] hover:text-white transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {!selected ? (
            <div className="px-5 py-14 text-center space-y-2">
              <div className="text-sm text-[var(--muted)]">Your bet slip is empty</div>
              <div className="text-xs text-slate-600">Tap an odds chip to add a selection</div>
            </div>
          ) : (
            <div className="p-5 space-y-4">

              {/* Selection card */}
              <div className="rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-4 py-3.5 space-y-1">
                <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">Race Winner</div>
                <div className="font-bold text-white">{selected.driverName}</div>
                <div className={`text-xl font-black tabular-nums ${parseInt(selected.americanOdds) > 0 ? "text-green-400" : "text-[var(--accent)]"}`}>
                  {selected.americanOdds}
                </div>
              </div>

              {/* Bettor selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[var(--muted)]">Placing as</label>
                <select
                  value={bettorId}
                  onChange={(e) => setBettorId(Number(e.target.value))}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
                >
                  {bettors.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-[var(--muted)]">
                  {(() => {
                    const b = bettors.find((x) => x.id === bettorId);
                    const meta = b ? PERSONA_COLOR[b.persona] : "text-white";
                    return b ? (
                      <span className={meta}>${b.bankroll.toFixed(0)} bankroll · {b.persona.replace(/_/g, " ")}</span>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* Quick amounts */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[var(--muted)]">Quick add</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {[5, 10, 25, 50].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => addAmount(amt)}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] py-2 text-xs font-semibold text-white hover:border-[var(--accent)] hover:text-[var(--accent)] active:scale-95 transition-all"
                    >
                      +${amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Wager field */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[var(--muted)]">Wager</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted)]">$</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] pl-7 pr-4 py-3 text-sm font-semibold text-white tabular-nums placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              {/* Payout preview */}
              <div className={`rounded-xl px-4 py-3.5 space-y-2 transition-colors ${stakeNum > 0 ? "bg-[var(--surface-raised)]" : "bg-[var(--surface-raised)]/50"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--muted)]">To win</span>
                  <span className={`text-sm font-bold tabular-nums ${stakeNum > 0 ? "text-green-400" : "text-slate-600"}`}>
                    +${profit.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--muted)]">Total return</span>
                  <span className={`text-sm font-bold tabular-nums ${stakeNum > 0 ? "text-white" : "text-slate-600"}`}>
                    ${totalReturn.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Feedback */}
              {feedback && (
                <div className={`rounded-xl px-4 py-3 text-xs ${feedback.ok ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                  {feedback.msg}
                </div>
              )}

              {/* Place bet CTA */}
              <button
                onClick={placeBet}
                disabled={pending || stakeNum <= 0}
                className="w-full rounded-xl bg-[var(--accent)] py-3.5 text-sm font-black text-black tracking-wide disabled:opacity-40 hover:opacity-90 active:scale-[.98] transition-all"
              >
                {pending ? "Placing…" : stakeNum > 0 ? `Place Bet  ·  $${stakeNum.toFixed(2)}` : "Enter a Wager"}
              </button>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
