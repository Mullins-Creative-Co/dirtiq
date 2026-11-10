import Link from "next/link";
import { connection } from "next/server";

import { Nav } from "@/components/nav";
import { Card, Chip, EmptyState, Kicker, PageHeader, ProbBar, Section, StatTile, type Tone } from "@/components/ui/primitives";
import { dateTime, fairAmerican, longDate, num, pct, relativeAge, shortDate, signed, spread, units } from "@/lib/format";
import { todayDateString } from "@/lib/races";
import {
  SPORT_LABELS, getModelHealth, getRacingDataSummary, getRacingReport, getRecentRaceResults, getUpcomingRaceBoards, listSportReports,
  type ModelHealthEntry, type SportReport, type SportUpcoming,
} from "@/lib/model-reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "dirtIQ | Multi-sport model desk", description: "Calibrated forecasts for dirt late-model racing and major team sports, scored against the market in one ledger." };

function healthFor(health: ReturnType<typeof getModelHealth>, sport: string, market: string): ModelHealthEntry | null {
  return health?.models.find((m) => m.sport === sport && m.market === market) ?? null;
}

function GameRow({ game, sport }: { game: SportUpcoming; sport: string }) {
  const lean = game.lean === "home" ? game.home : game.lean === "away" ? game.away : null;
  const edge = game.edgePts ?? null;
  const tone: Tone = edge === null ? "neutral" : Math.abs(edge) >= 3 ? "accent" : Math.abs(edge) >= 1.5 ? "warn" : "neutral";
  return (
    <tr>
      <td>
        <Link href={`/sports/${sport}`} className="strong hover:text-[var(--accent-hi)]">{game.away} at {game.home}</Link>
        <div className="text-xs text-[var(--muted)]">{dateTime(game.startsAt)}</div>
      </td>
      <td className="num">{signed(game.projectedHomeMargin)}</td>
      <td className="num">{game.marketHomeSpread === null ? "—" : `${game.home} ${spread(game.marketHomeSpread)}`}</td>
      <td className="num">{pct(game.homeWinProb)}</td>
      <td className="num">{lean ? <Chip tone={tone} title="Model disagrees with the market by this many points toward this side">{lean} {edge !== null ? `${Math.abs(edge).toFixed(1)} pts` : ""}</Chip> : <span className="text-[var(--muted)]">no lean</span>}</td>
    </tr>
  );
}

function SportCard({ report, health }: { report: SportReport; health: ModelHealthEntry | null }) {
  const bt = report.backtest;
  const maeDelta = bt?.mae !== null && bt?.mae !== undefined && bt.marketMae !== null && bt.marketMae !== undefined ? bt.mae - bt.marketMae : null;
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Kicker>{report.label}</Kicker>
          <h3 className="mt-1 font-display text-xl font-black">{report.ratings.length ? `${report.ratings.length} teams rated` : "Ratings pending"}</h3>
        </div>
        <Chip tone={report.upcoming.length ? "accent" : "neutral"}>{report.upcoming.length} upcoming</Chip>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Backtest MAE</dt><dd className="tnum font-semibold">{num(bt?.mae ?? null, 2)} <span className="text-xs text-[var(--muted)]">vs market {num(bt?.marketMae ?? null, 2)}</span></dd></div>
        <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Gap to market</dt><dd className={`tnum font-semibold ${maeDelta !== null && maeDelta <= 0 ? "text-[var(--racing-green)]" : ""}`}>{maeDelta === null ? "—" : `${signed(maeDelta, 2)} pts`}</dd></div>
        <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Moneyline Brier</dt><dd className="tnum font-semibold">{num(bt?.brierMoneyline ?? null, 3)} <span className="text-xs text-[var(--muted)]">mkt {num(bt?.marketBrierMoneyline ?? null, 3)}</span></dd></div>
        <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Live ledger</dt><dd className="tnum font-semibold">{health ? `${health.settled} settled · ${units(health.units)}` : "no rows yet"}</dd></div>
      </dl>
      <div className="mt-auto flex items-center justify-between pt-4 text-xs text-[var(--muted)]">
        <span>Data through {report.dataThrough ?? "—"} · built {relativeAge(report.generatedAt)}</span>
        <Link href={`/sports/${report.sport}`} className="font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Open →</Link>
      </div>
    </Card>
  );
}

export default async function HomePage() {
  await connection();
  const health = getModelHealth();
  const racing = getRacingReport();
  const sports = listSportReports();
  const boards = getUpcomingRaceBoards(4, 5);
  const recent = getRecentRaceResults(5);
  const data = getRacingDataSummary();
  const today = todayDateString();

  const racingWin = healthFor(health, "racing", "win");
  const pooled = racing?.series.find((s) => s.slug === "pooled" || s.series.toLowerCase() === "pooled") ?? racing?.series[0] ?? null;
  const upcomingGames = sports.flatMap((s) => s.upcoming.map((g) => ({ sport: s.sport, game: g }))).sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt)).slice(0, 8);
  const openForecasts = health?.models.reduce((sum, m) => sum + m.open, 0) ?? 0;
  const settledForecasts = health?.models.reduce((sum, m) => sum + m.settled, 0) ?? 0;

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-12 px-4 py-8 sm:px-6">
        <PageHeader
          kicker="Model desk"
          title="Every sport, one ledger."
          lede={<>Calibrated probabilities for dirt late-model racing and major team sports. Each forecast is recorded with the market at that moment and graded when results land, so this page shows how good the model actually is, not how good a backtest says it is.</>}
          aside={
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatTile label="Open forecasts" value={openForecasts} detail="awaiting results" />
              <StatTile label="Graded" value={settledForecasts} detail="settled in ledger" />
              <StatTile label="Ledger updated" value={health ? relativeAge(health.generatedAt) : "—"} detail={health ? shortDate(health.generatedAt) : "not exported"} />
            </div>
          }
        />

        <Section kicker="Dirt racing" title="Next races" description="The pick-one-of-N model gives every entrant a probability that sums to one across the field. Top five shown; the full board, fair odds and props live on the race page." action={<Link href="/admin/today" className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Today board →</Link>}>
          {boards.length === 0 ? (
            <EmptyState title="No scored upcoming races" detail="Score the upcoming races with the racing engine and they will appear here with their probabilities." command="npm run racing:score" href="/admin/races" linkLabel="Manage races" />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {boards.map((board) => (
                <Card key={board.race.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-[var(--muted)]">{longDate(board.race.race_date)} · {board.race.track_name}</p>
                      <h3 className="mt-1 font-display text-lg font-black leading-tight"><Link href={`/admin/races/${board.race.id}/prediction`} className="hover:text-[var(--accent-hi)]">{board.race.name}</Link></h3>
                    </div>
                    <div className="flex gap-1.5">
                      {board.race.is_live ? <Chip tone="bad">Live</Chip> : null}
                      {board.race.race_date < today ? <Chip tone="warn" title="Race date has passed but results are not recorded">Date passed</Chip> : null}
                      <Chip tone={board.stage === "race-night" ? "accent" : "neutral"}>{board.stage === "race-night" ? "Race night" : "Early"}</Chip>
                    </div>
                  </div>
                  <ol className="mt-4 space-y-2">
                    {board.rows.map((row, index) => (
                      <li key={row.driverId} className="grid grid-cols-[1.5rem_1fr_auto_auto] items-center gap-3 text-sm">
                        <span className="tnum text-xs text-[var(--muted)]">{index + 1}</span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{row.driverName} {row.carNumber ? <span className="text-xs font-normal text-[var(--muted)]">#{row.carNumber}</span> : null}</div>
                          <ProbBar value={row.probability} max={Math.max(0.3, board.rows[0]?.probability ?? 0.3)} label={`${row.driverName} ${pct(row.probability)}`} />
                        </div>
                        <span className="tnum text-sm font-semibold">{pct(row.probability)}</span>
                        <span className="tnum w-12 text-right text-xs text-[var(--muted)]">{fairAmerican(row.probability)}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-4 text-xs text-[var(--muted)]">{board.scored} of {board.fieldSize} entrants scored · starts {board.readiness.starts}/{board.fieldSize} · qualifying {board.readiness.qualifying}/{board.fieldSize} · {board.modelSeries ?? board.race.division} model</p>
                </Card>
              ))}
            </div>
          )}
        </Section>

        <Section kicker="Team sports" title="Upcoming games" description="Independent rating-model projections next to the visible market. A lean is only shown when the projection and the market disagree by the sport's fixed threshold; it is a research signal, not a bet." action={<Link href="/sports" className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">All sports →</Link>}>
          {upcomingGames.length === 0 ? (
            <EmptyState title="No team-sport forecasts yet" detail="Run the team engine for a sport to pull the public schedule, update ratings, and record forecasts." command="npm run sports:forecast -- --sport nfl" href="/sports" linkLabel="Sports" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <caption className="sr-only">Upcoming games with projections</caption>
                <thead><tr><th>Game</th><th className="num">Proj. home margin</th><th className="num">Market</th><th className="num">Home win</th><th className="num">Lean</th></tr></thead>
                <tbody>{upcomingGames.map(({ sport, game }) => <GameRow key={`${sport}:${game.gameId}`} game={game} sport={sport} />)}</tbody>
              </table>
            </div>
          )}
        </Section>

        <Section kicker="Model health" title="How good is it, really?" description="Backtests are rolling-origin and never tune on the test season. The ledger columns are live, graded forecasts and are the only numbers that count as evidence." action={<Link href="/models" className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Full report →</Link>}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Kicker>{SPORT_LABELS.racing}</Kicker>
                  <h3 className="mt-1 font-display text-xl font-black">{racing ? `${racing.series.length} series models` : "Racing report pending"}</h3>
                </div>
                <Chip tone={racing ? "accent" : "neutral"}>{racing?.modelVersion ? `v${racing.modelVersion}` : "legacy"}</Chip>
              </div>
              {racing && pooled ? (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Winner log loss</dt><dd className="tnum font-semibold">{num(pooled.logLoss, 3)} <span className="text-xs text-[var(--muted)]">legacy {num(pooled.legacyLogLoss, 3)}</span></dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Top pick wins</dt><dd className="tnum font-semibold">{pct(pooled.top1)} <span className="text-xs text-[var(--muted)]">legacy {pct(pooled.legacyTop1)}</span></dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Calibration error</dt><dd className="tnum font-semibold">{pct(pooled.ece)}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Live ledger</dt><dd className="tnum font-semibold">{racingWin ? `${racingWin.settled} settled · Brier ${num(racingWin.brier, 3)}` : "no rows yet"}</dd></div>
                </dl>
              ) : (
                <p className="mt-4 text-sm text-[var(--muted)]">Run <code className="font-mono text-xs">npm run racing:backtest</code> to produce the rolling backtest and the comparison against the legacy method.</p>
              )}
              <div className="mt-4 flex items-center justify-between text-xs text-[var(--muted)]">
                <span>{data.races} races · {data.entries.toLocaleString()} entries · through {data.latest ?? "—"}</span>
                <Link href="/models#racing" className="font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Open →</Link>
              </div>
            </Card>
            {sports.map((report) => <SportCard key={report.sport} report={report} health={healthFor(health, report.sport, "spread") ?? healthFor(health, report.sport, "moneyline")} />)}
            {sports.length === 0 ? (
              <EmptyState title="No team-sport reports" detail="Backtest a sport to generate its report and ratings." command="npm run sports:backtest -- --sport nfl" />
            ) : null}
          </div>
        </Section>

        <Section kicker="Recent results" title="Last five features" description="Winners from the newest verified race results in the database.">
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">Recent race winners</caption>
              <thead><tr><th>Date</th><th>Race</th><th>Winner</th><th className="num">Started</th><th className="num">Field</th></tr></thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.raceId}>
                    <td className="tnum text-[var(--muted)]">{shortDate(row.raceDate)}</td>
                    <td><Link href={`/admin/races/${row.raceId}/scorecard`} className="strong hover:text-[var(--accent-hi)]">{row.name}</Link><div className="text-xs text-[var(--muted)]">{row.trackName} · {row.division}</div></td>
                    <td>{row.winner}</td>
                    <td className="num">{row.winnerStart ?? "—"}</td>
                    <td className="num">{row.fieldSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <footer className="border-t border-[var(--border)] pt-6 text-xs leading-6 text-[var(--muted)]">
          Fair odds on race cards are no-vig conversions of model probability. Backtest prices are archived, not executable. A settled ledger with positive closing-line value is the only evidence of an edge.
        </footer>
      </main>
    </div>
  );
}
