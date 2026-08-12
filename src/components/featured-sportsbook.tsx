"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeFeaturedBoardBetAction, getOrCreateAccountAction } from "@/app/actions";
import { ACCOUNT_NAME_KEY } from "@/components/account-picker-form";
import {
  featuredPickId,
  type FeaturedMarket,
  type FeaturedPick,
  type FeaturedRace,
} from "@/lib/featured-board";

type SportsbookAccount = {
  id: number;
  name: string;
  balance: number;
  created_at: string;
};

type FeaturedBoardBetRow = {
  id: number;
  account_id: number;
  account_name: string;
  race_key: string;
  race_name: string;
  series: string;
  track: string;
  market: FeaturedMarket;
  selection: string;
  description: string;
  american_odds: string;
  stake: number;
  payout_if_win: number;
  status: "open" | "won" | "lost" | "void";
  created_at: string;
};

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

function toWin(stake: number, odds: string) {
  const numeric = Number.parseInt(odds, 10);
  if (!Number.isFinite(numeric) || stake <= 0) return 0;
  return numeric > 0 ? (stake * numeric) / 100 : (stake * 100) / Math.abs(numeric);
}

const marketTone: Record<FeaturedMarket, string> = {
  Outright: "border-red-400/35 bg-red-500/10 text-red-100",
  "Top 3": "border-sky-400/35 bg-sky-500/10 text-sky-100",
  "Top 5": "border-blue-400/35 bg-blue-500/10 text-blue-100",
  "Top 10": "border-cyan-400/35 bg-cyan-500/10 text-cyan-100",
  "Most Laps Led": "border-amber-400/35 bg-amber-500/10 text-amber-100",
  "Caution Free": "border-emerald-400/35 bg-emerald-500/10 text-emerald-100",
  Matchup: "border-violet-400/35 bg-violet-500/10 text-violet-100",
  Creative: "border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-100",
};

const markets: Array<FeaturedMarket | "All"> = [
  "All",
  "Outright",
  "Top 3",
  "Top 5",
  "Top 10",
  "Most Laps Led",
  "Caution Free",
  "Matchup",
  "Creative",
];

export function FeaturedSportsbook({
  account,
  races,
  picks,
  bets,
}: {
  account: SportsbookAccount | null;
  races: FeaturedRace[];
  picks: FeaturedPick[];
  bets: FeaturedBoardBetRow[];
}) {
  const router = useRouter();
  const openRaces = races.filter((race) => race.status === "OPEN");
  const [raceId, setRaceId] = useState(openRaces[0]?.id ?? "");
  const [market, setMarket] = useState<FeaturedMarket | "All">("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stake, setStake] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [namePending, setNamePending] = useState(false);
  const betSlipRef = useRef<HTMLDivElement>(null);

  const activeRace = openRaces.find((race) => race.id === raceId) ?? openRaces[0] ?? null;
  const racePicks = activeRace
    ? picks.filter((pick) => {
        if (pick.raceId !== activeRace.id) return false;
        return market === "All" || pick.market === market;
      })
    : [];

  const selectedPick = selectedId
    ? picks.find((pick) => featuredPickId(pick) === selectedId) ?? null
    : null;
  const stakeNumber = Number.parseFloat(stake) || 0;
  const profit = selectedPick ? toWin(stakeNumber, selectedPick.line) : 0;
  const totalReturn = stakeNumber + profit;
  const balance = account?.balance ?? 0;

  function selectPick(pick: FeaturedPick) {
    const id = featuredPickId(pick);
    setSelectedId((current) => (current === id ? null : id));
    setFeedback(null);
    // Scroll bet slip into view on smaller screens
    setTimeout(() => {
      betSlipRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
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
    } else {
      localStorage.setItem(ACCOUNT_NAME_KEY, nameInput.trim());
      router.push(`/bet?name=${encodeURIComponent(nameInput.trim())}`);
    }
  }

  function addStake(amount: number) {
    setStake((current) => ((Number.parseFloat(current) || 0) + amount).toFixed(2));
  }

  function placeBet() {
    if (!account || !selectedPick || stakeNumber <= 0) return;
    startTransition(async () => {
      const result = await placeFeaturedBoardBetAction({
        accountId: account.id,
        pickId: featuredPickId(selectedPick),
        stake: stakeNumber,
      });

      if (result.error) {
        setFeedback({ ok: false, message: result.error });
        return;
      }

      setFeedback({
        ok: true,
        message: `Ticket placed: ${selectedPick.selection} ${selectedPick.line}`,
      });
      setStake("");
      setSelectedId(null);
      router.refresh();
    });
  }

  return (
    <section className="border border-white/10 bg-white/[0.04]">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-300">
              Sportsbook
            </p>
            <h2 className="mt-1 text-xl font-black text-white">
              All Race-Specific Betting Lines
            </h2>
          </div>
          <div className="grid grid-cols-3 overflow-hidden border border-white/10 bg-slate-950/70 text-center text-xs">
            <div className="px-3 py-2">
              <div className="font-black text-white">{openRaces.length}</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Races</div>
            </div>
            <div className="border-x border-white/10 px-3 py-2">
              <div className="font-black text-white">{picks.length}</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Lines</div>
            </div>
            <div className="px-3 py-2">
              <div className="font-black text-amber-300">{account ? usd(balance) : "--"}</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Balance</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[260px_1fr_360px]">
        <aside className="border-b border-white/10 bg-slate-950/40 p-4 xl:border-b-0 xl:border-r">
          <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
            Pick a race
          </div>
          <div className="grid gap-2">
            {openRaces.map((race) => {
              const isActive = activeRace?.id === race.id;
              const count = picks.filter((pick) => pick.raceId === race.id).length;
              return (
                <button
                  key={race.id}
                  onClick={() => {
                    setRaceId(race.id);
                    setSelectedId(null);
                    setFeedback(null);
                  }}
                  className={`border px-3 py-3 text-left transition ${
                    isActive
                      ? "border-amber-300 bg-amber-300/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/30"
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-widest text-red-200">
                    {race.dateLabel}
                  </div>
                  <div className="mt-1 text-sm font-black leading-5 text-white">{race.raceName}</div>
                  <div className="mt-1 text-xs text-slate-400">{race.track}</div>
                  <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-amber-200">
                    {count} lines
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 p-4 sm:p-5">
          {activeRace && (
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  {activeRace.series}
                </p>
                <h3 className="mt-1 text-lg font-black text-white">{activeRace.raceName}</h3>
                <p className="mt-1 text-sm text-slate-400">
                  {activeRace.track} - {activeRace.location} - {activeRace.purse}
                </p>
              </div>
              <div className="flex max-w-full gap-1 overflow-x-auto">
                {markets.map((item) => (
                  <button
                    key={item}
                    onClick={() => setMarket(item)}
                    className={`shrink-0 border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                      market === item
                        ? "border-white bg-white text-slate-950"
                        : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/30"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-hidden border border-white/10 bg-slate-950/65">
            {racePicks.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                No lines in this market.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {racePicks.map((pick) => {
                  const id = featuredPickId(pick);
                  const isSelected = selectedId === id;
                  return (
                    <div
                      key={id}
                      className={`grid gap-3 px-4 py-4 transition sm:grid-cols-[1fr_116px] ${
                        isSelected ? "bg-amber-300/10" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => selectPick(pick)}
                        className="min-w-0 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${marketTone[pick.market]}`}
                          >
                            {pick.market}
                          </span>
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                            {pick.line.startsWith("-") ? "Favorite" : pick.confidence === "Spec" ? "Longshot" : "Open"}
                          </span>
                        </div>
                        <div className="mt-2 text-base font-black leading-6 text-white">
                          {pick.selection}
                        </div>
                        <div className="mt-2 grid max-w-lg grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-slate-500">Market</div>
                            <div className="font-black text-white">{pick.market}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-slate-500">Ticket type</div>
                            <div className="font-black text-amber-200">Straight</div>
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => selectPick(pick)}
                        className={`h-14 self-center border text-lg font-black tabular-nums transition ${
                          isSelected
                            ? "border-amber-300 bg-amber-300 text-slate-950"
                            : "border-white/10 bg-white/[0.06] text-amber-300 hover:border-amber-300/60 hover:bg-amber-300/15"
                        }`}
                      >
                        {pick.line}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {bets.length > 0 && (
            <div className="mt-5 overflow-hidden border border-white/10 bg-slate-950/65">
              <div className="border-b border-white/10 px-4 py-3">
                <h3 className="text-sm font-black text-white">My Sportsbook Tickets</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-black/20">
                      {["Race", "Bet", "Odds", "Stake", "Return", "Status"].map((heading) => (
                        <th
                          key={heading}
                          className={`px-3 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 ${
                            ["Race", "Bet"].includes(heading) ? "text-left" : "text-right"
                          }`}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bets.slice(0, 12).map((bet) => (
                      <tr key={bet.id} className="border-b border-white/10 last:border-0">
                        <td className="px-3 py-2.5 text-xs text-slate-400">{bet.race_name}</td>
                        <td className="px-3 py-2.5 text-xs font-semibold text-white">{bet.description}</td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-amber-200">{bet.american_odds}</td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-white">{usd(bet.stake)}</td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                          {bet.status === "won"
                            ? <span className="font-bold text-emerald-300">+{usd(bet.payout_if_win - bet.stake)}</span>
                            : bet.status === "lost"
                            ? <span className="text-red-400">-{usd(bet.stake)}</span>
                            : bet.status === "void"
                            ? <span className="text-slate-500">refund</span>
                            : <span className="text-slate-400">{usd(bet.payout_if_win)}</span>}
                        </td>
                        <td className={`px-3 py-2.5 text-right text-[10px] font-black uppercase ${
                          bet.status === "won" ? "text-emerald-300" : bet.status === "lost" ? "text-red-400" : bet.status === "void" ? "text-slate-500" : "text-blue-300"
                        }`}>
                          {bet.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <aside className="border-t border-white/10 bg-slate-950/50 p-4 xl:border-l xl:border-t-0">
          <div ref={betSlipRef} className="sticky top-4 border border-white/10 bg-[#101010]">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-4 py-3">
              <div className="text-sm font-black text-white">Bet Slip</div>
              {selectedPick && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setStake("");
                    setFeedback(null);
                  }}
                  className="text-xs font-bold text-slate-500 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            {!account ? (
              <div className="px-4 py-5 space-y-3">
              <div className="text-sm font-bold text-white">Open a play-money wallet</div>
                <p className="text-xs text-slate-500">New wallets start with $1,000. Returning players keep their balance.</p>
                <form onSubmit={handleSignIn} className="space-y-2">
                  {nameError && <p className="text-xs text-red-400">{nameError}</p>}
                  <input
                    type="text"
                    placeholder="Wallet name"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={40}
                    className="w-full border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-amber-300 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={namePending || !nameInput.trim()}
                    className="w-full bg-amber-300 py-2.5 text-sm font-black text-slate-950 disabled:opacity-40 hover:bg-amber-200"
                  >
                    {namePending ? "Loading..." : "Open Wallet"}
                  </button>
                </form>
              </div>
            ) : !selectedPick ? (
              <div className="px-4 py-12 text-center">
                <div className="text-sm text-slate-400">Your bet slip is empty</div>
                <div className="mt-1 text-xs text-slate-600">Tap any odds price to add a ticket.</div>
              </div>
            ) : (
              <div className="space-y-4 p-4">
                <div className="border border-amber-300/25 bg-amber-300/10 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {selectedPick.market}
                  </div>
                  <div className="mt-1 text-sm font-black leading-5 text-white">
                    {selectedPick.selection}
                  </div>
                  <div className="mt-2 text-3xl font-black text-amber-300 tabular-nums">
                    {selectedPick.line}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Quick stake
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[10, 25, 50, 100].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => addStake(amount)}
                        className="border border-white/10 bg-white/[0.04] py-2 text-xs font-black text-white hover:border-amber-300/60"
                      >
                        +${amount}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Wager
                  </span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-500">
                      $
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={stake}
                      onChange={(event) => setStake(event.target.value)}
                      className="w-full border border-white/10 bg-slate-950 px-7 py-3 text-sm font-black text-white outline-none focus:border-amber-300"
                      placeholder="0.00"
                    />
                  </div>
                  <span className="mt-2 block text-[10px] text-slate-500">
                    Balance: {usd(balance)}
                  </span>
                </label>

                <div className="border border-white/10 bg-white/[0.04] p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">To win</span>
                    <span className="font-black text-emerald-300">+{usd(profit)}</span>
                  </div>
                  <div className="mt-2 flex justify-between">
                    <span className="text-slate-500">Total return</span>
                    <span className="font-black text-white">{usd(totalReturn)}</span>
                  </div>
                </div>

                {feedback && (
                  <div
                    className={`border px-3 py-2 text-xs ${
                      feedback.ok
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                        : "border-red-400/30 bg-red-400/10 text-red-200"
                    }`}
                  >
                    {feedback.message}
                  </div>
                )}

                <button
                  type="button"
                  onClick={placeBet}
                  disabled={isPending || stakeNumber <= 0 || stakeNumber > balance}
                  className="w-full bg-amber-300 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-200 disabled:opacity-40"
                >
                  {isPending
                    ? "Placing..."
                    : stakeNumber > balance
                      ? "Insufficient Balance"
                      : stakeNumber > 0
                        ? `Place Bet - ${usd(stakeNumber)}`
                        : "Enter a Wager"}
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
