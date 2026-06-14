import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getRace, getRaceEntries } from "@/lib/races";
import { calculateRaceOdds } from "@/lib/odds";
import { getRaceBets, getDriverLiabilities, getBookSummary, getRiskLimits } from "@/lib/book";
import { PlaceBetForm } from "@/components/place-bet-form";
import { RiskLimitsForm } from "@/components/risk-limits-form";
import { VoidBetButton } from "@/components/void-bet-button";
import { LivePolling } from "@/components/live-polling";
import { GoLiveButton } from "@/components/go-live-button";

const fmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const pct = (n: number, decimals = 1) => `${(n * 100).toFixed(decimals)}%`;

function PLBadge({ value }: { value: number }) {
  const color = value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-[var(--muted)]";
  const prefix = value > 0 ? "+" : "";
  return <span className={`font-bold tabular-nums ${color}`}>{prefix}{usd(value)}</span>;
}

function suggestLineMoveOdds(currentOdds: string, handlePct: number, trueProb: number): string | null {
  if (trueProb <= 0) return null;
  const overExposure = handlePct / trueProb;
  if (overExposure < 1.25) return null;

  const n = parseInt(currentOdds, 10);
  if (isNaN(n)) return null;

  const currentDecimal = n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
  const currentImplied = 1 / currentDecimal;
  // Tighten implied prob by 40% of the overexposure excess, capped at 90%
  const newImplied = Math.min(currentImplied * (1 + 0.4 * (overExposure - 1)), 0.90);
  const newDecimal = 1 / newImplied;

  let suggested: string;
  if (newDecimal >= 2) {
    suggested = `+${Math.round(((newDecimal - 1) * 100) / 5) * 5}`;
  } else {
    suggested = `-${Math.round((100 / (newDecimal - 1)) / 5) * 5}`;
  }

  return suggested === currentOdds ? null : suggested;
}

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const raceId = parseInt(id, 10);
  if (isNaN(raceId)) notFound();

  const race = getRace(raceId);
  if (!race) notFound();

  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const entries = plain(getRaceEntries(raceId));
  const odds = plain(calculateRaceOdds(raceId, race.track_id));
  const bets = plain(getRaceBets(raceId));
  const liabilities = plain(getDriverLiabilities(raceId));
  const summary = plain(getBookSummary(raceId));
  const limits = plain(getRiskLimits(raceId));

  const isComplete = race.status === "complete";
  const isLive = !isComplete && !!(race as any).is_live;

  // Theoretical hold from the sum of implied probabilities
  const sumImplied = odds.reduce((sum: number, o: { impliedProbability: number }) => sum + o.impliedProbability, 0);
  const theoreticalHold = sumImplied > 1 ? (sumImplied - 1) / sumImplied : 0;

  // True (de-vigged) win probabilities for each driver
  const probMap = new Map(
    odds.map((o: { driverId: number; impliedProbability: number }) => [
      o.driverId,
      sumImplied > 0 ? o.impliedProbability / sumImplied : 0,
    ])
  );

  const oddsMap = new Map(odds.map((o: { driverId: number; americanOdds: string }) => [o.driverId, o.americanOdds]));
  const liabilityMap = new Map(liabilities.map((l) => [l.driver_id, l]));

  type FullRow = {
    driver_id: number;
    driver_name: string;
    american_odds: string;
    num_bets: number;
    total_staked: number;
    payout_if_win: number;
    net_pl_if_win: number;
    handle_pct: number;
    has_bets: boolean;
    trueProb: number;
    suggestedOdds: string | null;
  };

  const fullRows: FullRow[] = entries.map((e: { driver_id: number; driver_name: string }) => {
    const lib = liabilityMap.get(e.driver_id);
    const currentOdds = oddsMap.get(e.driver_id) ?? "—";
    const trueProb = probMap.get(e.driver_id) ?? 0;
    const handlePct = lib?.handle_pct ?? 0;
    return {
      driver_id: e.driver_id,
      driver_name: e.driver_name,
      american_odds: currentOdds,
      num_bets: lib?.num_bets ?? 0,
      total_staked: lib?.total_staked ?? 0,
      payout_if_win: lib?.payout_if_win ?? 0,
      net_pl_if_win: lib ? summary.total_handle - lib.payout_if_win : summary.total_handle,
      handle_pct: handlePct,
      has_bets: !!lib,
      trueProb,
      suggestedOdds: lib && handlePct > limits.alert_handle_pct
        ? suggestLineMoveOdds(currentOdds, handlePct, trueProb)
        : null,
    };
  });

  fullRows.sort((a, b) => b.total_staked - a.total_staked);

  // Expected P&L weighted by model win probabilities
  const expectedPL = summary.total_handle > 0
    ? fullRows.reduce((sum, row) => sum + row.trueProb * row.net_pl_if_win, 0)
    : 0;
  const expectedHold = summary.total_handle > 0 ? expectedPL / summary.total_handle : 0;

  const overexposedRows = fullRows.filter((r) => r.has_bets && r.handle_pct > limits.alert_handle_pct);

  const oddsEntries = odds.map((o: { driverId: number; driverName: string; americanOdds: string }) => ({
    driver_id: o.driverId,
    driver_name: o.driverName,
    american_odds: o.americanOdds,
  }));

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <LivePolling enabled={isLive} />
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-10 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
              <Link href="/races" className="hover:text-white transition-colors">← Races</Link>
              <span>/</span>
              <Link href={`/races/${raceId}`} className="hover:text-white transition-colors">{race.name}</Link>
              <span>/</span>
              <span className="text-white">Book</span>
              <span>/</span>
              <Link href={`/races/${raceId}/sim`} className="hover:text-white transition-colors text-[var(--accent)]">Simulation →</Link>
            </div>
            <h1 className="mt-2 text-3xl font-bold text-white">{race.name}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {race.track_name} · {fmt.format(new Date(race.race_date + "T12:00:00"))}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!isComplete && <GoLiveButton raceId={raceId} isLive={isLive} />}
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${isComplete ? "bg-green-500/20 text-green-400" : isLive ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"}`}>
              {isComplete ? "Settled" : isLive ? "Live" : "Book Open"}
            </span>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Handle", value: usd(summary.total_handle), sub: `${summary.num_bets} bets` },
            { label: "Worst Case", value: usd(summary.worst_case_pl), sub: "max house loss", negative: summary.worst_case_pl < 0 },
            { label: "Expected P&L", value: usd(expectedPL), sub: `${pct(expectedHold)} hold`, positive: expectedPL >= 0, negative: expectedPL < 0 },
            { label: "Alerts", value: `${overexposedRows.length}`, sub: `of ${summary.uncovered_drivers} uncovered`, negative: overexposedRows.length > 0 },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
              <div className="text-xs text-[var(--muted)] mb-1">{c.label}</div>
              <div className={`text-xl font-bold tabular-nums ${"negative" in c && c.negative ? "text-red-400" : "positive" in c && c.positive ? "text-green-400" : "text-white"}`}>
                {c.value}
              </div>
              <div className="text-[10px] text-[var(--muted)] mt-0.5">{c.sub}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">

          {/* Liability board */}
          <div className="space-y-5">
            <section>
              <h2 className="text-base font-semibold text-white mb-3">
                Liability Board
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">{entries.length} drivers in field</span>
              </h2>

              {entries.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-sm text-[var(--muted)]">
                  No drivers in the field yet.
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                        {["Driver", "Odds", "Bets", "Handle %", "Staked", "Payout If Win", "House P&L"].map((h) => (
                          <th key={h} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${h === "Driver" ? "text-left" : "text-right"}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fullRows.map((row) => {
                        const handlePct = Math.round(row.handle_pct * 100);
                        const isWorstCase = row.has_bets && row.net_pl_if_win === summary.worst_case_pl;
                        const isAlert = row.has_bets && row.handle_pct > limits.alert_handle_pct;
                        return (
                          <tr key={row.driver_id}
                            className={`border-b border-[var(--border)] last:border-0 ${isAlert ? "bg-amber-500/5" : isWorstCase ? "bg-red-500/5" : "hover:bg-[var(--surface-raised)]"} transition-colors`}>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-white">{row.driver_name}</span>
                                {isWorstCase && <span className="text-[10px] text-red-400 font-medium">MAX EXPOSURE</span>}
                                {isAlert && row.suggestedOdds && (
                                  <span className="text-[10px] text-amber-400 font-medium">
                                    move → {row.suggestedOdds}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs text-[var(--muted)]">{row.american_odds}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs text-[var(--muted)]">{row.num_bets}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                              {row.has_bets ? (
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-16 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${isAlert ? "bg-amber-500" : handlePct > 15 ? "bg-blue-500" : "bg-slate-500"}`}
                                      style={{ width: `${Math.min(handlePct, 100)}%` }}
                                    />
                                  </div>
                                  <span className={isAlert ? "text-amber-400" : "text-[var(--muted)]"}>
                                    {handlePct}%
                                  </span>
                                </div>
                              ) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs text-[var(--muted)]">
                              {row.has_bets ? usd(row.total_staked) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs text-[var(--muted)]">
                              {row.has_bets ? usd(row.payout_if_win) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {summary.total_handle > 0
                                ? <PLBadge value={row.net_pl_if_win} />
                                : <span className="text-slate-600 text-xs">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {summary.total_handle > 0 && (
                      <tfoot>
                        <tr className="border-t border-[var(--border)] bg-[var(--surface-raised)]">
                          <td colSpan={4} className="px-3 py-2.5 text-xs text-[var(--muted)]">Totals</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-white tabular-nums">{usd(summary.total_handle)}</td>
                          <td className="px-3 py-2.5 text-right text-xs text-[var(--muted)]"></td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-[10px] text-[var(--muted)]">
                              {usd(summary.worst_case_pl)} to {usd(summary.best_case_pl)}
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </section>

            {/* Bet ledger */}
            {bets.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-white mb-3">
                  Bet Ledger
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">{bets.length} bets</span>
                </h2>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                        {["#", "Bettor", "Driver", "Odds", "Stake", "To Win", "Status", ""].map((h) => (
                          <th key={h} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${["Bettor", "Driver"].includes(h) ? "text-left" : "text-right"}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bets.map((bet) => (
                        <tr key={bet.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                          <td className="px-3 py-2 text-right tabular-nums text-xs text-[var(--muted)]">{bet.id}</td>
                          <td className="px-3 py-2 text-xs text-[var(--muted)]">{bet.bettor_name ?? "—"}</td>
                          <td className="px-3 py-2 text-xs font-medium text-white">{bet.driver_name}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-xs text-[var(--muted)]">{bet.american_odds}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-xs text-white">{usd(bet.amount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-xs text-green-400">{usd(bet.payout_if_win - bet.amount)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`text-[10px] font-semibold uppercase ${
                              bet.status === "won" ? "text-green-400" :
                              bet.status === "lost" ? "text-slate-500" :
                              bet.status === "void" ? "text-amber-400" :
                              "text-blue-400"
                            }`}>
                              {bet.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {bet.status === "open" && <VoidBetButton betId={bet.id} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-5">
            {!isComplete && oddsEntries.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-white mb-4">Place Bet</h3>
                <PlaceBetForm raceId={raceId} oddsEntries={oddsEntries} />
              </div>
            )}

            {/* Book health */}
            {bets.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
                <h3 className="font-semibold text-white">Book Health</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted)]">Theoretical hold</span>
                    <span className="text-white font-semibold">{pct(theoreticalHold)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted)]">Expected P&L</span>
                    <PLBadge value={expectedPL} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted)]">Expected hold</span>
                    <span className={`font-semibold ${expectedHold >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {pct(expectedHold)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted)]">Max drawdown</span>
                    <span className={`font-semibold tabular-nums ${summary.worst_case_pl < 0 ? "text-red-400" : "text-green-400"}`}>
                      {usd(summary.worst_case_pl)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted)]">P&L range</span>
                    <span className="text-xs text-[var(--muted)] tabular-nums">
                      {usd(summary.worst_case_pl)} / {usd(summary.best_case_pl)}
                    </span>
                  </div>
                </div>

                {overexposedRows.map((row) => (
                  <div key={row.driver_id} className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-xs text-amber-300 space-y-1">
                    <p>
                      <span className="font-semibold">{row.driver_name}</span>
                      {" "}holds {Math.round(row.handle_pct * 100)}% of handle
                      {row.trueProb > 0 && ` vs ${Math.round(row.trueProb * 100)}% model probability`}.
                    </p>
                    {row.suggestedOdds && (
                      <p className="text-amber-200 font-medium">
                        Suggested line move: {row.american_odds} → {row.suggestedOdds}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Risk limits */}
            {!isComplete && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-white mb-4">Risk Limits</h3>
                <div className="mb-4 text-xs text-[var(--muted)] space-y-1">
                  {limits.max_payout_per_driver !== null && (
                    <p>Max payout / driver: <span className="text-white">{usd(limits.max_payout_per_driver)}</span></p>
                  )}
                  {limits.max_bet_size !== null && (
                    <p>Max bet size: <span className="text-white">{usd(limits.max_bet_size)}</span></p>
                  )}
                  <p>Alert threshold: <span className="text-white">{Math.round(limits.alert_handle_pct * 100)}% handle</span></p>
                </div>
                <RiskLimitsForm raceId={raceId} limits={limits} />
              </div>
            )}

            {isComplete && bets.length > 0 && (
              <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-5">
                <h3 className="font-semibold text-green-400 mb-3">Settlement Complete</h3>
                <p className="text-sm text-[var(--muted)]">
                  Bets were automatically settled when results were recorded.
                </p>
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--muted)]">Won</span>
                    <span className="text-green-400">{bets.filter((b) => b.status === "won").length} bets</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--muted)]">Lost</span>
                    <span className="text-[var(--muted)]">{bets.filter((b) => b.status === "lost").length} bets</span>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
