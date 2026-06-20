import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getRace, getRaceEntries, isRaceBettingOpen } from "@/lib/races";
import { calculateRaceOdds, type DriverOdds } from "@/lib/odds";
import { listDrivers } from "@/lib/drivers";
import { AddEntryForm } from "@/components/add-entry-form";
import { RecordResultsForm } from "@/components/record-results-form";
import { PreRaceDataForm } from "@/components/pre-race-form";
import { LiveConditionsForm } from "@/components/live-conditions-form";
import { LivePolling } from "@/components/live-polling";
import { GoLiveButton } from "@/components/go-live-button";
import { MrpSyncPanel } from "@/components/mrp-sync-panel";
import { BettingControls } from "@/components/betting-controls";
import { EntryStatusManager } from "@/components/prediction/entry-status-manager";
import { LineCaveatManager } from "@/components/prediction/line-caveat-manager";
import { ModelLineActions } from "@/components/prediction/model-line-actions";
import { RaceContextPanel } from "@/components/prediction/race-context-panel";
import { SeriesConflictPanel } from "@/components/prediction/series-conflict-panel";
import { UnderwritingNotesPanel } from "@/components/prediction/underwriting-notes-panel";
import { PatternReportPanel } from "@/components/prediction/pattern-report-panel";
import { QuickFeedbackPanel } from "@/components/prediction/quick-feedback-panel";
import { listActiveLineCaveats } from "@/lib/line-caveats";
import { getOddsFreshness } from "@/lib/odds-freshness";
import { buildPredictionCard } from "@/lib/prediction-card";
import { listRaceContextAdjustments } from "@/lib/race-context-adjustments";
import { listUnderwritingNotesForRace } from "@/lib/underwriting-notes";
import { getPatternAnalysis } from "@/lib/pattern-analysis";

const fmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

function pct(n: number | null) {
  if (n === null) return "—";
  return `${Math.round(n * 100)}%`;
}

function OddsChip({ odds }: { odds: string }) {
  const negative = odds.startsWith("-");
  return (
    <span className={`font-bold tabular-nums text-lg ${negative ? "text-green-400" : parseInt(odds) <= 300 ? "text-amber-400" : "text-slate-400"}`}>
      {odds}
    </span>
  );
}

function ReasoningCard({ d }: { d: DriverOdds }) {
  const r = d.reasoning;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-[var(--muted)] w-8 text-center">{d.carNumber ?? "—"}</span>
          <div>
            <div className="font-bold text-white text-base">{d.driverName}</div>
            <div className="text-xs text-[var(--muted)]">
              Win prob {pct(d.impliedProbability)} · {r.metricSeries}
            </div>
          </div>
        </div>
        <OddsChip odds={d.americanOdds} />
      </div>

      {/* Tonight's prelim banner — shown when lineup, heat, or QT data is entered */}
      {(r.tonightHeatPos !== null || r.tonightQtRank !== null || r.startingPosition !== null) && (
        <div className="flex items-center gap-4 px-4 py-2 bg-amber-500/10 border-b border-[var(--border)]">
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Tonight</span>
          {r.startingPosition !== null && (
            <span className={`text-xs font-semibold ${r.startingPosition <= 3 ? "text-amber-400" : r.startingPosition <= 6 ? "text-green-400" : "text-[var(--muted)]"}`}>
              Grid P{r.startingPosition}
              {r.startingPosWinRate !== null && r.startingPosStarts >= 3 && (
                <span className="ml-1 text-[var(--muted)]">({Math.round(r.startingPosWinRate * 100)}% W from here)</span>
              )}
            </span>
          )}
          {r.tonightQtRank !== null && (
            <span className={`text-xs font-semibold ${r.tonightQtRank === 1 ? "text-amber-400" : r.tonightQtRank <= 3 ? "text-green-400" : "text-[var(--muted)]"}`}>
              QT #{r.tonightQtRank}/{r.tonightQtRunners}
            </span>
          )}
          {r.tonightHeatPos !== null && (
            <span className={`text-xs font-semibold ${r.tonightHeatPos === 1 ? "text-amber-400" : r.tonightHeatPos <= 3 ? "text-green-400" : "text-[var(--muted)]"}`}>
              Heat P{r.tonightHeatPos}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-px bg-[var(--border)]">
        {[
          { label: "Track W%",   value: r.trackStarts > 0 ? pct(r.trackWinRate) : "—",          sub: r.trackStarts > 0 ? `${r.trackStarts} starts` : "no history",    hot: false, warn: false },
          { label: "Last Here",  value: r.lastEventHere != null ? `P${r.lastEventHere}` : "—",   sub: r.lastEventHere === 1 ? "won it" : r.lastEventHere != null ? "last visit" : "first time", hot: r.lastEventHere === 1, warn: false },
          { label: "Sim Trk",    value: r.similarTrackStarts > 0 ? pct(r.similarTrackWinRate) : "—", sub: `${r.similarTrackStarts} wtd`,                               hot: false, warn: false },
          { label: "Profile",    value: r.metricSeries.replace(" Late Models", "").replace(" LMDS", ""), sub: "stats series", hot: false, warn: false },
          { label: "Season W%",  value: pct(r.seasonWinRate),                                    sub: `${r.seasonStarts} starts`,                                       hot: (r.seasonWinRate ?? 0) >= 0.25, warn: false },
          { label: "Streak",     value: r.streak > 0 ? `${r.streak}` : "—",                     sub: r.streak > 0 ? r.streakType : "no streak",                        hot: r.streak >= 2, warn: false },
          { label: "Avg Fin",    value: r.avgFinish != null ? r.avgFinish.toFixed(1) : "—",      sub: "season avg",                                                     hot: (r.avgFinish ?? 99) <= 5, warn: false },
          { label: "Last 5",     value: r.last5AvgFinish != null ? r.last5AvgFinish.toFixed(1) : "—", sub: (r.last5AvgFinish ?? 99) <= 4.5 ? "🔥 hot" : (r.last5AvgFinish ?? 0) >= 14 ? "❄ cold" : "avg fin", hot: (r.last5AvgFinish ?? 99) <= 4.5, warn: (r.last5AvgFinish ?? 0) >= 14 },
          { label: "Dist W%",    value: r.distanceStarts >= 2 ? pct(r.distanceWinRate) : "—",   sub: r.distanceStarts >= 2 ? `${r.distanceStarts} races` : "no data",  hot: (r.distanceWinRate ?? 0) >= 0.3, warn: false },
          { label: "QT%",        value: pct(r.quickTimeRate),                                    sub: "season QT rate",                                                 hot: (r.quickTimeRate ?? 0) >= 0.25, warn: false },
          { label: "Heat W%",    value: pct(r.heatWinRate),                                      sub: "heat wins",                                                      hot: (r.heatWinRate ?? 0) >= 0.45, warn: false },
          { label: "DNF%",       value: pct(r.dnfRate),                                          sub: (r.dnfRate ?? 0) > 0.12 ? "⚠ high" : "normal",                   hot: false, warn: (r.dnfRate ?? 0) > 0.12 },
          { label: "F+/-",       value: r.featurePlusMinus != null ? (r.featurePlusMinus >= 0 ? `+${r.featurePlusMinus.toFixed(1)}` : r.featurePlusMinus.toFixed(1)) : "—", sub: r.featurePmRaces > 0 ? `${r.featurePmRaces} races` : "pending", hot: (r.featurePlusMinus ?? -99) >= 3, warn: (r.featurePlusMinus ?? 0) <= -3 },
          { label: "Grid W%",    value: r.startingPosition != null ? (r.startingPosStarts >= 3 && r.startingPosWinRate != null ? pct(r.startingPosWinRate) : `P${r.startingPosition}`) : "—", sub: r.startingPosition != null ? (r.startingPosStarts >= 3 ? `${r.startingPosStarts} starts` : "sparse data") : "no lineup", hot: r.startingPosition != null && r.startingPosition <= 3, warn: r.startingPosition != null && r.startingPosition > 12 },
        ].map((stat) => (
          <div key={stat.label} className="bg-[var(--surface)] px-2 py-3 text-center">
            <div className="text-[10px] text-[var(--muted)] mb-1">{stat.label}</div>
            <div className={`text-xs font-semibold ${stat.warn ? "text-red-400" : stat.hot ? "text-green-400" : "text-white"}`}>{stat.value}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate">{stat.sub}</div>
          </div>
        ))}
      </div>

      {(r.highlights.length > 0 || r.warnings.length > 0) && (
        <div className="px-5 py-3 space-y-1">
          {r.highlights.map((h, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-green-300">
              <span className="mt-0.5 shrink-0">▲</span><span>{h}</span>
            </div>
          ))}
          {r.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-red-300">
              <span className="mt-0.5 shrink-0">▼</span><span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function RacePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const raceId = parseInt(id, 10);
  if (isNaN(raceId)) notFound();
  const race = getRace(raceId);
  if (!race) notFound();

  // JSON round-trip makes SQLite rows plain objects (null-prototype → Object.prototype)
  // so they can be passed to "use client" components without React serialization errors.
  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const entries = plain(getRaceEntries(raceId));
  const isUpcoming = race.status === "upcoming";
  const isComplete = race.status === "complete";
  const isLive = !isComplete && !!race.is_live;
  const bettingStatus = race.betting_status ?? "open";
  const bettingOpen = isRaceBettingOpen(race);
  const odds = isComplete ? [] : plain(calculateRaceOdds(raceId, race.track_id));
  const predictionCard = !isComplete ? buildPredictionCard(raceId) : null;
  const allDrivers = plain(listDrivers());
  const entryDriverIds = new Set(entries.map((e) => e.driver_id));
  const availableDrivers = allDrivers.filter((d) => !entryDriverIds.has(d.id));
  const caveats = plain(listActiveLineCaveats(raceId));
  const contextAdjustments = plain(listRaceContextAdjustments(raceId));
  const underwritingNotes = plain(listUnderwritingNotesForRace(raceId, race.track_id));
  const patternAnalysis = plain(getPatternAnalysis(race, entries, 10));
  const oddsFreshness = predictionCard ? getOddsFreshness(raceId, predictionCard.fieldSize) : null;
  const predictionRows = predictionCard?.rows ?? [];
  const mlRows = predictionRows.filter((row) => row.mlProbability !== null);
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
  const raceDriverOptions = predictionRows.length > 0
    ? predictionRows.map((row) => ({ id: row.driverId, name: row.driverName }))
    : entries.map((entry) => ({ id: entry.driver_id, name: entry.driver_name }));

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <LivePolling enabled={isLive} />
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-10 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/admin/races" className="text-xs text-[var(--muted)] hover:text-white transition-colors">← Races</Link>
            <h1 className="mt-1 text-3xl font-bold text-white">{race.name}</h1>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-[var(--muted)]">
              <span>{race.track_name}</span><span>·</span>
              <span>{fmt.format(new Date(race.race_date + "T12:00:00"))}</span><span>·</span>
              <span>{race.division}</span>
              {race.distance && <><span>·</span><span>{race.distance} laps</span></>}
              <span>·</span>
              <span className="text-amber-400">{race.track_condition}</span>
              {race.weather_notes && <><span>·</span><span>{race.weather_notes}</span></>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 shrink-0">
            {isComplete && (
              <Link href={`/admin/races/${raceId}/scorecard`} className="rounded-full border border-amber-500/40 px-3 py-1 text-sm font-semibold text-amber-400 hover:bg-amber-500/10 transition-colors">
                Scorecard →
              </Link>
            )}
            <Link href={`/admin/races/${raceId}/book`} className="rounded-full border border-[var(--border)] px-3 py-1 text-sm font-semibold text-[var(--muted)] hover:text-white hover:border-white transition-colors">
              {isComplete ? "Settled Lines →" : "Odds / Lines →"}
            </Link>
            {!isComplete && <GoLiveButton raceId={raceId} isLive={isLive} />}
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${isComplete ? "bg-green-500/20 text-green-400" : isLive ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>
              {isComplete ? "Complete" : isLive ? "Live" : "Upcoming"}
            </span>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${bettingOpen ? "bg-blue-500/20 text-blue-400" : bettingStatus === "settled" || isComplete ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
              {bettingOpen ? "Lines Open" : bettingStatus === "settled" || isComplete ? "Settled" : "Lines Closed"}
            </span>
          </div>
        </div>

        <nav className="sticky top-0 z-30 -mx-4 border-y border-[var(--border)] bg-[#080a0d]/95 px-4 py-2 backdrop-blur md:hidden">
          <div className="grid grid-cols-4 gap-1.5">
            <a href="#model-actions" className="border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide text-white">
              Model
            </a>
            <a href="#quick-feedback" className="border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide text-white">
              Notes
            </a>
            <a href="#race-closeout" className="border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide text-white">
              Close
            </a>
            <Link href={`/admin/races/${raceId}/book`} className="bg-[var(--accent)] px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide text-black">
              Lines
            </Link>
          </div>
        </nav>

        {!isComplete && predictionCard && (
          <section className="space-y-5">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                    Event Command Center
                  </p>
                  <h2 className="mt-1 text-xl font-black text-white">Update this race from one place</h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    Entry status, caveats, race context, notes, model refresh, and published odds all flow from this event page.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/admin/races/${raceId}/prediction`}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:text-white"
                  >
                    Full Prediction Table
                  </Link>
                  <Link
                    href={`/admin/races/${raceId}/book`}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:text-white"
                  >
                    Odds / Lines
                  </Link>
                </div>
              </div>
            </div>

            <div id="model-actions" className="scroll-mt-16">
              <ModelLineActions
                raceId={raceId}
                mlScored={mlRows.length}
                fieldSize={predictionCard.fieldSize}
                modelSummary={modelSummary}
                oddsFreshness={oddsFreshness}
              />
            </div>

            <div id="quick-feedback" className="scroll-mt-16">
              <QuickFeedbackPanel raceId={raceId} trackId={race.track_id} />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <EntryStatusManager
                raceId={raceId}
                entries={entries.map((entry) => ({
                  driverId: entry.driver_id,
                  driverName: entry.driver_name,
                  carNumber: entry.car_number,
                  entryStatus: entry.entry_status,
                }))}
              />
              <LineCaveatManager
                raceId={raceId}
                drivers={raceDriverOptions}
                caveats={caveats}
              />
            </div>

            <RaceContextPanel
              raceId={raceId}
              drivers={raceDriverOptions}
              adjustments={contextAdjustments}
            />

            <SeriesConflictPanel raceId={raceId} />

            <UnderwritingNotesPanel
              raceId={raceId}
              trackId={race.track_id}
              drivers={raceDriverOptions}
              notes={underwritingNotes}
            />

            <PatternReportPanel
              raceId={raceId}
              trackId={race.track_id}
              raceName={race.name}
              trackName={race.track_name}
              entries={entries.map((entry) => ({
                driverId: entry.driver_id,
                driverName: entry.driver_name,
                carNumber: entry.car_number,
              }))}
              analysis={patternAnalysis}
            />
          </section>
        )}

        {isComplete && (
          <section className="space-y-5">
            <div id="quick-feedback" className="scroll-mt-16">
              <QuickFeedbackPanel raceId={raceId} trackId={race.track_id} />
            </div>
            <UnderwritingNotesPanel
              raceId={raceId}
              trackId={race.track_id}
              drivers={raceDriverOptions}
              notes={underwritingNotes}
            />
          </section>
        )}

        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            {/* Quick odds table */}
            <section>
              <h2 className="text-base font-semibold text-white mb-3">
                {isComplete ? "Results & Model Review" : "Odds Board"}
                {!isComplete && odds.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">{odds.length} entrants · 12% vig</span>
                )}
              </h2>
              {isComplete ? (
                entries.length === 0 ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-sm text-[var(--muted)]">
                    No results are attached to this completed race yet.
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
                    <table className="w-full text-sm min-w-[680px]">
                      <thead>
                        <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                          {["Finish", "Driver", "#", "Start", "Laps Led", "Status", "Margin", "Money"].map((h) => (
                            <th key={h} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${["Driver", "#", "Status", "Margin"].includes(h) ? "text-left" : "text-right"}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((entry) => (
                          <tr key={entry.id} className={`border-b border-[var(--border)] last:border-0 ${entry.finishing_position === 1 ? "bg-amber-500/10" : "hover:bg-[var(--surface-raised)]"} transition-colors`}>
                            <td className="px-3 py-2.5 text-right text-xs font-bold text-white">
                              {entry.finishing_position ? `P${entry.finishing_position}` : "—"}
                            </td>
                            <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">{entry.driver_name}</td>
                            <td className="px-3 py-2.5 text-[var(--muted)] text-xs">{entry.car_number ?? "—"}</td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] text-xs">{entry.starting_position ?? "—"}</td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] text-xs">{entry.laps_led}</td>
                            <td className="px-3 py-2.5 text-xs">
                              {entry.dnf ? <span className="text-red-400 font-semibold">DNF</span> : <span className="text-green-400">Running</span>}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-[var(--muted)]">{entry.margin ?? "—"}</td>
                            <td className="px-3 py-2.5 text-right text-xs text-[var(--muted)]">
                              {entry.money ? `$${entry.money.toLocaleString()}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : odds.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-sm text-[var(--muted)]">
                  Add drivers to the field to generate odds.
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                        {["Rank", "Driver", "#", "Profile", "Odds", "Win%", "Elo", "Streak", "Track", "Last Here", "Sim Trk", "Season W%", "Avg Fin", "Last 5", "Dist W%", "QT%", "DNF%", ...(isComplete ? ["Finish"] : [])].map((h) => (
                          <th key={h} className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${["Rank","Driver","#"].includes(h) ? "text-left" : "text-right"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {odds.map((d, i) => {
                        const entry = entries.find((e) => e.driver_id === d.driverId);
                        const r = d.reasoning;
                        return (
                          <tr key={d.driverId} className={`border-b border-[var(--border)] last:border-0 transition-colors ${isComplete && entry?.finishing_position === 1 ? "bg-amber-500/10" : "hover:bg-[var(--surface-raised)]"}`}>
                            <td className="px-3 py-2.5 text-[var(--muted)] text-xs">{i + 1}</td>
                            <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">{d.driverName}</td>
                            <td className="px-3 py-2.5 text-[var(--muted)] text-xs">{d.carNumber ?? "—"}</td>
                            <td className="px-3 py-2.5 text-right text-blue-300 text-xs font-semibold whitespace-nowrap">{r.metricSeries}</td>
                            <td className="px-3 py-2.5 text-right">
                              <OddsChip odds={d.americanOdds} />
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">{(d.impliedProbability * 100).toFixed(1)}%</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                              <span className={d.eloRating >= 1600 ? "text-amber-400 font-semibold" : d.eloRating >= 1540 ? "text-green-400" : "text-[var(--muted)]"}>
                                {d.eloRating}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                              {r.streak > 0
                                ? <span className={r.streak >= 3 ? "text-amber-400 font-bold" : r.streak >= 2 ? "text-green-400" : "text-[var(--muted)]"}>
                                    {r.streak}{r.streakType === "win" ? "W" : r.streakType === "podium" ? "P" : "T5"}
                                  </span>
                                : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">
                              {r.trackStarts > 0 ? `${pct(r.trackWinRate)} (${r.trackStarts})` : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                              {r.lastEventHere != null
                                ? <span className={r.lastEventHere === 1 ? "text-amber-400 font-bold" : r.lastEventHere <= 3 ? "text-green-400" : "text-[var(--muted)]"}>P{r.lastEventHere}</span>
                                : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">
                              {r.similarTrackStarts > 0 ? pct(r.similarTrackWinRate) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">
                              {r.seasonWinRate !== null ? pct(r.seasonWinRate) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                              {r.avgFinish != null
                                ? <span className={r.avgFinish <= 5 ? "text-green-400" : r.avgFinish <= 9 ? "text-amber-400" : "text-[var(--muted)]"}>{r.avgFinish.toFixed(1)}</span>
                                : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                              {r.last5AvgFinish != null
                                ? <span className={r.last5AvgFinish <= 4.5 ? "text-green-400 font-semibold" : r.last5AvgFinish <= 9 ? "text-amber-400" : "text-[var(--muted)]"}>{r.last5AvgFinish.toFixed(1)}</span>
                                : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">
                              {r.distanceStarts >= 2 ? pct(r.distanceWinRate) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums text-xs">
                              {r.quickTimeRate !== null ? pct(r.quickTimeRate) : <span className="text-slate-600">—</span>}
                            </td>
                            <td className={`px-3 py-2.5 text-right tabular-nums text-xs ${r.dnfRate != null && r.dnfRate > 0.12 ? "text-red-400" : "text-[var(--muted)]"}`}>
                              {r.dnfRate !== null ? pct(r.dnfRate) : <span className="text-slate-600">—</span>}
                            </td>
                            {isComplete && (
                              <td className="px-3 py-2.5 text-right">
                                {entry?.dnf ? <span className="text-red-400 font-medium text-xs">DNF</span>
                                  : entry?.finishing_position ? <span className={`text-xs ${entry.finishing_position === 1 ? "text-amber-400 font-bold" : "text-white"}`}>P{entry.finishing_position}</span>
                                  : <span className="text-[var(--muted)]">—</span>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Reasoning cards — top 10 */}
            {odds.length > 0 && !isComplete && (
              <section>
                <h2 className="text-base font-semibold text-white mb-3">
                  Why They&apos;re Favored
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">Top {Math.min(10, odds.length)} contenders</span>
                </h2>
                <div className="space-y-3">
                  {odds.slice(0, 10).map((d) => (
                    <ReasoningCard key={d.driverId} d={d} />
                  ))}
                </div>
                <p className="mt-4 text-xs text-[var(--muted)]">
                  Model weights: track history 30% · similar-track 25% · season win% 18% · avg finish 12% · who&apos;s hot (last 5) 12% · quick time 9% · heat win rate 8% · feature positions gained 10% · DNF risk −12% penalty. F+/- populates after races with MRP start data. Stats sourced from dirtrackr.com.
                </p>
              </section>
            )}
          </div>

          <aside className="space-y-5">
            {/* Live conditions — always visible, not just upcoming */}
            <div className="rounded-2xl border border-amber-500/30 bg-[var(--surface)] p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-white">Track Conditions</h3>
                <span className="text-[10px] rounded-full px-2 py-0.5 bg-amber-500/20 text-amber-400 font-semibold uppercase tracking-wide">Live</span>
              </div>
              <p className="text-[10px] text-[var(--muted)] mb-4">Update surface condition and environmental data as the event progresses.</p>
              <LiveConditionsForm
                raceId={raceId}
                currentCondition={race.track_condition}
                currentNotes={race.weather_notes}
                currentTimeOfDay={race.time_of_day}
                currentTempF={race.temperature_f}
                currentHumidityPct={race.humidity_pct}
                currentPrecip48hIn={race.precip_48h_in}
                currentWaterTruckRuns={race.water_truck_runs}
                currentGrooveStage={race.groove_stage}
              />
            </div>
            {isUpcoming && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-white mb-4">Add to Field</h3>
                {availableDrivers.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">All drivers are in the field.</p>
                ) : (
                  <AddEntryForm raceId={raceId} drivers={availableDrivers} />
                )}
              </div>
            )}
            {(isUpcoming || !!race.mrp_event_id) && (
              <div className="rounded-2xl border border-blue-500/30 bg-[var(--surface)] p-5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-white">MyRacePass Sync</h3>
                  <span className="text-[10px] rounded-full px-2 py-0.5 bg-blue-500/20 text-blue-400 font-semibold uppercase tracking-wide">Live Lines</span>
                </div>
                <p className="text-[10px] text-[var(--muted)] mb-4">
                  Pull heat results, QT times, and feature lineup from MRP to update the odds model.
                </p>
                <MrpSyncPanel
                  raceId={raceId}
                  mrpEventId={race.mrp_event_id ?? null}
                  bettingStatus={bettingStatus}
                  raceStatus={race.status}
                  isLive={isLive}
                />
              </div>
            )}
            <div id="race-closeout" className="scroll-mt-16 rounded-2xl border border-red-500/30 bg-[var(--surface)] p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-white">Lines & Results</h3>
                <span className="text-[10px] rounded-full px-2 py-0.5 bg-red-500/20 text-red-400 font-semibold uppercase tracking-wide">Settlement</span>
              </div>
              <p className="text-[10px] text-[var(--muted)] mb-4">
                Close market lines before the green flag, then sync final MRP results for settlement review.
              </p>
              <BettingControls
                raceId={raceId}
                bettingStatus={bettingStatus}
                raceStatus={race.status}
                isLive={isLive}
                hasMrpEvent={!!race.mrp_event_id}
              />
            </div>
            {entries.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-white mb-1">Pre-Race Data</h3>
                <p className="text-[10px] text-[var(--muted)] mb-4">QT = qualifying time in seconds · Heat = heat finish · Start = feature starting position</p>
                <PreRaceDataForm raceId={raceId} entries={entries} />
              </div>
            )}
            {isUpcoming && entries.length > 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-white mb-4">Record Results</h3>
                <RecordResultsForm raceId={raceId} entries={entries} />
              </div>
            )}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h3 className="font-semibold text-white mb-3">Field</h3>
              <div className="space-y-1 text-sm text-[var(--muted)] max-h-64 overflow-y-auto pr-1">
                {entries.length === 0 ? (
                  <span className="text-xs">No entries yet.</span>
                ) : (
                  entries.map((e) => (
                    <div key={e.id} className="flex items-center gap-2">
                      <span className="font-mono text-xs w-10 text-right text-amber-400">{e.car_number ?? "?"}</span>
                      <span>{e.driver_name}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
