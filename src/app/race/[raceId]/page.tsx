import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BettorNav } from "@/components/bettor-nav";
import { getRace, getRaceEntries, type RaceEntry } from "@/lib/races";
import { getOrCreateAccount, getPlayerRaceBets, generateProps, type PropMarket } from "@/lib/player-bets";
import { PlayerBettingBoard } from "@/components/player-betting-board";
import { getMarketRiskCorridors } from "@/lib/underwriting";

const fmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

function statusClass(status: RaceEntry["entry_status"]) {
  if (status === "confirmed") return "border-green-400/35 bg-green-500/10 text-green-300";
  if (status === "scratched") return "border-red-400/35 bg-red-500/10 text-red-300";
  if (status === "unconfirmed") return "border-amber-400/35 bg-amber-500/10 text-amber-300";
  return "border-sky-400/35 bg-sky-500/10 text-sky-300";
}

function marketPriority(type: PropMarket["type"]) {
  if (type === "win") return 0;
  if (type === "top3") return 1;
  if (type === "h2h") return 2;
  if (type === "laps_led") return 3;
  if (type === "dnf") return 4;
  return 5;
}

export default async function BetRacePage({
  params,
  searchParams,
}: {
  params: Promise<{ raceId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  await connection();
  const { raceId: raceIdStr } = await params;
  const { name } = await searchParams;

  const raceId = parseInt(raceIdStr, 10);
  if (isNaN(raceId)) notFound();

  const race = getRace(raceId);
  if (!race) notFound();

  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const account = name ? plain(await getOrCreateAccount(name)) : null;
  const existingBets = account ? plain(await getPlayerRaceBets(account.id, raceId)) : [];
  const markets = plain(generateProps(raceId, race.track_id).map((market) => ({
    ...market,
    metric_series: null,
    implied_probability: 0,
  })));
  const riskCorridors = plain(await getMarketRiskCorridors(raceId, markets));
  const entries = plain(getRaceEntries(raceId));
  const activeEntries = entries.filter((entry) => entry.entry_status !== "scratched");
  const scratchedEntries = entries.filter((entry) => entry.entry_status === "scratched");
  const watchEntries = entries.filter((entry) => entry.entry_status === "unconfirmed");
  const sortedMarkets = [...markets]
    .filter((market) => market.type !== "top5")
    .sort((a, b) => {
      const priority = marketPriority(a.type) - marketPriority(b.type);
      if (priority !== 0) return priority;
      const aOdds = Number.parseInt(a.american_odds, 10);
      const bOdds = Number.parseInt(b.american_odds, 10);
      return (Number.isFinite(aOdds) ? aOdds : 9999) - (Number.isFinite(bOdds) ? bOdds : 9999);
    });
  const boardPreview = sortedMarkets.slice(0, 8);

  const isSettled = race.status === "complete";
  const isBettingClosed = isSettled || !!race.is_live || (race.betting_status ?? "open") !== "open";
  const closedLabel = isSettled ? "Settled" : "Betting Closed";
  const lobbyHref = account
    ? `/?name=${encodeURIComponent(account.name)}`
    : "/";

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <BettorNav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-10 space-y-6">

        <section className="panel-raised overflow-hidden">
          <div className="grid gap-px bg-[var(--border)] lg:grid-cols-[1fr_360px]">
            <div className="bg-[var(--surface)] p-5 sm:p-6">
            <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
              <Link href={lobbyHref} className="hover:text-white transition-colors">← Lobby</Link>
              <span>/</span>
              <span className="text-white">Race board</span>
            </div>
            <h1 style={{ fontFamily: "var(--font-display)" }} className="mt-3 text-4xl font-black uppercase leading-none text-white">{race.name}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {race.track_name} · {fmt.format(new Date(race.race_date + "T12:00:00"))} · {race.track_condition}
            </p>
            </div>
            <div className="grid grid-cols-2 bg-[var(--surface)]">
              {[
                { label: "Active field", value: activeEntries.length.toString(), detail: `${scratchedEntries.length} scratched` },
                { label: "Entry watch", value: watchEntries.length.toString(), detail: "unconfirmed" },
                { label: "Markets", value: markets.length.toString(), detail: "priced props" },
                { label: "Board", value: isBettingClosed ? "Closed" : "Open", detail: "straight tickets" },
              ].map((stat) => (
                <div key={stat.label} className="border-l border-b border-[var(--border)] px-4 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{stat.label}</p>
                  <p className="mt-2 text-2xl font-black text-white">{stat.value}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{stat.detail}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-raised)] px-5 py-3">
            <p className="text-xs text-[var(--muted)]">Markets update from the current field, risk corridor, and race status.</p>
            <span className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest shrink-0 border ${
            isSettled
              ? "border-[var(--racing-green)]/40 bg-[var(--racing-green)]/10 text-[var(--racing-green)]"
              : isBettingClosed
              ? "border-[var(--racing-red)]/40 bg-[var(--racing-red)]/10 text-[var(--racing-red)]"
              : "border-sky-400/40 bg-sky-400/10 text-sky-300"
          }`}>
            {isBettingClosed ? closedLabel : "Open"}
          </span>
          </div>
        </section>

        {isSettled && (
          <div className="border border-[var(--racing-green)]/30 bg-[var(--racing-green)]/5 px-5 py-4 text-sm text-[var(--racing-green)]">
            This race has been settled — bets have been graded. Results are final.
          </div>
        )}

        {!isSettled && isBettingClosed && (
          <div className="border border-[var(--racing-red)]/30 bg-[var(--racing-red)]/5 px-5 py-4 text-sm text-[var(--racing-red)]">
            Betting is closed for this race. Open bets will grade when final results are posted.
          </div>
        )}

        {entries.length > 0 && (
          <section className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                  <div>
                    <h2 className="text-sm font-bold text-white">Market Preview</h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">Public prices currently passing risk checks.</p>
                  </div>
                </div>
                <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
                  {boardPreview.map((market, index) => (
                    <div key={`${market.type}-${market.driver_id}-${market.driver_b_id}-${index}`} className="bg-[var(--surface)] px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-300">{market.section}</p>
                          <p className="mt-1 truncate text-sm font-semibold text-white">{market.description}</p>
                        </div>
                        <span className={`font-mono text-sm font-black ${parseInt(market.american_odds, 10) > 0 ? "text-green-300" : "text-[var(--accent)]"}`}>
                          {market.american_odds}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="border border-[var(--border)] bg-[var(--surface)]">
                  <div className="border-b border-[var(--border)] px-4 py-3">
                    <h2 className="text-sm font-bold text-white">Field Intelligence</h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">Confirmed, expected, and watched entries.</p>
                  </div>
                  <div className="max-h-[330px] overflow-auto divide-y divide-[var(--border)]">
                    {entries.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-semibold ${entry.entry_status === "scratched" ? "text-slate-500 line-through" : "text-white"}`}>
                            {entry.driver_name}
                          </p>
                          <p className="truncate text-[10px] text-[var(--muted)]">
                            {entry.entry_series ?? "series open"}{entry.starting_position ? ` · starts ${entry.starting_position}` : ""}
                          </p>
                        </div>
                        <span className={`shrink-0 border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${statusClass(entry.entry_status)}`}>
                          {entry.entry_status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {markets.length === 0 ? (
          <div className="border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
            <p className="text-sm text-[var(--muted)]">No drivers entered yet. Markets will appear once the field is ready.</p>
            <Link href={`/admin/races/${raceId}`} className="mt-3 inline-block text-xs text-[var(--accent)] hover:underline">
              Go to race page to add drivers →
            </Link>
          </div>
        ) : (
          <PlayerBettingBoard
            raceId={raceId}
            raceName={race.name}
            account={account}
            markets={markets}
            riskCorridors={riskCorridors}
            existingBets={existingBets}
            isSettled={isSettled}
            isBettingClosed={isBettingClosed}
            bettingClosedLabel={closedLabel}
          />
        )}
      </main>
    </div>
  );
}
