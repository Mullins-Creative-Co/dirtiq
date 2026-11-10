import Link from "next/link";
import { connection } from "next/server";

import { Nav } from "@/components/nav";
import { Card, Chip, EmptyState, Note, PageHeader, Section, StatTile, Table } from "@/components/ui/primitives";
import { ReliabilityChart } from "@/components/ui/reliability-chart";
import { fairAmerican, longDate, num, pct, relativeAge, shortDate, units } from "@/lib/format";
import { getModelHealth, getRacingDataSummary, getRacingReport, getRecentRaceResults, getUpcomingRaceBoards } from "@/lib/model-reports";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dirt racing", description: "Dirt late-model race forecasts: calibrated win probabilities for every entrant, props, and the house book." };

export default async function RacingSportPage() {
  await connection();
  const boards = getUpcomingRaceBoards(12, 10);
  const report = getRacingReport();
  const health = getModelHealth();
  const recent = getRecentRaceResults(8);
  const data = getRacingDataSummary();
  const pooledEarly = report?.series.find((s) => s.slug === "pooled" && s.stage === "early") ?? null;
  const pooledNight = report?.series.find((s) => s.slug === "pooled" && s.stage === "race-night") ?? null;
  const ledger = health?.models.filter((m) => m.sport === "racing") ?? [];
  const win = ledger.find((m) => m.market === "win") ?? null;

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-12 px-4 py-8 sm:px-6">
        <PageHeader
          kicker={`Dirt racing · ${report?.modelId ?? "racing model"}${report ? ` v${report.modelVersion}` : ""}`}
          title="Dirt late models"
          lede={<>A pick-one-of-N model gives every entrant a probability that sums to one across the field, with top-3, top-5 and head-to-head derived from the same draw. This is also the house book: the <Link href="/bet" className="text-[var(--accent)] underline">bettor lobby</Link> prices from these numbers plus margin and risk limits.</>}
          aside={
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Top pick wins" value={pct(pooledNight?.top1 ?? pooledEarly?.top1 ?? null, 0)} detail={pooledNight ? "race night, backtest" : "backtest"} tone="accent" />
              <StatTile label="Graded" value={win?.settled ?? 0} detail={win?.settled ? `${units(win.units)} · Brier ${num(win.brier, 3)}` : "live ledger"} />
            </div>
          }
        />

        <Section kicker="Upcoming" title="Next races" description="Full fields with the model's win and top-3 probabilities and fair odds. Early-model races tighten once qualifying, heats and the starting lineup are entered." action={<Link href="/admin/today" className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Race board →</Link>}>
          {boards.length === 0 ? (
            <EmptyState title="No scored upcoming races" detail="When upcoming races have entries, score them and they appear here." command="npm run racing:score" href="/admin/races" linkLabel="Manage races" />
          ) : (
            <div className="space-y-6">
              {boards.map((board) => (
                <Card key={board.race.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-[var(--muted)]">{longDate(board.race.race_date)} · {board.race.track_name} · {board.modelSeries ?? board.race.division}</p>
                      <h3 className="mt-1 font-display text-xl font-black leading-tight"><Link href={`/admin/races/${board.race.id}/prediction`} className="hover:text-[var(--accent-hi)]">{board.race.name}</Link></h3>
                    </div>
                    <div className="flex gap-1.5">
                      {board.race.is_live ? <Chip tone="bad">Live</Chip> : null}
                      <Chip tone={board.stage === "race-night" ? "accent" : "neutral"}>{board.stage === "race-night" ? "Race night" : "Early"}</Chip>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Table caption={`${board.race.name} field`}>
                      <thead><tr><th className="num">#</th><th>Driver</th><th className="num">Win</th><th className="num">Fair</th><th className="num">Top 3</th><th className="num">Exp. finish</th><th className="num">Start</th><th className="num">Last five</th></tr></thead>
                      <tbody>
                        {board.rows.map((row, index) => (
                          <tr key={row.driverId}>
                            <td className="num text-[var(--muted)]">{index + 1}</td>
                            <td className="strong">{row.driverName}{row.carNumber ? <span className="ml-1 text-xs font-normal text-[var(--muted)]">#{row.carNumber}</span> : null}</td>
                            <td className="num">{pct(row.probability, 1)}</td>
                            <td className="num">{fairAmerican(row.probability)}</td>
                            <td className="num">{pct(row.top3Probability, 0)}</td>
                            <td className="num">{num(row.expectedFinish, 1)}</td>
                            <td className="num text-[var(--muted)]">{row.startingPosition ?? "TBD"}</td>
                            <td className="num text-[var(--muted)]">{row.recentFinishes.map((r) => r.finish).join(" ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                  <p className="mt-3 text-xs text-[var(--muted)]">{board.scored} of {board.fieldSize} entrants scored · starts {board.readiness.starts}/{board.fieldSize} · qualifying {board.readiness.qualifying}/{board.fieldSize} · heats {board.readiness.heats}/{board.fieldSize}</p>
                </Card>
              ))}
            </div>
          )}
        </Section>

        <div className="grid gap-8 lg:grid-cols-2">
          <Section kicker="Backtest" title="How the model tests" description="Rolling by season on identical races. Log loss is per race on the winner distribution, lower is better; the legacy column is the previous method refit on the same folds.">
            {report ? (
              <div className="space-y-4">
                <Table caption="Racing backtest">
                  <thead><tr><th>Series</th><th>Stage</th><th className="num">Races</th><th className="num">Log loss</th><th className="num">Legacy</th><th className="num">Top pick</th></tr></thead>
                  <tbody>
                    {report.series.map((s) => (
                      <tr key={`${s.slug}-${s.stage}`}><td className="strong">{s.series}</td><td><Chip tone={s.stage === "race-night" ? "accent" : "neutral"}>{s.stage}</Chip></td><td className="num">{s.races}</td><td className="num">{num(s.logLoss, 3)}</td><td className="num text-[var(--muted)]">{num(s.legacyLogLoss, 3)}</td><td className="num">{pct(s.top1, 0)}</td></tr>
                    ))}
                  </tbody>
                </Table>
                <p className="text-xs text-[var(--muted)]">{data.races} completed races · {data.entries.toLocaleString()} entries · {data.drivers} drivers · data through {data.latest ?? "—"} · report {relativeAge(report.generatedAt)}. <Link href="/models#racing" className="text-[var(--accent)] underline">Full report</Link></p>
              </div>
            ) : <EmptyState title="No racing backtest" detail="Generate it with the racing engine." command="npm run racing:backtest" />}
          </Section>
          <Section kicker="Calibration" title="Win probability reliability" description="Backtest forecasts against observed win rate, race-night stage.">
            <Card className="p-4">{pooledNight ? <ReliabilityChart bins={pooledNight.calibration} title="Race night · win probability" /> : pooledEarly ? <ReliabilityChart bins={pooledEarly.calibration} title="Early · win probability" /> : <p className="text-sm text-[var(--muted)]">No backtest yet.</p>}</Card>
            {ledger.length ? (
              <Table caption="Racing ledger">
                <thead><tr><th>Market</th><th className="num">Open</th><th className="num">Graded</th><th className="num">Brier</th><th className="num">Units</th></tr></thead>
                <tbody>{ledger.map((m) => <tr key={m.market}><td className="strong">{m.market}</td><td className="num">{m.open}</td><td className="num">{m.settled}</td><td className="num">{num(m.brier, 3)}</td><td className="num">{units(m.units)}</td></tr>)}</tbody>
              </Table>
            ) : <Note>No racing forecasts in the ledger yet. Scoring an upcoming race records win, top-3 and top-5 forecasts; settling grades them.</Note>}
          </Section>
        </div>

        <Section kicker="Results" title="Recent winners">
          <Table caption="Recent race winners">
            <thead><tr><th>Date</th><th>Race</th><th>Winner</th><th className="num">Started</th><th className="num">Field</th></tr></thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.raceId}><td className="tnum text-[var(--muted)]">{shortDate(row.raceDate)}</td><td><Link href={`/admin/races/${row.raceId}/scorecard`} className="strong hover:text-[var(--accent-hi)]">{row.name}</Link><div className="text-xs text-[var(--muted)]">{row.trackName} · {row.division}</div></td><td>{row.winner}</td><td className="num">{row.winnerStart ?? "—"}</td><td className="num">{row.fieldSize}</td></tr>
              ))}
            </tbody>
          </Table>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/bet" className="odds-pill px-4 py-2 font-semibold">Bettor lobby</Link>
            <Link href="/preview/world-100" className="odds-pill px-4 py-2 font-semibold">World 100 preview</Link>
            <Link href="/admin/accuracy" className="odds-pill px-4 py-2 font-semibold">Accuracy history</Link>
          </div>
        </Section>
      </main>
    </div>
  );
}
