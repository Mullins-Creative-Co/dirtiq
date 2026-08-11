"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { placePlayerBetAction, addFundsAction, getOrCreateAccountAction } from "@/app/actions";
import { ACCOUNT_NAME_KEY } from "@/components/account-picker-form";
import type { PropMarket, PlayerBet, PlayerAccount, PropType } from "@/lib/player-bets";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

type SlipPick = PropMarket & {
  id: string;
  stake: string;
};

type PublicRiskCorridor = {
  key: string;
  maxStake: number;
  status: "open" | "limited" | "closed";
  message: string | null;
};

function toWin(stake: number, odds: string): number {
  const n = parseInt(odds, 10);
  if (isNaN(n) || stake <= 0) return 0;
  return n > 0 ? (stake * n) / 100 : (stake * 100) / Math.abs(n);
}

function marketKey(m: PropMarket): string {
  return [
    m.type,
    m.driver_id ?? "none",
    m.driver_b_id ?? "none",
    m.description,
    m.american_odds,
  ].join("|");
}

function getStakeValue(stake: string): number {
  return parseFloat(stake) || 0;
}

function getPickTier(m: PropMarket, index?: number): { label: string; className: string } | null {
  if (m.type !== "win") return null;
  const odds = Number.parseInt(m.american_odds, 10);
  if (Number.isFinite(odds) && odds >= 800) {
    return {
      label: "Dark horse",
      className: "text-violet-200 border-violet-400/40 bg-violet-500/10",
    };
  }
  if (index === 0 || (Number.isFinite(odds) && odds <= 300)) {
    return {
      label: "Favorite",
      className: "text-[var(--accent)] border-[var(--accent)]/40 bg-[var(--accent)]/10",
    };
  }
  return {
    label: "Contender",
    className: "text-blue-200 border-blue-400/40 bg-blue-500/10",
  };
}

function oddsRankValue(odds: string) {
  const n = Number.parseInt(odds, 10);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}

const SECTION_ORDER: PropType[] = ["win", "h2h", "top3", "top5", "laps_led", "dnf"];
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
  riskCorridors = {},
  existingBets,
  isSettled,
  isBettingClosed,
  bettingClosedLabel,
}: {
  raceId: number;
  raceName: string;
  account: PlayerAccount | null;
  markets: PropMarket[];
  riskCorridors?: Record<string, PublicRiskCorridor>;
  existingBets: PlayerBet[];
  isSettled: boolean;
  isBettingClosed?: boolean;
  bettingClosedLabel?: string;
}) {
  const router = useRouter();
  const [account, setAccount] = useState<PlayerAccount | null>(initialAccount);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [namePending, setNamePending] = useState(false);

  const [slip, setSlip] = useState<SlipPick[]>([]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [addingFunds, setAddingFunds] = useState(false);

  const totalStake = slip.reduce((sum, pick) => sum + getStakeValue(pick.stake), 0);
  const totalProfit = slip.reduce((sum, pick) => sum + toWin(getStakeValue(pick.stake), pick.american_odds), 0);
  const maxReturn = totalStake + totalProfit;
  const closed = isBettingClosed ?? isSettled;
  const slipOverCorridor = slip.some((pick) => {
    const maxStake = riskCorridors[pick.id]?.maxStake;
    return maxStake !== undefined && getStakeValue(pick.stake) > maxStake;
  });

  useEffect(() => {
    if (account) return;

    const savedName = localStorage.getItem(ACCOUNT_NAME_KEY)?.trim();
    if (savedName) {
      router.replace(`/race/${raceId}?name=${encodeURIComponent(savedName)}`);
    }
  }, [account, raceId, router]);

  // Group markets by type
  const byType = new Map<PropType, PropMarket[]>();
  for (const m of markets) {
    const arr = byType.get(m.type) ?? [];
    arr.push(m);
    byType.set(m.type, arr);
  }
  for (const arr of byType.values()) {
    arr.sort((a, b) => oddsRankValue(b.american_odds) - oddsRankValue(a.american_odds));
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

  function isInSlip(m: PropMarket) {
    const id = marketKey(m);
    return slip.some((pick) => pick.id === id);
  }

  function corridorFor(m: PropMarket | SlipPick) {
    return riskCorridors[marketKey(m)];
  }

  function select(m: PropMarket) {
    if (closed) return;
    const corridor = corridorFor(m);
    if (corridor?.status === "closed") {
      setFeedback({ ok: false, msg: corridor.message ?? "This market is temporarily capped." });
      return;
    }
    const id = marketKey(m);
    setSlip((current) =>
      current.some((pick) => pick.id === id)
        ? current.filter((pick) => pick.id !== id)
        : [...current, { ...m, id, stake: "" }]
    );
    setFeedback(null);
  }

  function addAmount(id: string, n: number) {
    setSlip((current) =>
      current.map((pick) => {
        if (pick.id !== id) return pick;
        const nextStake = (parseFloat(pick.stake) || 0) + n;
        const maxStake = corridorFor(pick)?.maxStake;
        return {
          ...pick,
          stake: (maxStake !== undefined ? Math.min(nextStake, maxStake) : nextStake).toFixed(2),
        };
      })
    );
  }

  function setPickStake(id: string, stake: string) {
    setSlip((current) =>
      current.map((pick) => (pick.id === id ? { ...pick, stake } : pick))
    );
  }

  function removePick(id: string) {
    setSlip((current) => current.filter((pick) => pick.id !== id));
    setFeedback(null);
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
      localStorage.setItem(ACCOUNT_NAME_KEY, result.account.name);
      setAccount(result.account);
      router.replace(`/race/${raceId}?name=${encodeURIComponent(result.account.name)}`);
    }
  }

  async function handleAddFunds() {
    if (!account) return;
    setAddingFunds(true);
    await addFundsAction(account.id, 500);
    setAddingFunds(false);
    router.refresh();
  }

  async function handlePlaceBets() {
    if (slip.length === 0 || totalStake <= 0 || !account) return;
    if (closed) {
      setFeedback({ ok: false, msg: "Betting is closed for this race." });
      return;
    }
    const invalidPick = slip.find((pick) => getStakeValue(pick.stake) <= 0);
    if (invalidPick) {
      setFeedback({ ok: false, msg: `Add a wager for ${invalidPick.description}.` });
      return;
    }
    if (totalStake > account.balance) {
      setFeedback({ ok: false, msg: `Insufficient balance. You have ${usd(account.balance)}.` });
      return;
    }
    const cappedPick = slip.find((pick) => {
      const maxStake = corridorFor(pick)?.maxStake;
      return maxStake !== undefined && getStakeValue(pick.stake) > maxStake;
    });
    if (cappedPick) {
      const maxStake = corridorFor(cappedPick)?.maxStake ?? 0;
      setFeedback({ ok: false, msg: `${cappedPick.description} is capped at ${usd(maxStake)} right now.` });
      return;
    }
    setPending(true);
    setFeedback(null);

    for (const pick of slip) {
      const result = await placePlayerBetAction({
        account_id: account.id,
        race_id: raceId,
        prop_type: pick.type,
        description: pick.description,
        driver_id: pick.driver_id,
        driver_b_id: pick.driver_b_id,
        american_odds: pick.american_odds,
        stake: getStakeValue(pick.stake),
      });

      if (result.error) {
        setPending(false);
        setFeedback({ ok: false, msg: result.error });
        router.refresh();
        return;
      }
    }

    setPending(false);
    setFeedback({ ok: true, msg: `${slip.length} ticket${slip.length === 1 ? "" : "s"} placed.` });
    setSlip([]);
    router.refresh();
  }

  // No account — show sign-in
  if (!account) {
    return (
      <div className="mx-auto max-w-md pt-4">
        <div className="panel-raised p-8">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">dirtIQ Sportsbook</p>
          <h2 style={{ fontFamily: "var(--font-display)" }} className="mb-1 text-2xl font-extrabold text-white">Open a play-money wallet</h2>
          <p className="mb-6 text-sm text-[var(--muted-strong)]">
            Returning players keep their balance. New wallets start with $1,000.
          </p>
          <form onSubmit={handleSignIn} className="space-y-3">
            {nameError && <p className="text-xs text-[var(--racing-red)]">{nameError}</p>}
            <input
              type="text"
              placeholder="Wallet name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={40}
              autoFocus
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-white placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            />
            <button
              type="submit"
              disabled={namePending || !nameInput.trim()}
              className="btn-accent w-full py-3 text-sm font-extrabold uppercase tracking-widest"
            >
              {namePending ? "Loading..." : "Open Wallet"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Wallet strip */}
      <div className="panel-raised flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
        <div className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/12 text-sm font-black uppercase text-[var(--accent)]">
            {account.name.slice(0, 2)}
          </span>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Playing as</div>
            <div className="font-bold text-white">{account.name}</div>
          </div>
          <div className="h-8 w-px bg-[var(--border)]" />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Balance</div>
            <div style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-extrabold tabular-nums text-[var(--accent)]">{usd(account.balance)}</div>
          </div>
        </div>
        <button
          onClick={handleAddFunds}
          disabled={addingFunds}
          className="rounded-md border border-[var(--accent)]/40 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-[var(--accent)] transition-all hover:bg-[var(--accent)] hover:text-[#0b0d10] active:scale-95 disabled:opacity-50"
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
                  <div className="mb-3 flex items-center gap-3">
                    <span className="h-4 w-1 rounded-full bg-[var(--accent)]" />
                    <h2 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold uppercase tracking-[0.14em] text-white">Head to Head</h2>
                    <span className="ml-auto text-[10px] text-[var(--muted)]">{SECTION_DESCRIPTIONS.h2h}</span>
                  </div>
                  <div className="panel divide-y divide-[var(--border)] overflow-hidden">
                    {h2hPairs.map((pair, idx) => (
                      <div key={idx} className="px-4 py-3">
                        <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                          {pair.a.driver_name} vs {pair.b.driver_name}
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Side A */}
                          <button
                            onClick={() => !closed && select(pair.a)}
                            disabled={closed}
                            data-selected={isInSlip(pair.a)}
                            className={`odds-pill flex flex-1 items-center justify-between px-3 py-2.5 ${closed ? "cursor-default opacity-50" : "cursor-pointer"}`}
                          >
                            <span className="min-w-0 pr-2">
                              <span className={`block truncate text-sm font-semibold ${isInSlip(pair.a) ? "text-[#0b0d10]" : "text-white"}`}>{pair.a.driver_name}</span>
                            </span>
                            <span className="shrink-0 text-sm font-extrabold tabular-nums">
                              {pair.a.american_odds}
                            </span>
                          </button>

                          <span className="shrink-0 text-[10px] font-bold text-[var(--muted)]">vs</span>

                          {/* Side B */}
                          <button
                            onClick={() => !closed && select(pair.b)}
                            disabled={closed}
                            data-selected={isInSlip(pair.b)}
                            className={`odds-pill flex flex-1 items-center justify-between px-3 py-2.5 ${closed ? "cursor-default opacity-50" : "cursor-pointer"}`}
                          >
                            <span className="min-w-0 pr-2">
                              <span className={`block truncate text-sm font-semibold ${isInSlip(pair.b) ? "text-[#0b0d10]" : "text-white"}`}>{pair.b.driver_name}</span>
                            </span>
                            <span className="shrink-0 text-sm font-extrabold tabular-nums">
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
                <div className="mb-3 flex items-center gap-3">
                  <span className="h-4 w-1 rounded-full bg-[var(--accent)]" />
                  <h2 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold uppercase tracking-[0.14em] text-white">{SECTION_LABELS[type]}</h2>
                  <span className="ml-auto text-[10px] text-[var(--muted)]">{SECTION_DESCRIPTIONS[type]}</span>
                </div>
                <div className="panel overflow-hidden">
                  <div className="divide-y divide-[var(--border)]">
                    {sectionMarkets.map((m, i) => {
                      const isSelected = isInSlip(m);
                      const tier = getPickTier(m, i);
                      const corridor = corridorFor(m);
                      const isCapped = corridor?.status === "closed";

                      return (
                        <div
                          key={`${m.type}-${m.driver_id}-${m.driver_b_id}-${i}`}
                          onClick={() => !closed && select(m)}
                          className={`flex items-center gap-4 px-4 py-3.5 transition-colors
                            ${isSelected ? "bg-[var(--accent)]/[0.07]" : "hover:bg-[var(--surface-raised)]"}
                            ${closed || isCapped ? "cursor-default opacity-55" : "cursor-pointer"}`}
                        >
                          {type === "win" && (
                            <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-[var(--muted)]">{i + 1}</span>
                          )}

                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-white">
                                {m.driver_name ?? m.description}
                              </span>
                              {tier && (
                                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${tier.className}`}>
                                  {tier.label}
                                </span>
                              )}
                              {corridor?.message && (
                                <span className="rounded-full border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--accent)]">
                                  {corridor.message}
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!closed) select(m);
                            }}
                            disabled={closed || isCapped}
                            data-selected={isSelected}
                            className={`odds-pill min-w-[4.75rem] px-4 py-2.5 text-sm font-extrabold tabular-nums ${closed || isCapped ? "cursor-default opacity-50" : ""}`}
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
              <div className="mb-3 flex items-center gap-3">
                <span className="h-4 w-1 rounded-full bg-[var(--accent)]" />
                <h2 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold uppercase tracking-[0.14em] text-white">
                  My Bets on {raceName}
                  <span className="ml-2 text-xs font-medium normal-case tracking-normal text-[var(--muted)]">{existingBets.length} bets</span>
                </h2>
              </div>
              <div className="panel overflow-hidden">
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
                      <tr key={bet.id} className="border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--surface-raised)]">
                        <td className="px-3 py-2.5 text-xs font-medium text-white">{bet.description}</td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[var(--muted-strong)]">{bet.american_odds}</td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-white">{usd(bet.stake)}</td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                          {bet.status === "won"
                            ? <span className="font-bold text-[var(--racing-green)]">+{usd(bet.payout_if_win - bet.stake)}</span>
                            : bet.status === "lost"
                            ? <span className="text-[var(--racing-red)]">-{usd(bet.stake)}</span>
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
        <div className="sticky top-24">
          <div className="panel-raised overflow-hidden">

            {/* Slip header */}
            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-raised)] px-5 py-4">
              <div className="flex items-center gap-2">
                <span style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold text-white">Straight Bet Slip</span>
                {slip.length > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-black text-[#0b0d10]">
                    {slip.length}
                  </span>
                )}
              </div>
              {slip.length > 0 && (
                <button
                  onClick={() => { setSlip([]); setFeedback(null); }}
                  className="text-xs text-[var(--muted)] transition-colors hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            {closed ? (
              <div className="px-5 py-12 text-center">
                <div className="text-sm text-[var(--muted-strong)]">{bettingClosedLabel ?? "Betting Closed"}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  {isSettled ? "Results are final and bets have been graded" : "Bets are no longer accepted"}
                </div>
              </div>
            ) : slip.length === 0 ? (
              <div className="space-y-2 px-5 py-14 text-center">
                <div className="text-sm text-[var(--muted-strong)]">Your bet slip is empty</div>
                <div className="text-xs text-[var(--muted)]">Tap several winner prices to build a board.</div>
              </div>
            ) : (
              <div className="space-y-4 p-5">

                <div className="space-y-3">
                  {slip.map((pick) => {
                    const stakeNum = getStakeValue(pick.stake);
                    const profit = toWin(stakeNum, pick.american_odds);
                    const pickTier = getPickTier(pick);
                    const corridor = corridorFor(pick);
                    const exceedsCorridor = corridor ? stakeNum > corridor.maxStake : false;

                    return (
                      <div key={pick.id} className="space-y-3 rounded-md border border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] px-4 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{SECTION_LABELS[pick.type]}</span>
                              {pickTier && (
                                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${pickTier.className}`}>
                                  {pickTier.label}
                                </span>
                              )}
                              {corridor?.message && (
                                <span className="rounded-full border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--accent)]">
                                  {corridor.message}
                                </span>
                              )}
                            </div>
                            <div className="text-sm font-bold leading-snug text-white">{pick.description}</div>
                          </div>
                          <button
                            onClick={() => removePick(pick.id)}
                            className="shrink-0 text-xs text-[var(--muted)] transition-colors hover:text-white"
                          >
                            Remove
                          </button>
                        </div>
                        <div className={`text-2xl font-extrabold tabular-nums ${parseInt(pick.american_odds) > 0 ? "text-[var(--racing-green)]" : "text-[var(--accent)]"}`}>
                          {pick.american_odds}
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[10, 25, 50, 100].map((amt) => (
                            <button
                              key={amt}
                              onClick={() => addAmount(pick.id, amt)}
                              className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] py-2 text-xs font-semibold text-white transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] active:scale-95"
                            >
                              +${amt}
                            </button>
                          ))}
                        </div>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted)]">$</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="0.00"
                            value={pick.stake}
                            max={corridor?.maxStake}
                            onChange={(e) => setPickStake(pick.id, e.target.value)}
                            className={`w-full rounded-md border bg-[var(--surface-raised)] py-3 pl-7 pr-4 text-sm font-semibold tabular-nums text-white placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 ${
                              exceedsCorridor
                                ? "border-[var(--racing-red)] focus:border-[var(--racing-red)] focus:ring-[var(--racing-red)]/20"
                                : "border-[var(--border)] focus:border-[var(--accent)] focus:ring-[var(--accent)]/20"
                            }`}
                          />
                        </div>
                        {exceedsCorridor && (
                          <div className="text-[10px] font-semibold text-[var(--racing-red)]">
                            Current max for this market is {usd(corridor?.maxStake ?? 0)}.
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[var(--muted)]">To win</span>
                          <span className={stakeNum > 0 ? "font-bold text-[var(--racing-green)]" : "text-[var(--muted)]"}>+{usd(profit)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Payout preview */}
                <div className="space-y-2 rounded-md bg-[var(--surface-raised)] px-4 py-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--muted)]">Total stake</span>
                    <span className={`text-sm font-bold tabular-nums ${totalStake > 0 ? "text-white" : "text-[var(--muted)]"}`}>
                      {usd(totalStake)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--muted)]">Max profit</span>
                    <span className={`text-sm font-bold tabular-nums ${totalProfit > 0 ? "text-[var(--racing-green)]" : "text-[var(--muted)]"}`}>
                      +{usd(totalProfit)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--border)] pt-2">
                    <span className="text-xs text-[var(--muted)]">Max return</span>
                    <span className={`text-base font-extrabold tabular-nums ${maxReturn > 0 ? "text-white" : "text-[var(--muted)]"}`}>
                      {usd(maxReturn)}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">
                    Balance: {usd(account.balance)}. Winner picks are separate straight bets.
                  </div>
                </div>

                {feedback && (
                  <div className={`rounded-md px-4 py-3 text-xs ${feedback.ok ? "border border-[var(--racing-green)]/25 bg-[var(--racing-green)]/10 text-[var(--racing-green)]" : "border border-[var(--racing-red)]/25 bg-[var(--racing-red)]/10 text-[var(--racing-red)]"}`}>
                    {feedback.msg}
                  </div>
                )}

                <button
                  onClick={handlePlaceBets}
                  disabled={pending || totalStake <= 0 || totalStake > account.balance || slipOverCorridor}
                  className="btn-accent w-full py-3.5 text-sm font-extrabold uppercase tracking-wide"
                >
                  {pending
                    ? "Placing…"
                    : totalStake > account.balance
                    ? "Insufficient Balance"
                    : slipOverCorridor
                    ? "Adjust Capped Wagers"
                    : totalStake > 0
                    ? `Place ${slip.length} Ticket${slip.length === 1 ? "" : "s"} · ${usd(totalStake)}`
                    : "Enter Wagers"}
                </button>
              </div>
            )}
          </div>

        <div className="panel mt-4 space-y-2.5 p-4 text-xs text-[var(--muted)]">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white">Market Guide</div>
            {[
              { code: "WIN", label: "Race Winner", desc: "Straight-up feature winner" },
              { code: "H2H", label: "Head to Head", desc: "Which driver finishes higher?" },
              { code: "T3", label: "Top 3", desc: "Finishes P1, P2, or P3" },
              { code: "LED", label: "Leads a Lap", desc: "Driver leads at least 1 lap" },
              { code: "DNF", label: "DNF Prop", desc: "Driver does not finish" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <span className="shrink-0 font-mono text-[10px] font-bold text-[var(--accent)]">{item.code}</span>
                <div>
                  <span className="font-medium text-white">{item.label}</span>
                  <span className="ml-1 text-[var(--muted)]">— {item.desc}</span>
                </div>
              </div>
            ))}
            <div className="border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted)]">
              All bets use fake money. No real wagers involved.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
