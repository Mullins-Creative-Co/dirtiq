import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getRace } from "@/lib/races";
import { calculateRaceOdds } from "@/lib/odds";
import { getSimBets, getSimBettorResults, getSimBookSummary, listBettors } from "@/lib/sim";
import { getRiskLimits } from "@/lib/book";
import { SimBettingBoard } from "@/components/sim-betting-board";
import { SimControls } from "@/components/sim-controls";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const usdC = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

const PERSONA: Record<string, { label: string; color: string }> = {
  square:       { label: "The Square",     color: "text-blue-400" },
  chalk_chaser: { label: "Chalk Charlie",  color: "text-amber-400" },
  contrarian:   { label: "Contrarian",     color: "text-purple-400" },
  sharp:        { label: "The Sharp",      color: "text-green-400" },
  small_stakes: { label: "Tommy $2",       color: "text-slate-400" },
  high_roller:  { label: "High Roller",    color: "text-red-400" },
};

function PLBadge({ value }: { value: number }) {
  const color = value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-[var(--muted)]";
  return <span className={`tabular-nums font-bold ${color}`}>{value > 0 ? "+" : ""}{usd(value)}</span>;
}

export default async function SimPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const raceId = parseInt(id, 10);
  if (isNaN(raceId)) notFound();

  const race = getRace(raceId);
  if (!race) notFound();

  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const rawOdds = plain(calculateRaceOdds(raceId, race.track_id));
  const bettors = plain(listBettors());
  const simBets = plain(getSimBets(raceId));
  const bettorResults = plain(getSimBettorResults(raceId));
  const bookSummary = plain(getSimBookSummary(raceId));
  const limits = plain(getRiskLimits(raceId));

  // Shape odds for the betting board
  const odds = rawOdds.map((o: {
    driverId: number; driverName: string; carNumber: string | null;
    americanOdds: string; impliedProbability: number;
  }) => ({
    driverId: o.driverId,
    driverName: o.driverName,
    carNumber: o.carNumber,
    americanOdds: o.americanOdds,
    impliedProbability: o.impliedProbability,
  }));

  const hasOpenBets = simBets.some((b: { status: string }) => b.status === "open");
  const isSettled = simBets.some((b: { status: string }) => b.status === "won" || b.status === "lost");
  const winnerBet = simBets.find((b: { status: string }) => b.status === "won") as { driver_name: string } | undefined;

  const activeBets = simBets.filter((b: { status: string }) => b.status !== "blocked");
  const blockedBets = simBets.filter((b: { status: string }) => b.status === "blocked");

  const limitsActive = limits.max_payout_per_driver !== null || limits.max_bet_size !== null;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)] flex-wrap">
              <Link href="/races" className="hover:text-white transition-colors">Races</Link>
              <span>/</span>
              <Link href={`/races/${raceId}`} className="hover:text-white transition-colors">{race.name}</Link>
              <span>/</span>
              <Link href={`/races/${raceId}/book`} className="hover:text-white transition-colors">Book</Link>
              <span>/</span>
              <span className="text-white">Simulation</span>
            </div>
            <h1 className="mt-2 text-2xl font-black text-white tracking-tight">{race.name}</h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {race.track_name} · {fmt.format(new Date(race.race_date + "T12:00:00"))} · {race.division}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {limitsActive && (
              <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
                Risk limits active
              </div>
            )}
            {isSettled && winnerBet && (
              <div className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-sm font-bold text-green-400">
                Winner: {winnerBet.driver_name}
              </div>
            )}
            <Link
              href={`/races/${raceId}/book`}
              className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:text-white transition-colors"
            >
              Real Book →
            </Link>
          </div>
        </div>

        {/* ── Betting Board (FanDuel-style odds + bet slip) ── */}
        <SimBettingBoard raceId={raceId} odds={odds} bettors={bettors} />

        {/* ── Bulk Simulation ── */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <h2 className="text-sm font-bold text-white">Run All Personas</h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Automatically generate bets from all six bettor profiles in one shot.
                {limitsActive && " Risk limits apply — blocked bets are recorded."}
              </p>
            </div>
            {bookSummary.total_handle > 0 && (
              <div className="flex items-center gap-4 text-sm shrink-0">
                <div className="text-right">
                  <div className="text-xs text-[var(--muted)]">Handle</div>
                  <div className="font-bold text-white tabular-nums">{usdC(bookSummary.total_handle)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[var(--muted)]">Worst Case</div>
                  <div className={`font-bold tabular-nums ${bookSummary.worst_case_pl < 0 ? "text-red-400" : "text-green-400"}`}>
                    {usdC(bookSummary.worst_case_pl)}
                  </div>
                </div>
                {bookSummary.num_blocked > 0 && (
                  <div className="text-right">
                    <div className="text-xs text-[var(--muted)]">Blocked</div>
                    <div className="font-bold text-amber-400">{bookSummary.num_blocked}</div>
                  </div>
                )}
              </div>
            )}
          </div>
          <SimControls raceId={raceId} hasOpenBets={hasOpenBets} />
        </div>

        {/* ── Results (shown after bets exist) ── */}
        {simBets.length > 0 && (
          <div className="space-y-6">

            {/* Bettor cards */}
            <section>
              <h2 className="text-sm font-bold text-white mb-3">
                Bettor Positions
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">{bettors.length} personas</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {bettorResults.map((r: {
                  bettor_id: number; persona: string; bets: number; blocked: number;
                  total_staked: number; net_pl: number;
                }) => {
                  const meta = PERSONA[r.persona] ?? { label: r.persona, color: "text-white" };
                  const hasBets = r.bets > 0;
                  return (
                    <div key={r.bettor_id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-2.5">
                      <div className={`text-xs font-bold ${meta.color}`}>{meta.label}</div>
                      {hasBets ? (
                        <>
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[var(--muted)]">Bets</span>
                              <span className="text-white font-semibold">{r.bets}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[var(--muted)]">Staked</span>
                              <span className="text-white tabular-nums">{usdC(r.total_staked)}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[var(--muted)]">P&L</span>
                              <PLBadge value={r.net_pl} />
                            </div>
                          </div>
                          {r.blocked > 0 && (
                            <div className="text-[10px] text-amber-400 border-t border-[var(--border)] pt-2">
                              {r.blocked} blocked
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-[10px] text-slate-600">No bets</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Bet ledger */}
            {activeBets.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-white mb-3">
                  Bet Ledger
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">{activeBets.length} bets · {usdC(bookSummary.total_handle)} handle</span>
                </h2>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                        {["Bettor", "Driver", "Odds", "Stake", "To Win", "Status"].map((h) => (
                          <th key={h} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${["Bettor","Driver"].includes(h) ? "text-left" : "text-right"}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeBets.map((bet: {
                        id: number; bettor_name: string; driver_name: string;
                        american_odds: string; amount: number; payout_if_win: number; status: string;
                      }) => (
                        <tr key={bet.id}
                          className={`border-b border-[var(--border)] last:border-0 transition-colors
                            ${bet.status === "won" ? "bg-green-500/5" : bet.status === "lost" ? "opacity-40" : "hover:bg-[var(--surface-raised)]"}`}>
                          <td className="px-4 py-3 text-xs text-[var(--muted)]">{bet.bettor_name}</td>
                          <td className="px-4 py-3 text-xs font-semibold text-white">{bet.driver_name}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-xs text-[var(--muted)]">{bet.american_odds}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-xs text-white">{usd(bet.amount)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-xs text-green-400">{usd(bet.payout_if_win - bet.amount)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${
                              bet.status === "won"  ? "text-green-400" :
                              bet.status === "lost" ? "text-slate-600" :
                              "text-blue-400"
                            }`}>{bet.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[var(--border)] bg-[var(--surface-raised)]">
                        <td colSpan={3} className="px-4 py-2.5 text-xs text-[var(--muted)]">Total</td>
                        <td className="px-4 py-2.5 text-right text-xs font-bold text-white tabular-nums">{usd(bookSummary.total_handle)}</td>
                        <td colSpan={2} className="px-4 py-2.5 text-right text-xs text-[var(--muted)]">
                          House: {usd(bookSummary.worst_case_pl)} / {usd(bookSummary.best_case_pl)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            )}

            {/* Blocked bets */}
            {blockedBets.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-white mb-3">
                  Blocked by Risk Limits
                  <span className="ml-2 text-xs font-normal text-amber-400">{blockedBets.length} rejected · saved {usdC(blockedBets.reduce((s: number, b: { payout_if_win: number }) => s + b.payout_if_win, 0))} in payouts</span>
                </h2>
                <div className="rounded-2xl border border-amber-500/20 bg-[var(--surface)] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-amber-500/20 bg-amber-500/5">
                        {["Bettor", "Driver", "Stake", "Would Pay", "Reason"].map((h) => (
                          <th key={h} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-amber-600 ${["Bettor","Reason"].includes(h) ? "text-left" : "text-right"}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {blockedBets.map((bet: {
                        id: number; bettor_name: string; driver_name: string;
                        amount: number; payout_if_win: number; blocked_reason: string | null;
                      }) => (
                        <tr key={bet.id} className="border-b border-amber-500/10 last:border-0 hover:bg-amber-500/5 transition-colors">
                          <td className="px-4 py-3 text-xs text-amber-400">{bet.bettor_name}</td>
                          <td className="px-4 py-3 text-xs font-semibold text-white">{bet.driver_name}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-xs text-[var(--muted)]">{usd(bet.amount)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-xs text-red-400">{usd(bet.payout_if_win)}</td>
                          <td className="px-4 py-3 text-xs text-amber-400 max-w-xs">{bet.blocked_reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

          </div>
        )}

      </main>
    </div>
  );
}
