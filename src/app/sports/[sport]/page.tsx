import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { Nav } from "@/components/nav";
import { Card, Chip, EmptyState, Note, PageHeader, Section, StatTile, Table, type Tone } from "@/components/ui/primitives";
import { ReliabilityChart } from "@/components/ui/reliability-chart";
import { SeasonDumbbell } from "@/components/ui/season-dumbbell";
import { american, dateTime, num, pct, probability, relativeAge, signed, spread, units } from "@/lib/format";
import { SPORT_LABELS, getModelHealth, getOddsSnapshot, getOddsStatus, getSportReport, oddsByMatchup } from "@/lib/model-reports";
import { forecastReadiness, isUpcomingGame } from "@/lib/forecast-readiness";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  return { title: `${SPORT_LABELS[sport] ?? sport.toUpperCase()} model` };
}

export default async function SportPage({ params }: { params: Promise<{ sport: string }> }) {
  await connection();
  const { sport } = await params;
  if (!/^[a-z]{2,8}$/.test(sport)) notFound();
  const report = getSportReport(sport);
  const label = SPORT_LABELS[sport] ?? sport.toUpperCase();
  if (!report) {
    return (
      <div className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
          <PageHeader kicker={label} title="No model report yet" />
          <EmptyState title={`${label} has not been backtested`} detail="Generate the report with the team engine. The adapter downloads public schedule and results data into a cache outside the repository." command={`npm run sports:backtest -- --sport ${sport}\nnpm run sports:forecast -- --sport ${sport}`} href="/sports" linkLabel="All sports" />
        </main>
      </div>
    );
  }

  const bt = report.backtest;
  const health = getModelHealth();
  const oddsStatus = getOddsStatus();
  const odds = getOddsSnapshot(sport);
  const live = oddsByMatchup(odds);
  const liveRun = oddsStatus?.sports?.[sport] ?? null;
  const ledger = health?.models.filter((m) => m.sport === sport) ?? [];
  const gap = bt?.mae !== null && bt?.mae !== undefined && bt.marketMae !== null && bt.marketMae !== undefined ? bt.mae - bt.marketMae : null;
  const sel = bt?.selections ?? null;
  const seasonRows = (bt?.bySeason ?? []).map((s) => ({ label: String(s.season).slice(-2), model: s.mae, market: s.marketMae, n: s.games }));
  const RATINGS_SHOWN = 40;
  const GAMES_SHOWN = 60;
  const topRatings = [...report.ratings].sort((a, b) => a.rank - b.rank).slice(0, RATINGS_SHOWN);
  // Request-time server component: connection() above excludes prerendering.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const upcoming = report.upcoming.filter((game) => isUpcomingGame(game, now));
  const shownGames = upcoming.slice(0, GAMES_SHOWN);
  const variant = upcoming.some((game) => game.headline === "stacked") ? "stacked ratings + rest" : "independent ratings";

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-12 px-4 py-8 sm:px-6">
        <PageHeader
          kicker={`${label} · ${report.modelId} v${report.modelVersion}`}
          title={`${label} ratings and projections`}
          lede={<>Current forecasts: {variant}{sport === "mlb" && variant.startsWith("stacked") ? " + probable pitchers" : ""}. Training uses earlier games only. Results through {report.dataThrough ?? "—"}; forecast generated {relativeAge(typeof report.forecastGeneratedAt === "string" ? report.forecastGeneratedAt : report.generatedAt)}. Injuries and confirmed lineups are not included.</>}
          aside={
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Model MAE" value={num(bt?.mae ?? null, 2)} detail={`market ${num(bt?.marketMae ?? null, 2)}`} tone={gap !== null && gap <= 0 ? "good" : "neutral"} />
              <StatTile label="Gap to market" value={gap === null ? "—" : signed(gap, 2)} detail="points, lower is better" tone={gap === null ? "neutral" : gap <= 0 ? "good" : gap < 0.5 ? "neutral" : "warn"} />
            </div>
          }
        />

        <Section kicker="This week" title="Upcoming games" description="Model-only home margin and win probability beside saved market snapshots. A spread lean is a research flag, not bet confidence. Games that have started are excluded.">
          <Note tone="warn">Verify the current book price and player availability before using a projection. The saved source-bundle retrieval time is not a per-game quote time. Consensus medians are not executable offers.</Note>
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming games in the saved window" detail="There are no future games in this report. Check back after the next forecast refresh." href="/sports" linkLabel="All sports" />
          ) : (
            <Table caption={`Upcoming ${label} games`}>
              <thead><tr><th>Game / input check</th><th className="num">Proj. margin</th><th className="num">SD</th><th className="num">Home win</th><th className="num">Saved spread</th>{odds ? <th className="num">Snapshot consensus</th> : null}<th className="num">Home cover</th><th className="num">Moneyline</th><th className="num">Spread lean</th></tr></thead>
              <tbody>
                {shownGames.map((g) => {
                  const leanTeam = g.lean === "home" ? g.home : g.lean === "away" ? g.away : null;
                  const tone: Tone = "neutral";
                  const readiness = forecastReadiness(report, g, now);
                  return (
                    <tr key={g.gameId}>
                      <td><span className="strong">{g.away} at {g.home}</span><div className="text-xs text-[var(--muted)]">{dateTime(g.startsAt)}{g.book ? ` · ${g.book}` : ""}</div><div className="mt-1"><Chip tone="warn" title={readiness.reasons.join(" ")}>{readiness.label}</Chip></div><details className="mt-1 max-w-xs text-xs text-[var(--muted)]"><summary className="cursor-pointer">Source and availability</summary><p className="mt-1">{readiness.quoteDetail}</p><p className="mt-1">{readiness.availabilityDetail}</p>{readiness.sourceUrl ? <a className="mt-1 inline-block underline" href={readiness.sourceUrl}>Market source</a> : null}</details></td>
                      <td className="num">{signed(g.projectedHomeMargin)}</td>
                      <td className="num text-[var(--muted)]">{num(g.marginSd, 1)}</td>
                      <td className="num">{probability(g.homeWinProb, 1)}<div className="text-xs text-[var(--muted)]">model-only</div></td>
                      <td className="num">{g.marketHomeSpread === null ? "—" : `${g.home} ${spread(g.marketHomeSpread)}`}<div className="text-xs text-[var(--muted)]">{g.marketHomePrice !== null ? `${american(g.marketHomePrice)} / ${american(g.marketAwayPrice)}` : ""}</div></td>
                      {odds ? (() => { const candidate = live.get(`${g.home}|${g.away}`); const l = candidate?.startsAt === g.startsAt ? candidate : null; return <td className="num">{l && l.homeSpread !== null ? `${g.home} ${spread(l.homeSpread)}` : "—"}<div className="text-xs text-[var(--muted)]">{l ? `${american(l.homeMl)} / ${american(l.awayMl)} · ${l.books} books` : ""}</div>{l ? <div className="text-xs text-[var(--muted)]">Retrieved {dateTime(l.observedAt)}</div> : null}</td>; })() : null}
                      <td className="num">{probability(g.homeCoverProb, 1)}{g.pushProb ? <div className="text-xs text-[var(--muted)]">push {probability(g.pushProb, 1)}</div> : null}</td>
                      <td className="num">{g.marketHomeMl !== null ? `${american(g.marketHomeMl)} / ${american(g.marketAwayMl)}` : "—"}</td>
                      <td className="num">{leanTeam ? <Chip tone={tone} title="Model disagrees with the market by this many points toward this side">{leanTeam} {g.edgePts === null ? "" : `${Math.abs(g.edgePts).toFixed(1)} pts`}</Chip> : <span className="text-[var(--muted)]">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {upcoming.length > shownGames.length ? <p className="text-xs text-[var(--muted)]">Showing the first {shownGames.length} of {upcoming.length} upcoming games; the full list is in the <a className="underline" href={`/sports/${sport}.json`}>raw report</a>.</p> : null}
          <Note tone="warn">Lines come from the public source file with its retrieval time, not from a live book. A lean is a research flag; expected value needs a current executable price.</Note>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <p className="font-semibold">Separate odds snapshots{oddsStatus?.configured ? "" : ": unavailable"}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                {oddsStatus?.configured
                  ? liveRun
                    ? `Last snapshot ${relativeAge(liveRun.snapshotAt)}: ${liveRun.events} events, ${liveRun.matchedEvents} matched to open forecasts, ${liveRun.closesUpdated} closing lines refreshed.`
                    : `Configured, but no snapshot for ${label} yet.`
                  : "The separate closing-line feed is not configured. Saved ESPN or source-file lines above may still be available, but they are not a continuously updating sportsbook feed."}
              </p>
            </div>
            <Link className="text-xs font-semibold underline" href="/models">View model and feed status</Link>
          </Card>
        </Section>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <Section kicker="Power ratings" title="Current strength" description="Points above an average team on a neutral field. SD is the filter's uncertainty.">
            {report.ratings.length > topRatings.length ? <p className="text-xs text-[var(--muted)]">Top {topRatings.length} of {report.ratings.length} rated teams.</p> : null}
            {topRatings.length === 0 ? <EmptyState title="No ratings" detail="Run the forecast command." /> : (
              <Table caption={`${label} power ratings`}>
                <thead><tr><th className="num">#</th><th>Team</th><th className="num">Rating</th><th className="num">SD</th><th className="num">Games</th></tr></thead>
                <tbody>
                  {topRatings.map((r) => (
                    <tr key={r.team}><td className="num text-[var(--muted)]">{r.rank}</td><td className="strong">{r.team}</td><td className="num">{signed(r.rating)}</td><td className="num text-[var(--muted)]">{num(r.sd, 1)}</td><td className="num text-[var(--muted)]">{r.games}</td></tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>

          <Section kicker="Backtest" title="Season by season" description="Rolling-origin: each season is forecast with hyperparameters fit on the seasons before it. Market MAE is the archived closing spread's error on the same games.">
            {bt ? (
              <div className="space-y-5">
                <Card className="p-4"><SeasonDumbbell rows={seasonRows} title={`Margin error by season, ${label}`} /></Card>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label="Games" value={bt.games.toLocaleString()} detail={`${bt.seasons[0]}–${bt.seasons[bt.seasons.length - 1]}`} />
                  <StatTile label="ML Brier" value={num(bt.brierMoneylineOnPricedGames ?? bt.brierMoneyline, 3)} detail={bt.marketBrierMoneyline !== null ? `market ${num(bt.marketBrierMoneyline, 3)}, same priced games` : "all games"} tone={(bt.brierMoneylineOnPricedGames ?? bt.brierMoneyline) !== null && bt.marketBrierMoneyline !== null && (bt.brierMoneylineOnPricedGames ?? bt.brierMoneyline)! <= bt.marketBrierMoneyline ? "good" : "neutral"} />
                  <StatTile label="Spread Brier" value={num(bt.brierSpread, 3)} detail={`market ${num(bt.marketBrierSpread, 3)}`} />
                  <StatTile label="Calibration error" value={pct(bt.ece)} detail="expected, moneyline" tone={bt.ece !== null && bt.ece < 0.03 ? "good" : "neutral"} />
                </div>
                {bt.stackedBrierMoneyline !== null && bt.stackedBrierMoneyline !== undefined ? (
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    Headline variant: <span className="font-semibold text-[var(--foreground)]">{bt.headline ?? "independent"}</span>. Stacked layer (rating + rest + starters) ML Brier {num(bt.stackedBrierMoneyline, 3)}
                    {bt.stackedMarketBrierMoneyline !== null && bt.stackedMarketBrierMoneyline !== undefined ? <>; with the market line as an input {num(bt.stackedMarketBrierMoneyline, 3)} against the market&apos;s own {num(bt.marketBrierMoneyline, 3)}</> : null}.
                  </p>
                ) : null}
                {sel ? (
                  <Card className="p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Fixed disagreement rule{sel.rule ? `: ${sel.rule}` : ""}</p>
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                      <span className="tnum"><span className="font-display text-2xl font-black">{sel.wins}–{sel.losses}–{sel.pushes}</span> <span className="text-[var(--muted)]">on {sel.n} selections</span></span>
                      <span className="tnum">{units(sel.units)} <span className="text-[var(--muted)]">at archived prices</span></span>
                      <span className="tnum">{pct(sel.roi)} <span className="text-[var(--muted)]">ROI</span></span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Threshold set before results were inspected. Archived prices are not executable, so this is a diagnostic, not a return.</p>
                  </Card>
                ) : null}
                {bt.variants?.length ? (
                  <Table caption="Model variants">
                    <thead><tr><th>Variant</th><th className="num">MAE</th>{"brierMoneyline" in (bt.variants[0] ?? {}) ? <th className="num">ML Brier</th> : null}</tr></thead>
                    <tbody>{bt.variants.map((v) => <tr key={v.id}><td className="strong">{v.id}</td><td className="num">{num((v.mae as number | null) ?? null, 2)}</td>{"brierMoneyline" in v ? <td className="num">{num((v.brierMoneyline as number | null) ?? null, 3)}</td> : null}</tr>)}</tbody>
                  </Table>
                ) : null}
              </div>
            ) : <EmptyState title="No backtest" detail="Run the backtest command for this sport." command={`npm run sports:backtest -- --sport ${sport}`} />}
          </Section>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <Section kicker="Calibration" title="Backtest reliability" description="Moneyline win probability against the observed win rate.">
            <Card className="p-4">{bt ? <ReliabilityChart bins={bt.calibration} title={`${label} moneyline reliability`} /> : <p className="text-sm text-[var(--muted)]">No backtest.</p>}</Card>
          </Section>
          <Section kicker="Live ledger" title="Graded forecasts" description="Every recorded forecast is settled from results. This is the evidence that counts.">
            {ledger.length === 0 ? <EmptyState title="Nothing graded yet" detail="Forecasts are recorded when you run the forecast command and graded when you settle." command={`npm run sports:settle -- --sport ${sport}`} /> : (
              <Table caption={`${label} ledger summary`}>
                <thead><tr><th>Market</th><th className="num">Open</th><th className="num">Settled</th><th className="num">W–L–P</th><th className="num">Brier</th><th className="num">Units</th><th className="num">CLV</th></tr></thead>
                <tbody>{ledger.map((m) => <tr key={`${m.modelId}-${m.market}`}><td className="strong">{m.market}</td><td className="num">{m.open}</td><td className="num">{m.settled}</td><td className="num">{m.wins}–{m.losses}–{m.pushes}</td><td className="num">{num(m.brier, 3)}</td><td className="num">{units(m.units)}</td><td className="num">{m.clvAvg === null ? "—" : `${signed(m.clvAvg * 100, 2)} pp`}</td></tr>)}</tbody>
              </Table>
            )}
          </Section>
        </div>

        <Section title="Limits and sources">
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-[var(--muted)]">{report.limitations.map((line) => <li key={line}>{line}</li>)}</ul>
          {report.sources.length ? (
            <div className="text-xs text-[var(--muted)]">
              Sources: {report.sources.map((s, i) => <span key={s.url}>{i > 0 ? " · " : ""}<a className="underline" href={s.url}>{s.url.replace(/^https?:\/\//, "").slice(0, 60)}</a>{s.sha256 ? ` (${s.sha256.slice(0, 8)})` : ""}</span>)}
              {" · "}<a className="underline" href={`/sports/${sport}.json`}>raw report</a>
            </div>
          ) : null}
          <Link href="/sports" className="inline-block text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">← All sports</Link>
        </Section>
      </main>
    </div>
  );
}
