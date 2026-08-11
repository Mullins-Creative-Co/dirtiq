import { connection } from "next/server";
import Link from "next/link";
import { BettorNav } from "@/components/bettor-nav";
import { getOrCreateAccount, getAccountBets, generateProps, type PropType } from "@/lib/player-bets";
import { AccountPickerForm } from "@/components/account-picker-form";
import { RememberAccountRedirect } from "@/components/remember-account-redirect";
import { BetLobbyBoard } from "@/components/bet-lobby-board";
import { todayDateString, type Race } from "@/lib/races";
import { getDb } from "@/lib/db";
import { getMarketRiskCorridors } from "@/lib/underwriting";
import { buildPredictionCard } from "@/lib/prediction-card";
import { priceOutrightWinnerLines } from "@/lib/book-pricing";
import { getOutrightExposureMap } from "@/lib/market-lines";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

type LobbyLine = {
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
  rationale: string | null;
  entry_status: string | null;
  max_stake?: number;
  corridor_status?: "open" | "limited" | "closed";
  corridor_message?: string | null;
};

function impliedFromAmericanOdds(odds: string) {
  const n = Number.parseInt(odds, 10);
  if (!Number.isFinite(n)) return 0;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function cappedAmericanOdds(odds: string, maxPositive = 450, minNegative = -260) {
  const n = Number.parseInt(odds, 10);
  if (!Number.isFinite(n)) return odds;
  if (n > 0) return `+${Math.min(n, maxPositive)}`;
  return Math.max(n, minNegative).toString();
}

function endOfCurrentWeekDateString() {
  const [year, month, day] = todayDateString().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const daysUntilSunday = (7 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + daysUntilSunday);
  return date.toISOString().slice(0, 10);
}

function seriesKey(race: Pick<Race, "series_mode" | "division">) {
  return (race.series_mode || race.division || "Late Models").trim();
}

function listThisWeeksNextSeriesRaces(): Race[] {
  const races = getDb()
    .prepare(
      `SELECT r.*, t.name AS track_name
       FROM races r
       JOIN tracks t ON t.id = r.track_id
       WHERE r.status = 'upcoming'
         AND r.race_date >= ?
         AND r.race_date <= ?
         AND r.is_live = 0
         AND COALESCE(r.betting_status, 'open') = 'open'
         AND (
           lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%lucas oil lmds%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%lucas oil late model%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%woo late models%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%world of outlaws%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%dirtcar summer nationals%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%hell tour%'
           OR lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) LIKE '%helltour%'
         )
         AND lower(COALESCE(r.division, '') || ' ' || COALESCE(r.series_mode, '') || ' ' || r.name) NOT LIKE '%sprint%'
       ORDER BY r.race_date ASC, r.id ASC`
    )
    .all(todayDateString(), endOfCurrentWeekDateString()) as Race[];

  const bySeries = new Map<string, Race>();
  for (const race of races) {
    const key = seriesKey(race).toLowerCase();
    if (!bySeries.has(key)) bySeries.set(key, race);
  }

  return [...bySeries.values()];
}

function generatedLobbyLines(races: Race[], limitPerRace = 8): LobbyLine[] {
  return races
    .flatMap((race) => {
      const card = buildPredictionCard(race.id);
      if (!card) return [];
      const rowsByDriver = new Map(card.rows.map((row) => [row.driverId, row]));
      return priceOutrightWinnerLines(card, getOutrightExposureMap(race.id))
        .slice(0, limitPerRace)
        .flatMap((price) => {
          const row = rowsByDriver.get(price.driverId);
          if (!row) return [];
          return [{
            race_id: race.id,
            race_name: race.name,
            race_date: race.race_date,
            division: race.division,
            track_name: race.track_name,
            prop_type: "win",
            section: "Winner",
            description: `${row.driverName} to Win`,
            driver_id: row.driverId,
            driver_name: row.driverName,
            driver_b_id: null,
            driver_b_name: null,
            market_odds: price.americanOdds,
            rationale: price.rationale,
            entry_status: row.entryStatus,
          }];
        });
    });
}

function generatedLobbyProps(races: Race[], limitPerRace = 16): LobbyLine[] {
  const wantedTypes = new Set<PropType>(["top3", "h2h", "laps_led", "dnf"]);

  return races.flatMap((race) => {
    const card = buildPredictionCard(race.id);
    if (!card) return [];
    const rowsByDriver = new Map(card.rows.map((row) => [row.driverId, row]));
    const markets = generateProps(race.id, race.track_id)
      .filter((market) => wantedTypes.has(market.type))
      .filter((market) => market.driver_id !== null)
      .filter((market) => {
        const primary = market.driver_id ? rowsByDriver.get(market.driver_id) : null;
        const secondary = market.driver_b_id ? rowsByDriver.get(market.driver_b_id) : null;
        return primary?.entryStatus !== "scratched" && secondary?.entryStatus !== "scratched";
      });

    const scored = markets.map((market) => {
      const primary = market.driver_id ? rowsByDriver.get(market.driver_id) : null;
      const secondary = market.driver_b_id ? rowsByDriver.get(market.driver_b_id) : null;
      const rankScore = primary ? Math.max(0, 20 - primary.rank) : 0;
      const pairScore = secondary ? Math.max(0, 12 - secondary.rank) : 0;
      const typeBoost = market.type === "top3" ? 12 : market.type === "h2h" ? 9 : market.type === "laps_led" ? 5 : 2;
      return { market, score: rankScore + pairScore + typeBoost };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limitPerRace)
      .map(({ market }) => {
        const row = market.driver_id ? rowsByDriver.get(market.driver_id) : null;
        return {
          race_id: race.id,
          race_name: race.name,
          race_date: race.race_date,
          division: race.division,
          track_name: race.track_name,
          prop_type: market.type,
          section: market.section,
          description: market.description,
          driver_id: market.driver_id ?? 0,
          driver_name: market.driver_name ?? market.description,
          driver_b_id: market.driver_b_id,
          driver_b_name: market.driver_b_name,
          market_odds: cappedAmericanOdds(market.american_odds, market.type === "dnf" ? 300 : 450),
          rationale: row
            ? `${market.section}; ${row.confidence.toLowerCase()} confidence; ${row.reasons[0] ?? "field-relative model signal"}`
            : market.section,
          entry_status: row?.entryStatus ?? "expected",
        };
      });
  });
}

async function attachRiskCorridors(lines: LobbyLine[]): Promise<LobbyLine[]> {
  const linesByRace = lines.reduce<Record<number, LobbyLine[]>>((groups, line) => {
    groups[line.race_id] = [...(groups[line.race_id] ?? []), line];
    return groups;
  }, {});
  const corridorEntries = await Promise.all(
    Object.entries(linesByRace).map(async ([raceId, raceLines]) => {
      const corridors = await getMarketRiskCorridors(
        Number(raceId),
        raceLines.map((line) => ({
          type: line.prop_type,
          section: line.section,
          description: line.description,
          metric_series: line.division,
          driver_id: line.driver_id,
          driver_b_id: line.driver_b_id,
          driver_name: line.driver_name,
          driver_b_name: line.driver_b_name,
          american_odds: line.market_odds,
          implied_probability: impliedFromAmericanOdds(line.market_odds),
        }))
      );
      return [Number(raceId), corridors] as const;
    })
  );
  const corridorsByRace = new Map(corridorEntries);

  return lines.map((line) => {
    const key = [line.prop_type, line.driver_id, line.driver_b_id ?? "none", line.description, line.market_odds].join("|");
    const corridor = corridorsByRace.get(line.race_id)?.[key];
    return {
      ...line,
      max_stake: corridor?.maxStake,
      corridor_status: corridor?.status,
      corridor_message: corridor?.message,
    };
  });
}

function simulatePublicBook(lines: LobbyLine[]) {
  const usable = lines.filter((line) => line.corridor_status !== "closed");
  const weights = usable.map((line) => {
    const implied = impliedFromAmericanOdds(line.market_odds);
    const star =
      /pierce|overton|thornton|davenport|madden|moran|sheppard|marlar/i.test(line.description) ? 1.45 : 1;
    const type =
      line.prop_type === "win" ? 1.25 : line.prop_type === "top3" ? 1.15 : line.prop_type === "h2h" ? 0.9 : 0.65;
    return Math.max(0.15, Math.pow(implied, 0.72) * star * type);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const targetHandle = Math.min(1200, Math.max(250, usable.length * 18));

  const exposures = usable.map((line, index) => {
    const uncappedStake = (targetHandle * weights[index]) / totalWeight;
    const maxStake = line.max_stake ?? 50;
    const stake = Math.min(60, Math.max(4, uncappedStake), maxStake);
    const payout = stake + toWin(stake, line.market_odds);
    return {
      line,
      stake,
      payout,
      bookPlIfHits: 0,
    };
  });
  const totalHandle = exposures.reduce((sum, exposure) => sum + exposure.stake, 0);
  const withPl = exposures.map((exposure) => ({
    ...exposure,
    bookPlIfHits: totalHandle - exposure.payout,
  }));
  const worst = withPl.sort((a, b) => a.bookPlIfHits - b.bookPlIfHits)[0] ?? null;
  return {
    totalHandle,
    worstCasePl: worst?.bookPlIfHits ?? 0,
    worstSelection: worst?.line.description ?? "No exposure",
    lines: withPl.sort((a, b) => b.stake - a.stake).slice(0, 8),
  };
}

function toWin(stake: number, odds: string) {
  const n = Number.parseInt(odds, 10);
  if (!Number.isFinite(n) || stake <= 0) return 0;
  return n > 0 ? (stake * n) / 100 : (stake * 100) / Math.abs(n);
}

export default async function BetLobbyPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; switch?: string }>;
}) {
  await connection();
  const { name, switch: switchAccount } = await searchParams;
  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const account = name ? plain(await getOrCreateAccount(name)) : null;
  const allBets = account ? plain(await getAccountBets(account.id)) : [];

  const wonBets = allBets.filter((b) => b.status === "won");
  const lostBets = allBets.filter((b) => b.status === "lost");
  const openBets = allBets.filter((b) => b.status === "open");
  const totalWagered = allBets.reduce((s, b) => s + b.stake, 0);
  const totalReturned = wonBets.reduce((s, b) => s + b.payout_if_win, 0);
  const netPL = totalReturned - totalWagered;

  const featuredRaces = listThisWeeksNextSeriesRaces();
  const lobbyLines = plain(await attachRiskCorridors([
    ...generatedLobbyLines(featuredRaces),
    ...generatedLobbyProps(featuredRaces),
  ]));
  const nextRaceDate = featuredRaces[0]?.race_date
    ? shortDate.format(new Date(`${featuredRaces[0].race_date}T12:00:00`))
    : "No board";
  const raceCountLabel = `${featuredRaces.length} board${featuredRaces.length === 1 ? "" : "s"}`;
  const lineCountsByRace = lobbyLines.reduce<Record<number, number>>((counts, line) => {
    counts[line.race_id] = (counts[line.race_id] ?? 0) + 1;
    return counts;
  }, {});
  const topLobbyLines = Object.values(
    lobbyLines.reduce<Record<number, LobbyLine[]>>((groups, line) => {
      groups[line.race_id] = [...(groups[line.race_id] ?? []), line];
      return groups;
    }, {})
  )
    .flatMap((lines) =>
      lines
        .sort((a, b) => impliedFromAmericanOdds(b.market_odds) - impliedFromAmericanOdds(a.market_odds))
        .slice(0, 8)
    )
    .slice(0, 32);
  const publicBookSim = simulatePublicBook(topLobbyLines);

  return (
    <div className="min-h-screen text-[var(--foreground)]">
      <RememberAccountRedirect enabled={!name && !switchAccount} />
      <BettorNav />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 space-y-8 py-6 sm:py-8">

        <section className="panel-raised overflow-hidden">
          <div className="grid lg:grid-cols-[1.4fr_0.6fr]">
            <div className="relative p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                  2026 Public Board
                </span>
                <span className="rounded-full border border-[var(--steel)]/30 bg-[var(--steel)]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--steel)]">
                  Play Money
                </span>
              </div>
              <h1
                style={{ fontFamily: "var(--font-display)" }}
                className="mt-5 max-w-3xl text-pretty text-4xl font-extrabold leading-[1.02] text-white sm:text-5xl"
              >
                Model-priced lines for the next{" "}
                <span className="text-[var(--accent)]">late model</span> boards.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--muted-strong)]">
                Live, risk-checked odds on dirt late model features. Build a slip, track your wallet,
                and see if you can beat the book.
              </p>
            </div>
            <div className="grid grid-cols-3 border-t border-[var(--border)] lg:grid-cols-1 lg:border-l lg:border-t-0">
              {[
                { label: "Next race", value: nextRaceDate, detail: featuredRaces[0]?.track_name ?? "Awaiting schedule" },
                { label: "Open boards", value: raceCountLabel, detail: "late model slate" },
                { label: "Protected lines", value: topLobbyLines.length.toString(), detail: "risk checked" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="border-r border-[var(--border)] px-5 py-4 last:border-r-0 lg:border-r-0 lg:border-b lg:last:border-b-0"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{item.label}</p>
                  <p
                    style={{ fontFamily: "var(--font-display)" }}
                    className="mt-1.5 text-2xl font-extrabold tabular-nums text-white"
                  >
                    {item.value}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-stretch justify-between gap-4">
          {account ? (
            <div className="panel-raised flex min-w-[15rem] items-center gap-4 px-5 py-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/12 text-base font-black uppercase text-[var(--accent)]">
                {account.name.slice(0, 2)}
              </span>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  {account.name}
                </div>
                <div
                  style={{ fontFamily: "var(--font-display)" }}
                  className="mt-0.5 text-3xl font-extrabold tabular-nums text-[var(--accent)]"
                >
                  {usd(account.balance)}
                </div>
                <Link href="/bet?switch=1" className="mt-0.5 inline-block text-[10px] text-[var(--muted)] transition-colors hover:text-white">
                  Switch account →
                </Link>
              </div>
            </div>
          ) : (
            <div className="panel-raised max-w-sm p-6">
              <h2
                style={{ fontFamily: "var(--font-display)" }}
                className="text-xl font-extrabold text-white"
              >
                Open a play-money wallet
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-strong)]">
                Returning players keep their balance. New wallets start with $1,000.
              </p>
              <div className="mt-4">
                <AccountPickerForm />
              </div>
            </div>
          )}

          {account && allBets.length > 0 && (
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Net P&L", value: usd(netPL), tone: netPL >= 0 ? "text-[var(--racing-green)]" : "text-[var(--racing-red)]" },
                { label: "Total Bets", value: allBets.length.toString(), tone: "text-white" },
                { label: "W / L", value: `${wonBets.length} / ${lostBets.length}`, tone: "text-white" },
                { label: "Open", value: openBets.length.toString(), tone: "text-[var(--info)]" },
              ].map((stat) => (
                <div key={stat.label} className="panel flex flex-col justify-center px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    {stat.label}
                  </p>
                  <p
                    style={{ fontFamily: "var(--font-display)" }}
                    className={`mt-1 text-2xl font-extrabold tabular-nums ${stat.tone}`}
                  >
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {topLobbyLines.length > 0 && (
          <>
            <BetLobbyBoard account={account} lines={topLobbyLines.filter((line) => line.driver_id > 0)} />

            <section className="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
              <div className="panel p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Public Simulation</p>
                <p style={{ fontFamily: "var(--font-display)" }} className="mt-2 text-3xl font-extrabold tabular-nums text-white">{usd(publicBookSim.totalHandle)}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">Projected play-money handle from casual public betting.</p>
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Worst case P&L</p>
                  <p style={{ fontFamily: "var(--font-display)" }} className={`mt-2 text-2xl font-extrabold tabular-nums ${publicBookSim.worstCasePl >= 0 ? "text-[var(--racing-green)]" : "text-[var(--racing-red)]"}`}>
                    {usd(publicBookSim.worstCasePl)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{publicBookSim.worstSelection}</p>
                </div>
              </div>
              <div className="panel overflow-hidden">
                <div className="border-b border-[var(--border)] px-5 py-4">
                  <h2 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold text-white">Likely Public Bets</h2>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {publicBookSim.lines.map((exposure) => (
                    <div key={`${exposure.line.race_id}-${exposure.line.prop_type}-${exposure.line.description}`} className="grid items-center gap-3 px-5 py-3 sm:grid-cols-[1fr_auto_auto]">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{exposure.line.description}</p>
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">{exposure.line.section} · {exposure.line.track_name}</p>
                      </div>
                      <p className="text-sm font-bold tabular-nums text-[var(--accent)]">{exposure.line.market_odds}</p>
                      <p className={`text-sm font-bold tabular-nums ${exposure.bookPlIfHits >= 0 ? "text-[var(--racing-green)]" : "text-[var(--racing-red)]"}`}>
                        {usd(exposure.bookPlIfHits)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {topLobbyLines.length === 0 && (
          <section className="panel-raised px-6 py-16 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">No public prices posted</p>
            <h2 style={{ fontFamily: "var(--font-display)" }} className="mx-auto mt-3 max-w-xl text-pretty text-2xl font-extrabold text-white">
              Boards appear when entries and model cards are ready.
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted-strong)]">
              The schedule is loaded, but the public book waits for field data and risk limits before accepting play-money tickets.
            </p>
          </section>
        )}

        {featuredRaces.length > 0 && (
          <section>
            <div className="mb-4 flex items-center gap-3">
              <span className="h-4 w-1 rounded-full bg-[var(--accent)]" />
              <h2 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold uppercase tracking-[0.16em] text-white">
                Current 2026 Boards
              </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {featuredRaces.map((race) => {
                const bettingOpen = (race.betting_status ?? "open") === "open";
                const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
                const dateStr = fmt.format(new Date(race.race_date + "T12:00:00"));
                return (
                  <Link
                    key={race.id}
                    href={account ? `/race/${race.id}?name=${encodeURIComponent(account.name)}` : `/race/${race.id}`}
                    className="panel group block p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--accent)]/50 hover:shadow-[var(--shadow-md)]"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted-strong)]">{dateStr}</p>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        race.is_live
                          ? "border-[var(--info)]/40 bg-[var(--info)]/10 text-[var(--info)]"
                          : bettingOpen
                          ? "border-[var(--racing-green)]/40 bg-[var(--racing-green)]/10 text-[var(--racing-green)]"
                          : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]"
                      }`}>
                        {race.is_live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--info)]" />}
                        {race.is_live ? "Live" : bettingOpen ? "Open" : "Closed"}
                      </span>
                    </div>
                    <h3
                      style={{ fontFamily: "var(--font-display)" }}
                      className="text-base font-bold leading-tight text-white transition-colors group-hover:text-[var(--accent)]"
                    >
                      {race.name}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">{race.track_name}</p>
                    {race.division && (
                      <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]/70">{race.division}</p>
                    )}
                    <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--border)] pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-strong)]">
                      <span className="text-[var(--accent)]">{lineCountsByRace[race.id] ?? 0}</span>
                      protected line{(lineCountsByRace[race.id] ?? 0) === 1 ? "" : "s"}
                      <span className="ml-auto text-[var(--muted)] transition-transform group-hover:translate-x-0.5">→</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Bet history ──────────────────────────────────────────────────── */}
        {account && allBets.length > 0 && (
          <section>
            <div className="mb-4 flex items-center gap-3">
              <span className="h-4 w-1 rounded-full bg-[var(--accent)]" />
              <h2 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-bold uppercase tracking-[0.16em] text-white">
                Wallet History
                <span className="ml-2 text-xs font-medium normal-case tracking-normal text-[var(--muted)]">· {allBets.length} bets</span>
              </h2>
            </div>
            <div className="panel overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Race", "Bet", "Odds", "Stake", "Return", "Status"].map((h) => (
                      <th
                        key={h}
                        className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)] ${["Race", "Bet"].includes(h) ? "text-left" : "text-right"}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allBets.slice(0, 20).map((bet) => (
                    <tr key={bet.id} className="border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--surface-raised)]">
                      <td className="px-3 py-2.5 text-xs text-[var(--muted)]">{bet.race_name}</td>
                      <td className="px-3 py-2.5 text-xs font-medium text-white">{bet.description}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[var(--muted-strong)]">{bet.american_odds}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-white">{usd(bet.stake)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                        {bet.status === "won" ? (
                          <span className="font-bold text-[var(--racing-green)]">+{usd(bet.payout_if_win - bet.stake)}</span>
                        ) : bet.status === "lost" ? (
                          <span className="text-[var(--racing-red)]">-{usd(bet.stake)}</span>
                        ) : bet.status === "void" ? (
                          <span className="text-[var(--muted)]">refund</span>
                        ) : (
                          <span className="text-[var(--muted)]">{usd(bet.payout_if_win)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          bet.status === "won"
                            ? "text-[var(--racing-green)]"
                            : bet.status === "lost"
                            ? "text-[var(--racing-red)]"
                            : bet.status === "void"
                            ? "text-[var(--muted)]"
                            : "text-[var(--info)]"
                        }`}>
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
      </main>
    </div>
  );
}
