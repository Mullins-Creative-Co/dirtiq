import { Fragment } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";

import { Nav } from "@/components/nav";
import { EntryStatusManager } from "@/components/prediction/entry-status-manager";
import { AgentConsensusPanel } from "@/components/prediction/agent-consensus-panel";
import { LineCaveatManager } from "@/components/prediction/line-caveat-manager";
import { ModelLineActions } from "@/components/prediction/model-line-actions";
import { ModelDirectionGuide } from "@/components/prediction/model-direction-guide";
import { MarketPredictionCard } from "@/components/prediction/market-prediction-card";
import { RaceContextPanel } from "@/components/prediction/race-context-panel";
import { UnderwritingNotesPanel } from "@/components/prediction/underwriting-notes-panel";
import { getDb } from "@/lib/db";
import { listActiveLineCaveats } from "@/lib/line-caveats";
import { buildPredictionCard } from "@/lib/prediction-card";
import { getMarketLineDetailMap, getMarketLineMap } from "@/lib/market-lines";
import { getRaceEntries } from "@/lib/races";
import { getOddsFreshness } from "@/lib/odds-freshness";
import { getRace } from "@/lib/races";
import { listRaceContextAdjustments } from "@/lib/race-context-adjustments";
import { listUnderwritingNotesForRace } from "@/lib/underwriting-notes";

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function readinessPct(value: number, total: number) {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type AccountingRow = {
  driverName: string;
  trackStarts: number;
  trackWins: number;
  bestFinish: number | null;
  trackTrendDelta: number;
  raceContextDelta: number;
  caveatMultiplier: number;
  trackTrendLabels: string | null;
  raceContextLabels: string | null;
};

function getAccountingRows(raceId: number, trackId: number): AccountingRow[] {
  const rows = getDb()
    .prepare(
      `WITH active_entries AS (
         SELECT re.driver_id, d.name AS driver_name
         FROM race_entries re
         JOIN drivers d ON d.id = re.driver_id
         WHERE re.race_id = ?
           AND COALESCE(re.entry_status, 'expected') != 'scratched'
       ),
       track_history AS (
         SELECT re.driver_id,
                COUNT(*) AS starts,
                SUM(CASE WHEN re.finishing_position = 1 THEN 1 ELSE 0 END) AS wins,
                MIN(re.finishing_position) AS best_finish
         FROM race_entries re
         JOIN races r ON r.id = re.race_id
         WHERE r.track_id = ?
           AND r.status = 'complete'
           AND re.race_id != ?
           AND re.finishing_position IS NOT NULL
         GROUP BY re.driver_id
       ),
       trend_totals AS (
         SELECT driver_id,
                SUM(score_delta) AS score_delta,
                group_concat(label, '; ') AS labels
         FROM track_driver_trends
         WHERE track_id = ?
           AND active = 1
           AND driver_id IS NOT NULL
         GROUP BY driver_id
       ),
       context_totals AS (
         SELECT driver_id,
                SUM(score_delta) AS score_delta,
                group_concat(label, '; ') AS labels
         FROM race_context_adjustments
         WHERE race_id = ?
           AND active = 1
           AND driver_id IS NOT NULL
         GROUP BY driver_id
       ),
       caveat_totals AS (
         SELECT driver_id,
                EXP(SUM(LN(probability_multiplier))) AS multiplier
         FROM line_caveats
         WHERE race_id = ?
           AND active = 1
           AND driver_id IS NOT NULL
         GROUP BY driver_id
       )
       SELECT ae.driver_name AS driverName,
              COALESCE(th.starts, 0) AS trackStarts,
              COALESCE(th.wins, 0) AS trackWins,
              th.best_finish AS bestFinish,
              COALESCE(tt.score_delta, 0) AS trackTrendDelta,
              COALESCE(ct.score_delta, 0) AS raceContextDelta,
              COALESCE(cv.multiplier, 1) AS caveatMultiplier,
              tt.labels AS trackTrendLabels,
              ct.labels AS raceContextLabels
       FROM active_entries ae
       LEFT JOIN track_history th ON th.driver_id = ae.driver_id
       LEFT JOIN trend_totals tt ON tt.driver_id = ae.driver_id
       LEFT JOIN context_totals ct ON ct.driver_id = ae.driver_id
       LEFT JOIN caveat_totals cv ON cv.driver_id = ae.driver_id
       WHERE COALESCE(th.starts, 0) > 0
          OR COALESCE(tt.score_delta, 0) != 0
          OR COALESCE(ct.score_delta, 0) != 0
          OR COALESCE(cv.multiplier, 1) != 1
       ORDER BY (COALESCE(tt.score_delta, 0) + COALESCE(ct.score_delta, 0)) DESC,
                COALESCE(th.wins, 0) DESC,
                COALESCE(th.starts, 0) DESC`
    )
    .all(raceId, trackId, raceId, trackId, raceId, raceId) as AccountingRow[];

  return rows;
}

function scoreDeltaClass(value: number) {
  if (value > 0.07) return "text-green-300";
  if (value > 0) return "text-amber-300";
  if (value < 0) return "text-red-300";
  return "text-slate-500";
}

function formatDelta(value: number) {
  if (value === 0) return "0.000";
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function recommendationClass(value: "Play" | "Lean" | "Pass") {
  if (value === "Play") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (value === "Lean") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-slate-700 bg-slate-900/40 text-slate-400";
}

export default async function PredictionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const { id } = await params;
  const raceId = Number(id);
  if (!Number.isFinite(raceId)) notFound();

  const card = buildPredictionCard(raceId);
  if (!card) notFound();
  const race = getRace(raceId);
  if (!race) notFound();
  const marketLines = getMarketLineMap(raceId);
  const marketLineDetails = getMarketLineDetailMap(raceId);
  const caveats = plain(listActiveLineCaveats(raceId));
  const entries = getRaceEntries(raceId);
  const contextAdjustments = plain(listRaceContextAdjustments(raceId));
  const underwritingNotes = plain(listUnderwritingNotesForRace(raceId, race.track_id));
  const oddsFreshness = getOddsFreshness(raceId, card.fieldSize);
  const accountingRows = getAccountingRows(raceId, race.track_id);

  const recommended = card.rows.filter((row) => row.recommendation === "Play");
  const leans = card.rows.filter((row) => row.recommendation === "Lean");
  const mlRows = card.rows.filter((row) => row.mlProbability !== null);
  const modelPicks = card.rows.slice(0, 8);
  const modelSummary = (() => {
    const modelSeries = new Set(mlRows.map((row) => row.mlModelSeries).filter(Boolean));
    const modelReasons = new Set(mlRows.map((row) => row.mlModelReason).filter(Boolean));
    const engines = new Set(
      mlRows.map((row) => row.mlAlgorithm ?? row.mlEngine ?? row.mlModel).filter(Boolean)
    );
    const featureCounts = new Set(
      mlRows.map((row) => row.mlFeatureCount).filter((value) => value !== null)
    );
    if (engines.size === 0) return "No cached model metadata yet.";
    const features = featureCounts.size === 1 ? ` · ${[...featureCounts][0]} features` : "";
    const series = modelSeries.size > 0 ? `${[...modelSeries].join(", ")} · ` : "";
    const reason = modelReasons.size > 0 ? ` · ${[...modelReasons].join(", ")}` : "";
    return `${series}${[...engines].join(", ")}${features}${reason}`;
  })();

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-10 space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href={`/admin/races/${card.raceId}`}
              className="text-xs text-[var(--muted)] hover:text-white transition-colors"
            >
              ← Race board
            </Link>
            <h1 className="mt-1 text-3xl font-black text-white">Prediction Card</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {card.raceName} · {card.trackName} · {fmt.format(new Date(`${card.raceDate}T12:00:00`))} · {card.trackCondition}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/races/${card.raceId}`}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)] hover:text-white"
            >
              Edit Inputs
            </Link>
            <Link
              href={`/admin/races/${card.raceId}/book`}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-black hover:opacity-90"
            >
              Odds / Lines
            </Link>
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {[
            { label: "Field", value: card.fieldSize.toString(), detail: "drivers priced" },
            { label: "Plays", value: recommended.length.toString(), detail: "high-conviction signals" },
            { label: "Leans", value: leans.length.toString(), detail: "watchlist signals" },
            { label: "ML Layer", value: readinessPct(mlRows.length, card.fieldSize), detail: `${mlRows.length}/${card.fieldSize} scored` },
            {
              label: "Lineup",
              value: readinessPct(card.readiness.starts, card.readiness.entries),
              detail: `${card.readiness.starts}/${card.readiness.entries} starts`,
            },
            {
              label: "Heat/QT",
              value: `${readinessPct(card.readiness.heats, card.readiness.entries)} / ${readinessPct(card.readiness.qualifying, card.readiness.entries)}`,
              detail: "heat / qualifying",
            },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                {stat.label}
              </p>
              <p className="mt-2 text-2xl font-black text-white">{stat.value}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{stat.detail}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-white">Model Picks</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Clean admin view of the current model order before you publish or edit any market odds.
              </p>
            </div>
            <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Top {modelPicks.length}
            </span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {modelPicks.map((row) => (
              <div key={row.driverId} className="grid gap-3 px-5 py-4 md:grid-cols-[56px_minmax(180px,1.4fr)_repeat(4,minmax(86px,0.55fr))_minmax(220px,1.5fr)] md:items-center">
                <div className="text-xl font-black tabular-nums text-white">#{row.rank}</div>
                <div>
                  <p className="font-semibold text-white">{row.driverName}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {row.carNumber ? `#${row.carNumber} · ` : ""}{row.metricSeries}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Final</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-white">{pct(row.modelProbability)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">XG</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-green-300">{row.mlProbability === null ? "—" : pct(row.mlProbability)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Fair</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-amber-300">{row.fairOdds}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Call</p>
                  <span className={`mt-1 inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${recommendationClass(row.recommendation)}`}>
                    {row.recommendation}
                  </span>
                </div>
                <div className="space-y-1 text-xs leading-5">
                  {(row.reasons[0] || row.warnings[0]) ? (
                    <>
                      {row.reasons[0] ? <p className="text-green-300">{row.reasons[0]}</p> : null}
                      {row.warnings[0] ? <p className="text-red-300">{row.warnings[0]}</p> : null}
                    </>
                  ) : (
                    <p className="text-[var(--muted)]">No major signal.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <AgentConsensusPanel card={card} />

        <ModelDirectionGuide raceId={card.raceId} trackId={race.track_id} />

        <div className="grid gap-5 xl:grid-cols-2">
          <EntryStatusManager
            raceId={card.raceId}
            entries={entries.map((entry) => ({
              driverId: entry.driver_id,
              driverName: entry.driver_name,
              carNumber: entry.car_number,
              entryStatus: entry.entry_status,
            }))}
          />

          <LineCaveatManager
            raceId={card.raceId}
            drivers={card.rows.map((row) => ({ id: row.driverId, name: row.driverName }))}
            caveats={caveats}
          />
        </div>

        <ModelLineActions
          raceId={card.raceId}
          mlScored={mlRows.length}
          fieldSize={card.fieldSize}
          modelSummary={modelSummary}
          oddsFreshness={oddsFreshness}
        />

        <RaceContextPanel
          raceId={card.raceId}
          drivers={card.rows.map((row) => ({ id: row.driverId, name: row.driverName }))}
          adjustments={contextAdjustments}
        />

        {accountingRows.length > 0 ? (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">Underwriting Accounting Check</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Use this to avoid double-counting. Track starts/wins are already in the base model; track trend and race context are manual layers on top.
                </p>
              </div>
              <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                {accountingRows.length} drivers
              </span>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Driver", "Base Smoky Data", "Reusable Track Trend", "Race-Specific Context", "Caveat", "Duplication Risk"].map((heading) => (
                      <th
                        key={heading}
                        className={`px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] ${heading === "Driver" || heading === "Duplication Risk" ? "text-left" : "text-right"}`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accountingRows.map((row) => {
                    const totalManual = row.trackTrendDelta + row.raceContextDelta;
                    const hasBase = row.trackStarts > 0;
                    const duplicateRisk =
                      hasBase && row.trackTrendDelta > 0 && row.raceContextDelta > 0
                        ? "High: base stats plus track trend plus race context"
                        : hasBase && totalManual > 0
                          ? "Medium: base stats plus one manual boost"
                          : totalManual > 0.08
                            ? "Medium: manual boost is large"
                            : "Low";

                    return (
                      <Fragment key={row.driverName}>
                        <tr className="border-b border-[var(--border)]">
                          <td className="px-3 py-3 font-semibold text-white">{row.driverName}</td>
                          <td className="px-3 py-3 text-right font-mono text-xs text-slate-300">
                            {row.trackStarts} starts · {row.trackWins} wins
                            {row.bestFinish ? ` · best P${row.bestFinish}` : ""}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`font-mono text-xs font-bold ${scoreDeltaClass(row.trackTrendDelta)}`}>
                              {formatDelta(row.trackTrendDelta)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`font-mono text-xs font-bold ${scoreDeltaClass(row.raceContextDelta)}`}>
                              {formatDelta(row.raceContextDelta)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs text-slate-300">
                            x{row.caveatMultiplier.toFixed(2)}
                          </td>
                          <td className={`px-3 py-3 text-xs leading-5 ${duplicateRisk === "Low" ? "text-[var(--muted)]" : "text-amber-300"}`}>
                            {duplicateRisk}
                          </td>
                        </tr>
                        {(row.trackTrendLabels || row.raceContextLabels) ? (
                          <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]/35">
                            <td colSpan={6} className="px-3 py-2">
                              <div className="grid gap-2 text-[10px] leading-4 text-[var(--muted)] lg:grid-cols-2">
                                {row.trackTrendLabels ? (
                                  <p>
                                    <span className="font-bold uppercase tracking-wider text-slate-400">Track trend:</span>{" "}
                                    {row.trackTrendLabels}
                                  </p>
                                ) : null}
                                {row.raceContextLabels ? (
                                  <p>
                                    <span className="font-bold uppercase tracking-wider text-slate-400">Race context:</span>{" "}
                                    {row.raceContextLabels}
                                  </p>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <UnderwritingNotesPanel
          raceId={card.raceId}
          trackId={race.track_id}
          drivers={card.rows.map((row) => ({ id: row.driverId, name: row.driverName }))}
          notes={underwritingNotes}
        />

        <MarketPredictionCard
          card={card}
          initialMarketOdds={marketLines}
          marketLineDetails={marketLineDetails}
        />

        <p className="text-[11px] leading-5 text-[var(--muted)]">
          Data cutoff: {card.dataCutoff}. Market odds save to the Dirt IQ database
          when each field loses focus. Refresh the model cache before writing rational
          odds when entries, starts, heat, qualifying, track condition, or similar-track
          data changes.
        </p>
      </main>
    </div>
  );
}
