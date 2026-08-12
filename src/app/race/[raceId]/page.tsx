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
  if (status === "unconfirmed") return "border-[var(--steel)]/35 bg-[var(--steel)]/10 text-[var(--steel)]";
  return "border-white/25 bg-white/5 text-[var(--muted-strong)]";
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
    <div className="min-h-screen">
      <BettorNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">

        <section className="panel-raised overflow-hidden">
          <div className="grid lg:grid-cols-[1fr_360px]">
            <div className="p-6 sm:p-7">
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <Link href={lobbyHref} className="transition-colors hover:text-white">← Lobby</Link>
                <span>/</span>
                <span className="text-[var(--muted-strong)]">Race board</span>
              </div>
              <h1 style={{ fontFamily: "var(--font-display)" }} className="mt-3 text-pretty text-3xl font-extrabold leading-[1.05] text-white sm:text-4xl">{race.name}</h1>
              <p className="mt-2 text-sm text-[var(--muted-strong)]">
                {race.track_name} · {fmt.format(new Date(race.race_date + "T12:00:00"))} · {race.track_condition}
              </p>
            </div>
            <div className="grid grid-cols-2 border-t border-[var(--border)] lg:border-l lg:border-t-0">
              {[
                { label: "Active field", value: activeEntries.length.toString(), detail: `${scratchedEntries.length} scratched` },
                { label: "Entry watch", value: watchEntries.length.toString(), detail: "unconfirmed" },
                { label: "Markets", value: markets.length.toString(), detail: "priced props" },
                { label: "Board", value: isBettingClosed ? "Closed" : "Open", detail: "straight tickets" },
              ].map((stat, i) => (
                <div key={stat.label} className={`px-5 py-4 ${i % 2 === 0 ? "border-r border-[var(--border)]" : ""} ${i < 2 ? "border-b border-[var(--border)]" : ""}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{stat.label}</p>
                  <p style={{ fontFamily: "var(--font-display)" }} className="mt-1.5 text-2xl font-extrabold tabular-nums text-white">{stat.value}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{stat.detail}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-raised)] px-5 py-3">
            <p className="text-xs text-[var(--muted)]">Markets update from the current field, risk corridor, and race status.</p>
            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${
            isSettled
              ? "border-[var(--racing-green)]/40 bg-[var(--racing-green)]/10 text-[var(--racing-green)]"
              : isBettingClosed
              ? "border-[var(--racing-red)]/40 bg-[var(--racing-red)]/10 text-[var(--racing-red)]"
              : "border-[var(--info)]/40 bg-[var(--info)]/10 text-[var(--info)]"
          }`}>
            {!isBettingClosed && <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--info)]" />}
            {isBettingClosed ? closedLabel : "Open"}
          </span>
          </div>
        </section>

        {isSettled && (
          <div className="rounded-lg border border-[var(--racing-green)]/30 bg-[var(--racing-green)]/[0.07] px-5 py-4 text-sm text-[var(--racing-green)]">
            This race has been settled — bets have been graded. Results are final.
          </div>
        )}

        {!isSettled && isBettingClosed && (
          <div className="rounded-lg border border-[var(--racing-red)]/30 bg-[var(--racing-red)]/[0.07] px-5 py-4 text-sm text-[var(--racing-red)]">
            Betting is closed for this race. Open bets will grade when final results are posted.
          </div>
        )}

        {entries.length > 0 && (
          <section className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="panel overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                  <div>
                    <h2 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold text-white">Market Preview</h2>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">Public prices currently passing risk checks.</p>
                  </div>
                </div>
                <div className="grid divide-y divide-[var(--border)] sm:grid-cols-2 sm:divide-y-0">
                  {boardPreview.map((market, index) => (
                    <div key={`${market.type}-${market.driver_id}-${market.driver_b_id}-${index}`} className={`px-4 py-3 ${index % 2 === 0 ? "sm:border-r sm:border-[var(--border)]" : ""} ${index < boardPreview.length - 2 ? "sm:border-b sm:border-[var(--border)]" : ""}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--info)]">{market.section}</p>
                          <p className="mt-1 truncate text-sm font-semibold text-white">{market.description}</p>
                        </div>
                        <span className={`text-sm font-bold tabular-nums ${parseInt(market.american_odds, 10) > 0 ? "text-[var(--racing-green)]" : "text-[var(--accent)]"}`}>
                          {market.american_odds}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="panel overflow-hidden">
                  <div className="border-b border-[var(--border)] px-4 py-3">
                    <h2 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold text-white">Field Intelligence</h2>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">Confirmed, expected, and watched entries.</p>
                  </div>
                  <div className="max-h-[330px] divide-y divide-[var(--border)] overflow-auto">
                    {entries.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-semibold ${entry.entry_status === "scratched" ? "text-[var(--muted)] line-through" : "text-white"}`}>
                            {entry.driver_name}
                          </p>
                          <p className="truncate text-[10px] text-[var(--muted)]">
                            {entry.entry_series ?? "series open"}{entry.starting_position ? ` · starts ${entry.starting_position}` : ""}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${statusClass(entry.entry_status)}`}>
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
          <div className="panel px-6 py-16 text-center">
            <p className="text-sm text-[var(--muted-strong)]">No drivers entered yet. Markets will appear once the field is ready.</p>
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
