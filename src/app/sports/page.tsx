import Link from "next/link";
import { connection } from "next/server";

import { Nav } from "@/components/nav";
import { Card, Chip, EmptyState, Kicker, PageHeader, Section } from "@/components/ui/primitives";
import { num, pct, relativeAge, signed } from "@/lib/format";
import { SPORT_LABELS, SPORT_ORDER, getModelHealth, getRacingReport, getUpcomingRaceBoards, listSportReports } from "@/lib/model-reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sports", description: "Every sport we model: ratings, projections, backtests against the market, and the dirt-racing house book." };

export default async function SportsIndexPage() {
  await connection();
  const reports = listSportReports();
  const health = getModelHealth();
  const racing = getRacingReport();
  const raceBoards = getUpcomingRaceBoards(6, 1);
  const racingNight = racing?.series.find((s) => s.slug === "pooled" && s.stage === "race-night") ?? racing?.series.find((s) => s.slug === "pooled") ?? null;
  const racingLedger = health?.models.filter((m) => m.sport === "racing").reduce((sum, m) => sum + m.settled, 0) ?? 0;
  const covered = new Set(reports.map((r) => r.sport));
  const missing = SPORT_ORDER.filter((s) => !covered.has(s));

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6">
        <PageHeader kicker="Sports" title="Every sport, one method." lede="Team sports share one state-space rating engine with a data adapter per league, backtested season by season against the archived market. Dirt racing uses a field model that prices the house book. Every live forecast lands in the same ledger." />

        <Section title="Sports with a model">
          {reports.length === 0 && !racing ? (
            <EmptyState title="No sport reports yet" detail="Backtest and forecast a sport to generate its report." command={"npm run sports:backtest -- --sport nfl\nnpm run sports:forecast -- --sport nfl"} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Kicker>{SPORT_LABELS.racing}</Kicker>
                    <h2 className="mt-1 font-display text-2xl font-black"><Link href="/sports/racing" className="hover:text-[var(--accent-hi)]">{raceBoards.length} upcoming · house book</Link></h2>
                  </div>
                  <Chip tone="accent">field model</Chip>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Top pick wins</dt><dd className="tnum font-semibold">{pct(racingNight?.top1 ?? null, 0)}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Log loss</dt><dd className="tnum font-semibold">{num(racingNight?.logLoss ?? null, 2)} <span className="text-xs text-[var(--muted)]">legacy {num(racingNight?.legacyLogLoss ?? null, 2)}</span></dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Calibration</dt><dd className="tnum font-semibold">{pct(racingNight?.ece ?? null)}</dd></div>
                </dl>
                <p className="mt-4 text-xs text-[var(--muted)]">{racingNight ? `${racingNight.races} backtest races, race-night stage` : "No backtest"} · {racingLedger} live graded · updated {racing ? relativeAge(racing.generatedAt) : "—"}</p>
                <Link href="/sports/racing" className="mt-3 inline-block text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Open dirt racing →</Link>
              </Card>
              {reports.map((report) => {
                const bt = report.backtest;
                const ledger = health?.models.filter((m) => m.sport === report.sport) ?? [];
                const settled = ledger.reduce((sum, m) => sum + m.settled, 0);
                const gap = bt?.mae !== null && bt?.mae !== undefined && bt.marketMae !== null && bt.marketMae !== undefined ? bt.mae - bt.marketMae : null;
                return (
                  <Card key={report.sport} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Kicker>{report.label}</Kicker>
                        <h2 className="mt-1 font-display text-2xl font-black"><Link href={`/sports/${report.sport}`} className="hover:text-[var(--accent-hi)]">{report.upcoming.length} upcoming · {report.ratings.length} rated</Link></h2>
                      </div>
                      <Chip tone={gap !== null && gap <= 0.15 ? "good" : "neutral"}>{gap === null ? "no market" : `${signed(gap, 2)} vs market`}</Chip>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                      <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Model MAE</dt><dd className="tnum font-semibold">{num(bt?.mae ?? null, 2)}</dd></div>
                      <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Market MAE</dt><dd className="tnum font-semibold">{num(bt?.marketMae ?? null, 2)}</dd></div>
                      <div><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">Calibration</dt><dd className="tnum font-semibold">{pct(bt?.ece ?? null)}</dd></div>
                    </dl>
                    <p className="mt-4 text-xs text-[var(--muted)]">{bt ? `${bt.games.toLocaleString()} backtest games, seasons ${bt.seasons[0]}–${bt.seasons[bt.seasons.length - 1]}` : "No backtest"} · {settled} live graded · updated {relativeAge(report.generatedAt)}</p>
                    <Link href={`/sports/${report.sport}`} className="mt-3 inline-block text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Open {report.label} →</Link>
                  </Card>
                );
              })}
            </div>
          )}
        </Section>

        {missing.length ? (
          <Section title="Not modeled yet" description="Each of these needs only a data adapter; the rating engine, scoring, and ledger are shared.">
            <div className="flex flex-wrap gap-2">{missing.map((s) => <Chip key={s}>{SPORT_LABELS[s]}</Chip>)}</div>
          </Section>
        ) : null}

        <Section title="Research labs" description="The earlier single-sport studies are preserved for reference. They found no repeatable market edge with EPA-style regressions, which is why the engine now reports calibration and closing-line value instead of backtest returns.">
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/football" className="odds-pill px-4 py-2 font-semibold">Football lab</Link>
            <Link href="/nba" className="odds-pill px-4 py-2 font-semibold">NBA lab</Link>
            <Link href="/matchups" className="odds-pill px-4 py-2 font-semibold">Matchup workbench</Link>
          </div>
        </Section>
      </main>
    </div>
  );
}
