import Link from "next/link";
import { connection } from "next/server";

import { Nav } from "@/components/nav";
import { Card, Chip, EmptyState, Note, PageHeader, Section, StatTile, Table, type Tone } from "@/components/ui/primitives";
import { ReliabilityChart } from "@/components/ui/reliability-chart";
import { num, pct, relativeAge, signed, units } from "@/lib/format";
import { SPORT_LABELS, getModelHealth, getOddsStatus, getRacingReport, listSportReports } from "@/lib/model-reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Model health", description: "Ledger scores, calibration, and backtests for every sportIQ model." };

function brierTone(value: number | null, baseline: number | null): Tone {
  if (value === null) return "neutral";
  if (baseline === null) return value < 0.25 ? "good" : "neutral";
  return value <= baseline ? "good" : value - baseline > 0.01 ? "warn" : "neutral";
}

export default async function ModelsPage() {
  await connection();
  const health = getModelHealth();
  const racing = getRacingReport();
  const sports = listSportReports();
  const models = health?.models ?? [];
  const odds = getOddsStatus();
  const oddsRuns = Object.entries(odds?.sports ?? {});

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-12 px-4 py-8 sm:px-6">
        <PageHeader kicker="Model health" title="The ledger decides." lede="Backtests tell you whether a method is sane. Only forecasts recorded before the event and graded afterward tell you whether the model is good. Both are here, kept separate." aside={<div className="grid grid-cols-2 gap-2"><StatTile label="Ledger exported" value={health ? relativeAge(health.generatedAt) : "never"} detail="npm run ledger:export" /><StatTile label="Odds feed" value={odds?.configured ? (oddsRuns.length ? relativeAge(oddsRuns[0][1].snapshotAt) : "idle") : "off"} detail={odds?.configured ? `${oddsRuns.length} sport${oddsRuns.length === 1 ? "" : "s"} snapshotted` : "set ODDS_API_KEY"} tone={odds?.configured ? "good" : "warn"} /></div>} />

        <Section kicker="Live" title="Ledger scorecard" description="One row per model and market. Brier below 0.25 beats a coin flip on two-way markets; for race winners compare against the uniform baseline in the backtest. CLV is the average no-vig closing probability minus the probability implied by the price taken.">
          {models.length === 0 ? (
            <EmptyState title="The ledger is empty" detail="Score upcoming races or forecast a sport to record forecasts, settle them when results land, then export." command={"npm run racing:score\nnpm run sports:forecast -- --sport nfl\nnpm run racing:settle && npm run ledger:export"} />
          ) : (
            <Table caption="Ledger summary by model">
              <thead><tr><th>Sport</th><th>Model</th><th>Market</th><th className="num">Open</th><th className="num">Settled</th><th className="num">W–L–P</th><th className="num">Brier</th><th className="num">Log loss</th><th className="num">ECE</th><th className="num">Units</th><th className="num">ROI</th><th className="num">CLV</th></tr></thead>
              <tbody>
                {models.map((m) => (
                  <tr key={`${m.sport}-${m.modelId}-${m.market}`}>
                    <td className="strong">{SPORT_LABELS[m.sport] ?? m.sport}</td>
                    <td><span className="font-mono text-xs">{m.modelId}</span> <span className="text-xs text-[var(--muted)]">v{m.modelVersion}</span></td>
                    <td>{m.market}</td>
                    <td className="num">{m.open}</td>
                    <td className="num">{m.settled}</td>
                    <td className="num">{m.settled ? `${m.wins}–${m.losses}–${m.pushes}` : "—"}</td>
                    <td className="num"><Chip tone={brierTone(m.brier, m.market === "win" || m.market === "top3" ? null : 0.25)}>{num(m.brier, 3)}</Chip></td>
                    <td className="num">{num(m.logLoss, 3)}</td>
                    <td className="num">{pct(m.ece)}</td>
                    <td className="num">{units(m.units)}</td>
                    <td className="num">{pct(m.roi)}</td>
                    <td className="num">{m.clvAvg === null ? "—" : `${signed(m.clvAvg * 100, 2)} pp`}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {models.some((m) => m.settled > 0) ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {models.filter((m) => m.settled >= 20).map((m) => (
                <Card key={`${m.sport}-${m.modelId}-${m.market}-cal`} className="p-4"><ReliabilityChart bins={m.calibration} title={`${SPORT_LABELS[m.sport] ?? m.sport} · ${m.market} (${m.settled} graded)`} /></Card>
              ))}
            </div>
          ) : null}
        </Section>

        <Section id="racing" kicker="Backtest" title="Dirt racing: new engine versus the legacy method" description="Rolling-origin by season on identical races. Log loss is per race on the winner distribution; lower is better. The legacy method is the old binary-XGBoost-plus-normalizer approach refit on the same folds without its leaking features, so this is method against method.">
          {!racing ? (
            <EmptyState title="Racing backtest not generated" detail="This produces the report and the per-series comparison." command="npm run racing:backtest" />
          ) : (
            <div className="space-y-6">
              <Table caption="Racing backtest by series">
                <thead><tr><th>Series</th><th>Stage</th><th className="num">Races</th><th className="num">Log loss</th><th className="num">Legacy</th><th className="num">Uniform</th><th className="num">Top pick wins</th><th className="num">Legacy</th><th className="num">Top-3 overlap</th><th className="num">ECE</th></tr></thead>
                <tbody>
                  {racing.series.map((s) => {
                    const better = s.logLoss !== null && s.legacyLogLoss !== null && s.logLoss < s.legacyLogLoss;
                    return (
                      <tr key={`${s.slug}-${s.stage}`}>
                        <td className="strong">{s.series}</td>
                        <td><Chip tone={s.stage === "race-night" ? "accent" : "neutral"}>{s.stage}</Chip></td>
                        <td className="num">{s.races}</td>
                        <td className="num"><Chip tone={better ? "good" : s.legacyLogLoss === null ? "neutral" : "warn"}>{num(s.logLoss, 3)}</Chip></td>
                        <td className="num">{num(s.legacyLogLoss, 3)}</td>
                        <td className="num text-[var(--muted)]">{num(s.uniformLogLoss, 3)}</td>
                        <td className="num">{pct(s.top1)}</td>
                        <td className="num text-[var(--muted)]">{pct(s.legacyTop1)}</td>
                        <td className="num">{num(s.top3Overlap, 2)}</td>
                        <td className="num">{pct(s.ece)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <div className="grid gap-4 md:grid-cols-2">
                {racing.series.filter((s) => s.calibration?.length).slice(0, 4).map((s) => (
                  <Card key={`${s.slug}-${s.stage}-rel`} className="p-4"><ReliabilityChart bins={s.calibration} title={`${s.series} · ${s.stage} · win probability`} /></Card>
                ))}
              </div>
              {racing.series.some((s) => s.features?.length) ? (
                <details className="panel p-4">
                  <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Largest standardized weights</summary>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    {racing.series.filter((s) => s.features?.length).map((s) => (
                      <div key={`${s.slug}-${s.stage}-w`}>
                        <p className="text-sm font-semibold">{s.series} · {s.stage}</p>
                        <ul className="mt-1 space-y-0.5 text-xs text-[var(--muted)]">
                          {[...s.features].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 8).map((f) => <li key={f.name} className="flex justify-between gap-3"><span className="font-mono">{f.name}</span><span className="tnum">{signed(f.weight, 3)}</span></li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              {racing.limitations?.length ? <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--muted)]">{racing.limitations.map((l) => <li key={l}>{l}</li>)}</ul> : null}
            </div>
          )}
        </Section>

        <Section kicker="Backtest" title="Team sports against the market" description="Independent rating model versus the archived closing line on the same games.">
          {sports.length === 0 ? <EmptyState title="No sport backtests" detail="Backtest a sport to add it here." command="npm run sports:backtest -- --sport nfl" /> : (
            <Table caption="Team sport backtests">
              <thead><tr><th>Sport</th><th className="num">Games</th><th className="num">MAE</th><th className="num">Market MAE</th><th className="num">ML Brier</th><th className="num">Market ML Brier</th><th className="num">ECE</th><th className="num">Selections</th><th className="num">Units</th></tr></thead>
              <tbody>
                {sports.map((r) => {
                  const bt = r.backtest;
                  return (
                    <tr key={r.sport}>
                      <td className="strong"><Link href={`/sports/${r.sport}`} className="hover:text-[var(--accent-hi)]">{r.label}</Link></td>
                      <td className="num">{bt?.games.toLocaleString() ?? "—"}</td>
                      <td className="num">{num(bt?.mae ?? null, 2)}</td>
                      <td className="num text-[var(--muted)]">{num(bt?.marketMae ?? null, 2)}</td>
                      <td className="num"><Chip tone={brierTone(bt?.brierMoneyline ?? null, bt?.marketBrierMoneyline ?? null)}>{num(bt?.brierMoneyline ?? null, 3)}</Chip></td>
                      <td className="num text-[var(--muted)]">{num(bt?.marketBrierMoneyline ?? null, 3)}</td>
                      <td className="num">{pct(bt?.ece ?? null)}</td>
                      <td className="num">{bt?.selections ? `${bt.selections.wins}–${bt.selections.losses}–${bt.selections.pushes}` : "—"}</td>
                      <td className="num">{units(bt?.selections?.units ?? null)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <Note>An independent model that trails the market by a few tenths of a point is normal. The useful questions are whether its probabilities are calibrated and whether the games where it disagrees with the market show positive closing-line value in the live ledger.</Note>
        </Section>

        <Section kicker="Closing-line value" title="Odds feed" description="CLV compares the price you forecast at with the no-vig closing price. The feed stores a consensus snapshot per run and refreshes closing lines on open ledger rows until the event starts.">
          {odds?.configured ? (
            oddsRuns.length ? (
              <Table caption="Odds snapshots by sport">
                <thead><tr><th>Sport</th><th>Last snapshot</th><th className="num">Events</th><th className="num">Matched</th><th className="num">Lines filled</th><th className="num">Closes refreshed</th><th className="num">Unresolved names</th></tr></thead>
                <tbody>{oddsRuns.map(([sport, run]) => <tr key={sport}><td className="strong">{SPORT_LABELS[sport] ?? sport}</td><td>{relativeAge(run.snapshotAt)}</td><td className="num">{run.events}</td><td className="num">{run.matchedEvents}</td><td className="num">{run.linesFilled}</td><td className="num">{run.closesUpdated}</td><td className="num">{run.unresolved}</td></tr>)}</tbody>
              </Table>
            ) : <Note>Key configured; no snapshot has run yet.</Note>
          ) : (
            <EmptyState title="Odds feed not configured" detail={odds?.setup ?? "Set ODDS_API_KEY and run the snapshot command."} command={"export ODDS_API_KEY=...\nnpm run odds:snapshot -- --sport nfl\nnpm run odds:snapshot -- --sport nba"} />
          )}
          {odds?.error ? <Note tone="warn">Last error: {odds.error}</Note> : null}
        </Section>

        <Section title="Commands">
          <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-black/40 p-4 font-mono text-xs leading-6 text-[var(--muted-strong)]">{`npm run racing:backtest        # rolling backtest + public/data/racing-model-report.json
npm run racing:train           # production artifacts per series and stage
npm run racing:score           # score upcoming races, record to ledger
npm run racing:settle          # grade completed races
npm run sports:backtest -- --sport nfl
npm run sports:forecast -- --sport nfl
npm run sports:settle   -- --sport nfl
npm run odds:snapshot   -- --sport nfl   # needs ODDS_API_KEY; fills lines and closing lines
npm run ledger:export          # public/data/model-health.json`}</pre>
        </Section>
      </main>
    </div>
  );
}
