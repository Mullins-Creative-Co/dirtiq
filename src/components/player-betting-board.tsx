"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { placePlayerBetAction, addFundsAction, getOrCreateAccountAction } from "@/app/actions";
import type { PropMarket, PlayerBet, PlayerAccount, PropType } from "@/lib/player-bets";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

function toWin(stake: number, odds: string): number {
  const n = parseInt(odds, 10);
  if (isNaN(n) || stake <= 0) return 0;
  return n > 0 ? (stake * n) / 100 : (stake * 100) / Math.abs(n);
}

const SECTION_ORDER: PropType[] = ["win", "h2h", "top3", "laps_led", "dnf"];
const SECTION_LABELS: Record<PropType, string> = {
  win: "Race Winner",
  top3: "Top 3 Finish",
  top5: "Top 5 Finish",
  h2h: "Head to Head",
  dnf: "DNF Props",
  laps_led: "Leads a Lap",
};
const SECTION_DESCRIPTIONS: Record<PropType, string> = {
  win: "Outright winner of the feature race",
  top3: "Driver finishes P1, P2, or P3",
  top5: "Driver finishes in the top 5",
  h2h: "Which driver finishes higher in the feature",
  dnf: "Driver does not finish the race",
  laps_led: "Driver leads at least one lap",
};

const STATUS_STYLE: Record<string, string> = {
  won: "text-green-400",
  lost: "text-slate-500",
  void: "text-amber-400",
  open: "text-blue-400",
};

export function PlayerBettingBoard({
  raceId,
  raceName,
  account: initialAccount,
  markets,
  existingBets,
  isSettled,
}: {
  raceId: number;
  raceName: string;
  account: PlayerAccount | null;
  markets: PropMarket[];
  existingBets: PlayerBet[];
  isSettled: boolean;
}) {
  const router = useRouter();
  const [account, setAccount] = useState<PlayerAccount | null>(initialAccount);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [namePending, setNamePending] = useState(false);

  const [selected, setSelected] = useState<PropMarket | null>(null);
  const [stake, setStake] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [addingFunds, setAddingFunds] = useState(false);

  const stakeNum = parseFloat(stake) || 0;
  const profit = selected ? toWin(stakeNum, selected.american_odds) : 0;
  const totalReturn = stakeNum + profit;

  // Group markets by type
  const byType = new Map<PropType, PropMarket[]>();
  for (const m of markets) {
    const arr = byType.get(m.type) ?? [];
    arr.push(m);
    byType.set(m.type, arr);
  }

  // For H2H, group consecutive pairs into matchup objects
  const h2hRaw = byType.get("h2h") ?? [];
  type H2HPair = { a: PropMarket; b: PropMarket };
  const h2hPairs: H2HPair[] = [];
  const h2hSeen = new Set<string>();
  for (const m of h2hRaw) {
    if (!m.driver_id || !m.driver_b_id) continue;
    const pairKey = [m.driver_id, m.driver_b_id].sort().join("-");
    if (h2hSeen.has(pairKey)) continue;
    h2hSeen.add(pairKey);
    const other = h2hRaw.find(
      (x) => x.driver_id === m.driver_b_id && x.driver_b_id === m.driver_id
    );
    if (other) h2hPairs.push({ a: m, b: other });
  }

  function select(m: PropMarket) {
    if (selected?.description === m.description && selected?.driver_id === m.driver_id) {
      setSelected(null);
    } else {
      setSelected(m);
      setFeedback(null);
    }
  }

  function addAmount(n: number) {
    setStake((prev) => ((parseFloat(prev) || 0) + n).toFixed(2));
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!nameInput.trim()) return;
    setNamePending(true);
    setNameError(null);
    const result = await getOrCreateAccountAction(nameInput.trim());
    setNamePending(false);
    if (result.error) {
      setNameError(result.error);
    } else if (result.account) {
      setAccount(result.account);
      router.replace(`/bet/${raceId}?name=${encodeURIComponent(result.account.name)}`);
    }
  }

  async function handleAddFunds() {
    if (!account) return;
    setAddingFunds(true);
    await addFundsAction(account.id, 500);
    setAddingFunds(false);
    router.refresh();
  }

  async function handlePlaceBet() {
    if (!selected || stakeNum <= 0 || !account) return;
    setPending(true);
    setFeedback(null);
    const result = await placePlayerBetAction({
      account_id: account.id,
      race_id: raceId,
      prop_type: selected.type,
      description: selected.description,
      driver_id: selected.driver_id,
      driver_b_id: selected.driver_b_id,
      american_odds: selected.american_odds,
      stake: stakeNum,
    });
    setPending(false);
    if (result.error) {
      setFeedback({ ok: false, msg: result.error });
    } else {
      setFeedback({ ok: true, msg: `Bet placed: ${selected.description} at ${selected.american_odds}` });
      setStake("");
      setSelected(null);
      router.refresh();
    }
  }

  // No account — show sign-in
  if (!account) {
    return (
      <div className="max-w-sm mx-auto pt-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <div className="text-3xl mb-3">🎰</div>
          <h2 className="text-lg font-bold text-white mb-1">Enter your name to bet</h2>
          <p className="text-sm text-[var(--muted)] mb-5">
            Returns players get their existing balance. New players start with $1,000.
          </p>
          <form onSubmit={handleSignIn} className="space-y-3">
            {nameError && <p className="text-xs text-red-400">{nameError}</p>}
            <input
              type="text"
              placeholder="Your name (e.g. BigMike)"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={40}
              autoFocus
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={namePending || !nameInput.trim()}
              className="w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-black text-black disabled:opacity-40 hover:opacity-90 active:scale-[.98] transition-all"
            >
              {namePending ? "Loading…" : "Start Betting →"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Wallet strip */}
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-5 py-3.5 flex-wrap">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-widest">Playing as</div>
            <div className="font-bold text-white">{account.name}</div>
          </div>
          <div className="h-8 w-px bg-[var(--border)]" />
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-widest">Balance</div>
            <div className="text-xl font-black tabular-nums text-[var(--accent)]">{usd(account.balance)}</div>
          </div>
        </div>
        <button
          onClick={handleAddFunds}
          disabled={addingFunds}
          className="rounded-xl border border-[var(--accent)]/40 px-4 py-2 text-xs font-bold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-all active:scale-95 disabled:opacity-50"
        >
          {addingFunds ? "Adding…" : "+ $500 Free Money"}
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px] items-start">

        {/* ── Left: Markets ── */}
        <div className="space-y-6">

          {SECTION_ORDER.map((type) => {
            if (type === "h2h") {
              if (h2hPairs.length === 0) return null;
              return (
                <section key="h2h">
                  <div className="flex items-baseline justify-between mb-3">
                    <h2 className="text-sm font-semibold text-white">Head to Head</h2>
                    <span className="text-[10px] text-[var(--muted)]">{SECTION_DESCRIPTIONS.h2h}</span>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden divide-y divide-[var(--border)]">
                    {h2hPairs.map((pair, idx) => (
                      <div key={idx} className="px-4 py-3">
                        <div className="text-[10px] text-[var(--muted)] mb-2 uppercase tracking-wider">
                          {pair.a.driver_name} vs {pair.b.driver_name}
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Side A */}
                          <button
                            onClick={() => !isSettled && select(pair.a)}
                            disabled={isSettled}
                            className={`flex-1 flex items-center justify-between rounded-xl px-3 py-2.5 transition-all
                              ${selected?.driver_id === pair.a.driver_id && selected?.driver_b_id === pair.a.driver_b_id
                                ? "bg-[var(--accent)]/15 border border-[var(--accent)]/50"
                                : "bg-[var(--surface-raised)] border border-transparent hover:border-[var(--accent)]/30"}
                              ${isSettled ? "cursor-default opacity-50" : "cursor-pointer"}`}
                          >
                            <span className="text-sm font-semibold text-white truncate pr-2">{pair.a.driver_name}</span>
                            <span className={`text-sm font-black tabular-nums shrink-0 ${parseInt(pair.a.american_odds) > 0 ? "text-green-400" : "text-[var(--accent)]"}`}>
                              {pair.a.american_odds}
                            </span>
                          </button>

                          <span className="text-[10px] text-[var(--muted)] font-bold shrink-0">vs</span>

                          {/* Side B */}
                          <button
                            onClick={() => !isSettled && select(pair.b)}
                            disabled={isSettled}
                            className={`flex-1 flex items-center justify-between rounded-xl px-3 py-2.5 transition-all
                              ${selected?.driver_id === pair.b.driver_id && selected?.driver_b_id === pair.b.driver_b_id
                                ? "bg-[var(--accent)]/15 border border-[var(--accent)]/50"
                                : "bg-[var(--surface-raised)] border border-transparent hover:border-[var(--accent)]/30"}
                              ${isSettled ? "cursor-default opacity-50" : "cursor-pointer"}`}
                          >
                            <span className="text-sm font-semibold text-white truncate pr-2">{pair.b.driver_name}</span>
                            <span className={`text-sm font-black tabular-nums shrink-0 ${parseInt(pair.b.american_odds) > 0 ? "text-green-400" : "text-[var(--accent)]"}`}>
                              {pair.b.american_odds}
                            </span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            }

            const sectionMarkets = byType.get(type) ?? [];
            if (sectionMarkets.length === 0) return null;

            return (
              <section key={type}>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white">{SECTION_LABELS[type]}</h2>
                  <span className="text-[10px] text-[var(--muted)]">{SECTION_DESCRIPTIONS[type]}</span>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                  <div className="divide-y divide-[var(--border)]">
                    {sectionMarkets.map((m, i) => {
                      const isSelected =
                        selected?.driver_id === m.driver_id &&
                        selected?.driver_b_id === m.driver_b_id &&
                        selected?.type === m.type;
                      const isFav = type === "win" && i === 0;
                      const barPct = Math.round(m.implied_probability * 100);

                      return (
                        <div
                          key={`${m.type}-${m.driver_id}-${m.driver_b_id}-${i}`}
                          onClick={() => !isSettled && select(m)}
                          className={`flex items-center gap-4 px-4 py-3.5 transition-colors
                            ${isSelected ? "bg-[var(--accent)]/8" : "hover:bg-[var(--surface-raised)]"}
                            ${isSettled ? "cursor-default" : "cursor-pointer"}`}
                        >
                          {type === "win" && (
                            <span className="text-xs text-slate-600 w-4 shrink-0 text-right">{i + 1}</span>
                          )}

                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-white text-sm">
                                {m.driver_name ?? m.description}
                              </span>
                              {isFav && (
                                <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--accent)] border border-[var(--accent)]/40 rounded px-1.5 py-0.5">
                                  Fav
                                </span>
                              )}
                            </div>
                            {type === "win" && (
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 rounded-full bg-[var(--border)] overflow-hidden max-w-28">
                                  <div
                                    className={`h-full rounded-full transition-all ${isSelected ? "bg-[var(--accent)]" : "bg-slate-600"}`}
                                    style={{ width: `${Math.min(barPct * 5, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-[var(--muted)] tabular-nums">{barPct}%</span>
                              </div>
                            )}
                          </div>

                          <button
                            onClick={(e) => { e.stopPropagation(); !isSettled && select(m); }}
                            disabled={isSettled}
                            className={`rounded-xl px-4 py-2.5 text-sm font-black tabular-nums shrink-0 transition-all
                              ${isSelected
                                ? "bg-[var(--accent)] text-black shadow-lg shadow-amber-500/20 scale-105"
                                : "bg-[var(--surface-raised)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black hover:scale-105"}
                              ${isSettled ? "opacity-50 cursor-default" : ""}`}
                          >
                            {m.american_odds}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}

          {/* My bets on this race */}
          {existingBets.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-white mb-3">
                My Bets on {raceName}
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">{existingBets.length} bets</span>
              </h2>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                      {["Bet", "Odds", "Stake", "Potential Return", "Status"].map((h) => (
                        <th
                          key={h}
                          className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${h === "Bet" ? "text-left" : "text-right"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {existingBets.map((bet) => (
                      <tr key={bet.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="px-3 py-2.5 text-xs font-medium text-white">{bet.description}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-xs text-[var(--muted)]">{bet.american_odds}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-xs text-white">{usd(bet.stake)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-xs text-green-400">
                          {bet.status === "won"
                            ? <span className="text-green-400 font-bold">+{usd(bet.payout_if_win - bet.stake)}</span>
                            : bet.status === "lost"
                            ? <span className="text-red-400">-{usd(bet.stake)}</span>
                            : <span className="text-[var(--muted)]">{usd(bet.payout_if_win)}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-[10px] font-bold uppercase ${STATUS_STYLE[bet.status] ?? "text-[var(--muted)]"}`}>
                            {bet.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* ── Right: Bet Slip ── */}
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

            {isSettled ? (
              <div className="px-5 py-12 text-center">
                <div className="text-sm text-[var(--muted)]">This race has been settled</div>
                <div className="text-xs text-slate-600 mt-1">Bets are no longer accepted</div>
              </div>
            ) : !selected ? (
              <div className="px-5 py-14 text-center space-y-2">
                <div className="text-sm text-[var(--muted)]">Your bet slip is empty</div>
                <div className="text-xs text-slate-600">Tap an odds chip to add a selection</div>
              </div>
            ) : (
              <div className="p-5 space-y-4">

                {/* Selection */}
                <div className="rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-4 py-3.5 space-y-1">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">{SECTION_LABELS[selected.type]}</div>
                  <div className="font-bold text-white text-sm leading-snug">{selected.description}</div>
                  <div className={`text-2xl font-black tabular-nums ${parseInt(selected.american_odds) > 0 ? "text-green-400" : "text-[var(--accent)]"}`}>
                    {selected.american_odds}
                  </div>
                </div>

                {/* Quick amounts */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--muted)]">Quick add</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {[10, 25, 50, 100].map((amt) => (
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

                {/* Wager input */}
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
                  <div className="text-[10px] text-[var(--muted)]">
                    Balance: {usd(account.balance)}
                  </div>
                </div>

                {/* Payout preview */}
                <div className={`rounded-xl px-4 py-3.5 space-y-2 ${stakeNum > 0 ? "bg-[var(--surface-raised)]" : "bg-[var(--surface-raised)]/50"}`}>
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

                {feedback && (
                  <div className={`rounded-xl px-4 py-3 text-xs ${feedback.ok ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                    {feedback.msg}
                  </div>
                )}

                <button
                  onClick={handlePlaceBet}
                  disabled={pending || stakeNum <= 0 || stakeNum > account.balance}
                  className="w-full rounded-xl bg-[var(--accent)] py-3.5 text-sm font-black text-black tracking-wide disabled:opacity-40 hover:opacity-90 active:scale-[.98] transition-all"
                >
                  {pending
                    ? "Placing…"
                    : stakeNum > account.balance
                    ? "Insufficient Balance"
                    : stakeNum > 0
                    ? `Place Bet · ${usd(stakeNum)}`
                    : "Enter a Wager"}
                </button>
              </div>
            )}
          </div>

          {/* Prop bet guide */}
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2.5 text-xs text-[var(--muted)]">
            <div className="font-semibold text-white text-[11px] uppercase tracking-wider mb-1">Prop Bet Guide</div>
            {[
              { icon: "🏆", label: "Race Winner", desc: "Straight-up feature winner" },
              { icon: "🤜", label: "Head to Head", desc: "Which driver finishes higher?" },
              { icon: "🏅", label: "Top 3", desc: "Finishes P1, P2, or P3" },
              { icon: "💨", label: "Leads a Lap", desc: "Driver leads at least 1 lap" },
              { icon: "💥", label: "DNF Prop", desc: "Driver doesn't finish" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <span className="text-sm shrink-0">{item.icon}</span>
                <div>
                  <span className="font-medium text-white">{item.label}</span>
                  <span className="text-slate-600 ml-1">— {item.desc}</span>
                </div>
              </div>
            ))}
            <div className="pt-1 border-t border-[var(--border)] text-slate-600 text-[10px]">
              All bets use fake money. No real wagers involved.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
