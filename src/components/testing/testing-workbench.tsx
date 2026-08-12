"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

import { ModelRaceReviewForm } from "@/components/model-race-review-form";
import type { CrownReplay } from "@/lib/crown-replay";
import type { HistoricalBackfillPlan } from "@/lib/historical-backfill";
import type { ModelDataQuality } from "@/lib/model-data-quality";
import type { ModelLayer, TestingTask, ValidationStage } from "@/lib/testing/plan";
import type { TestingReadiness } from "@/lib/testing/readiness";
import type { AccuracySignal } from "@/lib/model-accuracy";
import type { ModelRaceReview } from "@/lib/model-race-review-options";

type TestingWorkbenchProps = {
  tasks: TestingTask[];
  modelLayers: ModelLayer[];
  validationStages: ValidationStage[];
  readiness: TestingReadiness;
  upcoming: UpcomingRaceSummary[];
  historical: HistoricalReplaySummary;
  dataQuality: ModelDataQuality;
  crownReplay: CrownReplay;
  historicalBackfill: HistoricalBackfillPlan;
};

type UpcomingRaceSummary = {
  id: number;
  name: string;
  trackName: string;
  raceDate: string;
  division: string;
  fieldSize: number;
  readiness: {
    entries: number;
    starts: number;
    qualifying: number;
    heats: number;
  };
  topPicks: Array<{
    rank: number;
    driverName: string;
    probability: number;
    fairOdds: string;
    recommendation: "Play" | "Lean" | "Pass";
    confidence: "High" | "Medium" | "Low";
    reasons: string[];
    warnings: string[];
    mlProbability: number | null;
    mlModelSeries: string | null;
  }>;
};

type HistoricalReplayRow = {
  raceId: number;
  raceName: string;
  raceDate: string;
  division: string;
  trackName: string;
  fieldSize: number;
  winner: string;
  winnerStart: number | null;
  winnerQtRank: number | null;
  earlyFavorite: string;
  earlyFavoriteFinish: number | null;
  earlyWinnerRank: number;
  raceNightFavorite: string;
  raceNightFavoriteFinish: number | null;
  raceNightWinnerRank: number;
  quickTimeDriver: string | null;
  quickTimeFinish: number | null;
  quickTimeWon: boolean | null;
  quickTimeTop3: boolean | null;
  hasQualifying: boolean;
  hasStartingLineup: boolean;
  hasHeatData: boolean;
  missReason: string;
  review: ModelRaceReview | null;
};

type HistoricalReplaySummary = {
  summary: {
    races: number;
    entries: number;
    earlyTop1: number;
    earlyTop3: number;
    raceNightTop1: number;
    raceNightTop3: number;
    avgEarlyWinnerRank: number | null;
    avgRaceNightWinnerRank: number | null;
    racesWithQualifying: number;
    racesWithLineup: number;
  };
  signals: AccuracySignal[];
  rows: HistoricalReplayRow[];
};

const storageKey = "dirtiq-testing-task-state";
const storageChangeEvent = "dirtiq-testing-task-state-change";
const emptyTaskState = "{}";

const laneClass: Record<TestingTask["lane"], string> = {
  Data: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  Model: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Backtest: "border-green-500/30 bg-green-500/10 text-green-300",
  "Race Day": "border-purple-500/30 bg-purple-500/10 text-purple-300",
  Betting: "border-red-500/30 bg-red-500/10 text-red-300",
};

const modelIterationRules = [
  {
    label: "Add race data first",
    detail: "Finishes, starts, QT, heats, laps led, scratches, and conditions improve the model more than opinion notes.",
  },
  {
    label: "Promote only repeatable signals",
    detail: "Use hypothesis audit/accuracy before turning a caveat into a model feature.",
  },
  {
    label: "Compare before and after",
    detail: "After retraining, check winner rank, top-3 hit rate, logloss, and whether the misses got smaller.",
  },
];

const refreshCommands = [
  { label: "Route check", command: "npm run models:audit" },
  { label: "Score races", command: "npm run models:score" },
  { label: "Retrain all", command: "npm run models:train" },
  { label: "Full refresh", command: "npm run models:refresh" },
];

const reviewGuide = [
  ["Playable group", "Winner was top 3; model had the right contenders."],
  ["Missing inputs", "We lacked QT, heats, lineup, scratches, or field data."],
  ["QT overrated", "Fast qualifier had speed but did not convert."],
  ["Lineup/passing", "Start spot, traffic, or passing ability decided it."],
  ["Track history", "Track type, local reps, or past success mattered."],
  ["Local specialist", "Regional driver outran national baseline."],
  ["Bad field data", "Wrong entry, scratch, wrong car, or wrong series."],
  ["Needs review", "Use when unsure; explain it in notes."],
];

const confidenceGuide = [
  ["0.25", "hunch"],
  ["0.50", "reasonable"],
  ["0.75", "strong"],
  ["1.00", "obvious"],
];

const modelingTodos: TestingTask[] = [
  {
    id: "model-confirm-field",
    title: "Confirm the active field",
    lane: "Race Day",
    detail: "Scratch non-attending drivers, mark uncertain entries, and confirm the right Lucas/WoO/Crown model route.",
  },
  {
    id: "model-enter-race-night",
    title: "Enter race-night inputs",
    lane: "Data",
    detail: "Add qualifying, heat result, starting spot, track condition, and any clear surface/prep note.",
  },
  {
    id: "model-refresh-slate",
    title: "Refresh the model slate",
    lane: "Model",
    detail: "Run a fresh prediction and clear stale odds before judging the board.",
  },
  {
    id: "model-review-output",
    title: "Review model output",
    lane: "Backtest",
    detail: "Check top contenders, quick-time impact, race-night rank, caveats, and whether the favorite makes sense.",
  },
  {
    id: "model-publish-lines",
    title: "Publish only clean lines",
    lane: "Betting",
    detail: "Keep bettable lines limited to active entries with a rationale, confidence, and stake cap.",
  },
  {
    id: "model-record-results",
    title: "Record results after the race",
    lane: "Data",
    detail: "Save finish, start, QT, heat, laps led, DNF, margin, money, and final condition notes.",
  },
  {
    id: "model-label-miss",
    title: "Label the model hit or miss",
    lane: "Backtest",
    detail: "Use Accuracy to mark why the model hit or missed: field data, QT, start, local history, form, or variance.",
  },
  {
    id: "model-promote-feature",
    title: "Promote only proven signals",
    lane: "Model",
    detail: "Use audits before adding a caveat as an XGBoost feature. Retrain only after structured data changes.",
  },
];

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function pct(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}

function rate(n: number, d: number) {
  if (d <= 0) return "--";
  return `${Math.round((n / d) * 100)}%`;
}

function pctWhole(value: number) {
  return `${Math.round(value * 100)}%`;
}

function coverageTone(value: number) {
  if (value >= 0.9) return "text-green-300";
  if (value >= 0.75) return "text-amber-300";
  return "text-red-300";
}

function readinessLabel(race: UpcomingRaceSummary) {
  const { entries, starts, qualifying, heats } = race.readiness;
  if (entries === 0) return "Needs field";
  if (starts > 0 && qualifying > 0 && heats > 0) return "Race-night ready";
  if (starts > 0 || qualifying > 0 || heats > 0) return "Partial inputs";
  return "Pre-race only";
}

function badgeClass(value: string) {
  if (value === "Play" || value === "High" || value === "Race-night ready") {
    return "border-green-500/30 bg-green-500/10 text-green-300";
  }
  if (value === "Lean" || value === "Medium" || value === "Partial inputs") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }
  return "border-slate-500/30 bg-slate-500/10 text-slate-300";
}

function rankTone(rank: number) {
  if (rank === 1) return "text-green-300";
  if (rank <= 3) return "text-amber-300";
  return "text-slate-400";
}

function winnerSignalBadges(row: CrownReplay["rows"][number]) {
  const signals = [];
  if (row.crownPriorWin) signals.push("Crown win");
  if (row.crownPriorTop3) signals.push("Crown top 3");
  if (row.recentWin14d) signals.push("Recent win");
  if (row.recentTop514d) signals.push("Recent top 5");
  if (row.priorDeepStartTop3Count > 0) signals.push("Deep-start pass");
  return signals.length > 0 ? signals : ["No prior signal"];
}

export function TestingWorkbench({
  readiness,
  upcoming,
  historical,
  dataQuality,
  crownReplay,
  historicalBackfill,
}: TestingWorkbenchProps) {
  const completedSnapshot = useSyncExternalStore(
    subscribeToTaskState,
    readTaskStateSnapshot,
    () => emptyTaskState
  );
  const defaultCompleted = useMemo(
    () =>
      Object.fromEntries(
        modelingTodos
          .filter((task) => task.completedByDefault)
          .map((task) => [task.id, true])
      ) as Record<string, boolean>,
    []
  );
  const completed = useMemo(
    () => ({ ...defaultCompleted, ...parseTaskState(completedSnapshot) }),
    [completedSnapshot, defaultCompleted]
  );
  const doneCount = modelingTodos.filter((task) => completed[task.id]).length;
  const activeSeason = upcoming[0]?.raceDate
    ? new Date(`${upcoming[0].raceDate}T12:00:00`).getFullYear()
    : new Date().getFullYear();
  const activeRace = upcoming[0] ?? null;
  const activeWinner = activeRace?.topPicks[0] ?? null;
  const activeStatus = activeRace ? readinessLabel(activeRace) : "Needs field";
  const crownSummary = crownReplay.summary;

  function toggleTask(taskId: string) {
    const next = {
      ...completed,
      [taskId]: !completed[taskId],
    };

    window.localStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(storageChangeEvent));
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <aside className="fixed right-4 top-24 z-30 hidden max-h-[calc(100vh-7rem)] w-80 overflow-y-auto border border-[var(--border)] bg-[#0b0d10]/95 p-4 shadow-2xl shadow-black/40 2xl:block">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent)]">
          Feedback Guide
        </p>
        <h2 className="mt-1 text-sm font-black uppercase text-white">Historic Race Labels</h2>
        <div className="mt-4 space-y-2">
          {reviewGuide.map(([label, detail]) => (
            <div key={label} className="border border-[var(--border)] bg-[var(--surface)] p-2.5">
              <p className="text-xs font-bold text-white">{label}</p>
              <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">
            Checkboxes
          </p>
          <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
            Check QT, Start, or Track/local only when that factor clearly changed
            the result. Check Test feature when we should study the pattern later.
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {confidenceGuide.map(([value, label]) => (
            <div key={value} className="border border-[var(--border)] bg-[var(--surface)] p-2 text-center">
              <p className="font-mono text-sm font-black text-white">{value}</p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
            </div>
          ))}
        </div>
      </aside>

      {activeRace ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[#080a0d]/95 px-3 py-3 shadow-2xl shadow-black/60 backdrop-blur md:hidden">
          <div className="mx-auto grid max-w-6xl grid-cols-3 gap-2">
            <Link href={`/admin/races/${activeRace.id}/prediction`} className="bg-[var(--accent)] px-2 py-3 text-center text-[11px] font-black uppercase tracking-wide text-white">
              Reason
            </Link>
            <Link href={`/admin/races/${activeRace.id}`} className="border border-[var(--border)] bg-[var(--surface)] px-2 py-3 text-center text-[11px] font-black uppercase tracking-wide text-white">
              Update
            </Link>
            <Link href="/admin/maintenance" className="border border-[var(--border)] bg-[var(--surface)] px-2 py-3 text-center text-[11px] font-black uppercase tracking-wide text-[var(--muted)]">
              Refresh
            </Link>
          </div>
        </div>
      ) : null}

      <section className="border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid gap-0 lg:grid-cols-[1fr_360px]">
          <div className="px-4 py-5 sm:px-6 sm:py-6">
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[var(--accent)]">
              Dirt IQ Race Lab
            </p>
            <h1 className="mt-3 text-2xl font-black uppercase leading-tight text-white sm:text-5xl">
              Race-night model control
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Start with the next race, confirm the field, inspect the model picks,
              update caveats or race-night inputs, then refresh and validate.
            </p>
          </div>
          <div className="grid grid-cols-3 border-t border-[var(--border)] bg-[#101010] lg:border-l lg:border-t-0">
            {[
              { label: "Races", value: upcoming.length },
              { label: "Done", value: `${doneCount}/${modelingTodos.length}` },
              { label: "Models", value: readiness.modelArtifacts.length },
            ].map((stat) => (
              <div key={stat.label} className="border-r border-[var(--border)] px-4 py-5 last:border-r-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">{stat.label}</p>
                <p className="mt-2 font-mono text-3xl font-black text-white">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] bg-[#141414] px-5 py-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent)]">
              Active race
            </p>
            <h2 className="mt-1 text-xl font-black uppercase text-white">
              {activeRace ? activeRace.name : "No upcoming race loaded"}
            </h2>
            {activeRace ? (
              <p className="mt-1 text-sm text-[var(--muted)]">
                {fmt.format(new Date(`${activeRace.raceDate}T12:00:00`))} · {activeRace.trackName} · {activeRace.division}
              </p>
            ) : null}
          </div>

          {activeRace ? (
            <div className="p-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: "Field", value: activeRace.fieldSize.toString() },
                  { label: "Status", value: activeStatus },
                  { label: "Winner", value: activeWinner?.driverName ?? "Needs entries" },
                  { label: "Fair odds", value: activeWinner?.fairOdds ?? "—" },
                ].map((item) => (
                  <div key={item.label} className="border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{item.label}</p>
                    <p className="mt-2 break-words text-base font-black text-white sm:text-lg">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-3 md:hidden">
                {activeRace.topPicks.slice(0, 6).map((pick) => (
                  <Link
                    key={pick.driverName}
                    href={`/admin/races/${activeRace.id}/prediction`}
                    className="block border border-[var(--border)] bg-[var(--surface-raised)] p-4 active:border-[var(--accent)]/70"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">#{pick.rank}</p>
                        <p className="mt-1 break-words text-base font-black text-white">{pick.driverName}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-sm font-black text-white">{pct(pick.probability)}</p>
                        <p className="font-mono text-xs text-amber-300">{pick.fairOdds}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${badgeClass(pick.recommendation)}`}>
                        {pick.recommendation}
                      </span>
                      <span className={`border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${badgeClass(pick.confidence)}`}>
                        {pick.confidence}
                      </span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                      {pick.reasons[0] ?? pick.warnings[0] ?? "No rationale yet"}
                    </p>
                  </Link>
                ))}
              </div>

              <div className="mt-5 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[#0b0d10] text-[10px] uppercase tracking-widest text-[var(--muted)]">
                      <th className="py-2 pl-3 text-left">Rank</th>
                      <th className="py-2 text-left">Driver</th>
                      <th className="py-2 text-right">Model</th>
                      <th className="py-2 text-right">Odds</th>
                      <th className="py-2 text-right">Call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRace.topPicks.slice(0, 8).map((pick) => (
                      <tr key={pick.driverName} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-3 pl-3 pr-3 text-xs text-[var(--muted)]">#{pick.rank}</td>
                        <td className="py-3 pr-3">
                          <p className="font-semibold text-white">{pick.driverName}</p>
                          <p className="mt-1 max-w-[420px] text-xs leading-5 text-[var(--muted)]">
                            {pick.reasons[0] ?? pick.warnings[0] ?? "No rationale yet"}
                          </p>
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-xs text-white">{pct(pick.probability)}</td>
                        <td className="py-3 pr-3 text-right font-mono text-xs text-amber-300">{pick.fairOdds}</td>
                        <td className="py-3 pr-3 text-right">
                          <span className={`border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${badgeClass(pick.recommendation)}`}>
                            {pick.recommendation}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 hidden flex-wrap gap-2 md:flex">
                <Link href={`/admin/races/${activeRace.id}/prediction`} className="bg-[var(--accent)] px-4 py-2 text-sm font-black text-white hover:opacity-90">
                  Open reasoning/edit
                </Link>
                <Link href={`/admin/races/${activeRace.id}`} className="border border-[var(--border)] px-4 py-2 text-sm font-semibold text-white hover:border-[var(--accent)]/60">
                  Update race inputs
                </Link>
                <Link href={`/admin/races/${activeRace.id}/book`} className="border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)] hover:text-white">
                  Odds/lines
                </Link>
              </div>
            </div>
          ) : (
            <p className="p-8 text-sm text-[var(--muted)]">Create or import the next event to start modeling.</p>
          )}
        </div>

        <div className="space-y-5">
          <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-base font-bold text-white">Model Health</h2>
            <div className="mt-4 space-y-3">
              {readiness.modelArtifacts.slice(0, 4).map((artifact) => (
                <div key={artifact.name} className="border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold text-white">{artifact.series}</p>
                    <p className="text-[11px] text-blue-300">{artifact.algorithm}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-sm font-bold text-white">{artifact.testAuc === null ? "—" : artifact.testAuc.toFixed(3)}</p>
                      <p className="text-[10px] text-[var(--muted)]">AUC</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{artifact.top1Accuracy === null ? "—" : `${Math.round(artifact.top1Accuracy * 100)}%`}</p>
                      <p className="text-[10px] text-[var(--muted)]">Top-1</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{artifact.featureCount}</p>
                      <p className="text-[10px] text-[var(--muted)]">Features</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-base font-bold text-white">Refresh Commands</h2>
            <div className="mt-4 space-y-2">
              {refreshCommands.map((item) => (
                <div key={item.command} className="border border-[var(--border)] bg-[#0b0d10] p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{item.label}</p>
                  <p className="mt-1 font-mono text-xs text-amber-300">{item.command}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent)]">
              Data quality
            </p>
            <h2 className="mt-1 text-xl font-black uppercase text-white">What To Improve Before Retraining</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              The model gets better from complete rows: finish, start, qualifying, heat,
              equipment, and clear race labels.
            </p>
          </div>
          <div className="divide-y divide-[var(--border)] md:hidden">
            {dataQuality.coverage.slice(0, 8).map((row) => (
              <div key={`${row.series}-${row.year}`} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-white">{row.series}</p>
                    <p className="mt-1 font-mono text-xs text-[var(--muted)]">{row.year} · {row.races} races · {row.entries} entries</p>
                  </div>
                  <p className={`font-mono text-sm font-black ${coverageTone(row.finishRate)}`}>{pctWhole(row.finishRate)}</p>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["QT", row.qualifyingRate],
                    ["Start", row.startRate],
                    ["Heat", row.heatRate],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="border border-[var(--border)] bg-[#0b0d10] p-2">
                      <p className={`font-mono text-sm font-black ${coverageTone(Number(value))}`}>{pctWhole(Number(value))}</p>
                      <p className="text-[10px] text-[var(--muted)]">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[780px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[#0b0d10] text-[10px] uppercase tracking-widest text-[var(--muted)]">
                  <th className="px-3 py-3 text-left">Series</th>
                  <th className="px-3 py-3 text-right">Year</th>
                  <th className="px-3 py-3 text-right">Races</th>
                  <th className="px-3 py-3 text-right">Entries</th>
                  <th className="px-3 py-3 text-right">Finish</th>
                  <th className="px-3 py-3 text-right">QT</th>
                  <th className="px-3 py-3 text-right">Start</th>
                  <th className="px-3 py-3 text-right">Heat</th>
                </tr>
              </thead>
              <tbody>
                {dataQuality.coverage.slice(0, 18).map((row) => (
                  <tr key={`${row.series}-${row.year}`} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-3 py-3 font-semibold text-white">{row.series}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-[var(--muted)]">{row.year}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-white">{row.races}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-white">{row.entries}</td>
                    <td className={`px-3 py-3 text-right font-mono text-xs ${coverageTone(row.finishRate)}`}>{pctWhole(row.finishRate)}</td>
                    <td className={`px-3 py-3 text-right font-mono text-xs ${coverageTone(row.qualifyingRate)}`}>{pctWhole(row.qualifyingRate)}</td>
                    <td className={`px-3 py-3 text-right font-mono text-xs ${coverageTone(row.startRate)}`}>{pctWhole(row.startRate)}</td>
                    <td className={`px-3 py-3 text-right font-mono text-xs ${coverageTone(row.heatRate)}`}>{pctWhole(row.heatRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-base font-bold text-white">Next Data Moves</h2>
          <div className="mt-4 space-y-3">
            {dataQuality.actions.map((action) => (
              <div key={action.title} className="border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-white">{action.title}</p>
                  <span className={`border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                    action.priority === "High"
                      ? "border-red-500/30 bg-red-500/10 text-red-300"
                      : action.priority === "Medium"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                        : "border-slate-500/30 bg-slate-500/10 text-slate-300"
                  }`}>
                    {action.priority}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{action.detail}</p>
                {action.command ? (
                  <p className="mt-3 break-words bg-[#0b0d10] p-2 font-mono text-[11px] leading-5 text-amber-300">
                    {action.command}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid gap-px bg-[var(--border)] lg:grid-cols-[1fr_520px]">
          <div className="bg-[var(--surface)] px-5 py-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent)]">
              Crown replay
            </p>
            <h2 className="mt-1 text-xl font-black uppercase text-white">XGBoost vs Agent vs Actual</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Replay crown races with the combined model and a transparent underwriting agent.
              Gaps show where QT, heat, or start data is missing.
            </p>
          </div>
          <div className="grid grid-cols-2 bg-[#101010] sm:grid-cols-4">
            {[
              { label: "Races", value: crownSummary.races.toString() },
              { label: "XGB T3", value: rate(crownSummary.xgbTop3, crownSummary.races) },
              { label: "Agent T3", value: rate(crownSummary.agentTop3, crownSummary.races) },
              { label: "Gaps", value: (crownSummary.missingQualifyingRaces + crownSummary.missingHeatRaces + crownSummary.missingStartRaces).toString() },
            ].map((item) => (
              <div key={item.label} className="border-l border-[var(--border)] px-4 py-5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">{item.label}</p>
                <p className="mt-2 font-mono text-xl font-black text-white sm:text-2xl">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {crownReplay.rows.length > 0 ? (
          <>
          <div className="divide-y divide-[var(--border)] md:hidden">
            {crownReplay.rows.slice(0, 8).map((row) => (
              <Link key={row.raceId} href={`/admin/races/${row.raceId}`} className="block px-4 py-4 active:bg-[var(--surface-raised)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-bold text-white">{row.raceName}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{row.raceDate} · {row.trackName}</p>
                  </div>
                  <p className={`shrink-0 text-lg font-black ${rankTone(row.xgbRank)}`}>XGB #{row.xgbRank}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="border border-[var(--border)] bg-[#0b0d10] p-2">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Actual</p>
                    <p className="mt-1 text-sm font-bold text-white">{row.actualWinner}</p>
                  </div>
                  <div className="border border-[var(--border)] bg-[#0b0d10] p-2">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Agent</p>
                    <p className={`mt-1 text-sm font-bold ${rankTone(row.agentRank ?? 99)}`}>#{row.agentRank ?? "--"}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {winnerSignalBadges(row).slice(0, 3).map((signal) => (
                    <span key={signal} className="border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-amber-200">
                      {signal}
                    </span>
                  ))}
                  {row.gaps.length > 0 ? (
                    <span className="border border-red-400/25 bg-red-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-red-200">
                      Missing {row.gaps.join(", ")}
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden overflow-x-auto p-5 md:block">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[#0b0d10] text-[10px] uppercase tracking-widest text-[var(--muted)]">
                  <th className="px-3 py-3 text-left">Race</th>
                  <th className="px-3 py-3 text-left">Actual</th>
                  <th className="px-3 py-3 text-center">XGBoost</th>
                  <th className="px-3 py-3 text-center">Agent</th>
                  <th className="px-3 py-3 text-left">Race-night</th>
                  <th className="px-3 py-3 text-left">Winner signals</th>
                  <th className="px-3 py-3 text-left">Gaps</th>
                </tr>
              </thead>
              <tbody>
                {crownReplay.rows.slice(0, 12).map((row) => (
                  <tr key={row.raceId} className="border-b border-[var(--border)] align-top last:border-0">
                    <td className="px-3 py-4">
                      <Link href={`/admin/races/${row.raceId}`} className="font-bold text-white hover:text-[var(--accent)]">
                        {row.raceName}
                      </Link>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        {row.raceDate} · {row.trackName} · {row.fieldSize} cars
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <p className="font-bold text-white">{row.actualWinner}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">Finished P{row.actualFinish}</p>
                    </td>
                    <td className="px-3 py-4 text-center">
                      <p className={`text-lg font-black ${rankTone(row.xgbRank)}`}>#{row.xgbRank}</p>
                      <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">
                        Fav {row.xgbFavorite} · {pct(row.xgbFavoriteProbability)}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-center">
                      <p className={`text-lg font-black ${rankTone(row.agentRank ?? 99)}`}>#{row.agentRank ?? "--"}</p>
                      <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">
                        Fav {row.agentFavorite ?? "--"}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <p className="font-mono text-xs text-white">
                        Start {row.winnerStart ?? "--"} · Heat {row.winnerHeat ?? "--"} · QT {row.winnerQtRank ?? "--"}
                      </p>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        XGB gave winner {pct(row.xgbProbability)}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex max-w-[300px] flex-wrap gap-1.5">
                        {winnerSignalBadges(row).map((signal) => (
                          <span key={signal} className="border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-amber-200">
                            {signal}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                        Deep T3 {row.priorDeepStartTop3Count} · Last5 +/- {row.last5PlusMinusAvg ?? "--"}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      {row.gaps.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {row.gaps.map((gap) => (
                            <span key={gap} className="border border-red-400/25 bg-red-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-red-200">
                              Missing {gap}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="border border-green-400/25 bg-green-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-green-200">
                          Complete
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <div className="p-5">
            <p className="text-sm text-[var(--muted)]">
              No crown replay file yet. Generate it after retraining:
            </p>
            <p className="mt-3 break-words bg-[#0b0d10] p-3 font-mono text-xs text-amber-300">
              npm run crown:replay
            </p>
          </div>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent)]">
              Historic backfill
            </p>
            <h2 className="mt-1 text-xl font-black uppercase text-white">Older Crown Results To Add</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Prioritize official pages with finish, start, and heat positions. QT stays a gap unless the source actually lists it.
            </p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {historicalBackfill.candidates.slice(0, 8).map((race) => (
              <div key={race.raceId} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/admin/races/${race.raceId}`} className="font-bold text-white hover:text-[var(--accent)]">
                      {race.raceName}
                    </Link>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      {race.raceDate} · {race.trackName}
                    </p>
                  </div>
                  <span className={`border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                    race.priority === "High"
                      ? "border-red-500/30 bg-red-500/10 text-red-300"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  }`}>
                    {race.priority}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Missing: {race.reason}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
                  {[
                    ["Entries", race.entries],
                    ["Finish", race.finishes],
                    ["Start", race.starts],
                    ["Heat", race.heats],
                    ["QT", race.qualifying],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="border border-[var(--border)] bg-[#0b0d10] p-2">
                      <p className="font-mono text-sm font-black text-white">{value}</p>
                      <p className="text-[10px] text-[var(--muted)]">{label}</p>
                    </div>
                  ))}
                </div>
                {race.command ? (
                  <p className="mt-3 break-words bg-[#0b0d10] p-2 font-mono text-[11px] leading-5 text-amber-300">
                    {race.command}
                  </p>
                ) : null}
              </div>
            ))}
            {historicalBackfill.candidates.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[var(--muted)]">No crown backfill gaps found.</p>
            ) : null}
          </div>
        </div>

        <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-base font-bold text-white">Future Crown Tests</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Keep these separate from training until after they run.
          </p>
          <div className="mt-4 space-y-3">
            {historicalBackfill.futureTests.map((race) => (
              <Link
                key={race.raceId}
                href={`/admin/races/${race.raceId}`}
                className="block border border-[var(--border)] bg-[var(--surface-raised)] p-3 hover:border-[var(--accent)]/60"
              >
                <p className="text-sm font-bold text-white">{race.raceName}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{race.raceDate} · {race.trackName}</p>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{race.note}</p>
              </Link>
            ))}
            {historicalBackfill.futureTests.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No WVMS crown tests loaded yet.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="text-base font-bold text-white">Validation Checklist</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Use this only to keep the model testing loop clean.
            </p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {modelingTodos.map((task) => (
              <label
                key={task.id}
                className="grid cursor-pointer gap-3 px-4 py-4 transition-colors hover:bg-[var(--surface-raised)] md:grid-cols-[auto_1fr_auto] md:px-5"
              >
                <input
                  type="checkbox"
                  checked={Boolean(completed[task.id])}
                  onChange={() => toggleTask(task.id)}
                  className="mt-1 h-4 w-4 accent-amber-500"
                />
                <span>
                  <span
                    className={`block text-sm font-semibold ${
                      completed[task.id] ? "text-slate-500 line-through" : "text-white"
                    }`}
                  >
                    {task.title}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-[var(--muted)]">
                    {task.detail}
                  </span>
                </span>
                <span
                  className={`h-fit border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${laneClass[task.lane]}`}
                >
                  {task.lane}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-base font-bold text-white">Model Rules</h2>
          <div className="mt-4 space-y-3">
            {modelIterationRules.map((rule) => (
              <div key={rule.label} className="border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <p className="text-sm font-bold text-white">{rule.label}</p>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{rule.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid gap-px bg-[var(--border)] lg:grid-cols-[1fr_420px]">
          <div className="bg-[var(--surface)] px-5 py-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent)]">
              Historical testing
            </p>
            <h2 className="mt-1 text-xl font-black uppercase text-white">Iterate With Completed Races</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Replay old races, compare winner rank, label why the model hit or missed,
              and mark which signals deserve a real feature test.
            </p>
          </div>
          <div className="grid grid-cols-3 bg-[#101010]">
            {[
              { label: "Races", value: historical.summary.races.toString() },
              { label: "Early T3", value: rate(historical.summary.earlyTop3, historical.summary.races) },
              { label: "Night T3", value: rate(historical.summary.raceNightTop3, historical.summary.races) },
            ].map((item) => (
              <div key={item.label} className="border-l border-[var(--border)] px-4 py-5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">{item.label}</p>
                <p className="mt-2 font-mono text-2xl font-black text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[1fr_340px]">
          <div className="space-y-3 md:hidden">
            {historical.rows.map((row) => (
              <div key={row.raceId} className="border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <Link href={`/admin/races/${row.raceId}`} className="font-bold text-white hover:text-[var(--accent)]">
                  {row.raceName}
                </Link>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {row.raceDate} · {row.trackName} · {row.fieldSize} cars
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="border border-[var(--border)] bg-[#0b0d10] p-2">
                    <p className="text-[10px] text-[var(--muted)]">Winner</p>
                    <p className="mt-1 break-words text-xs font-bold text-white">{row.winner}</p>
                  </div>
                  <div className="border border-[var(--border)] bg-[#0b0d10] p-2">
                    <p className="text-[10px] text-[var(--muted)]">Early</p>
                    <p className={`mt-1 text-sm font-black ${rankTone(row.earlyWinnerRank)}`}>#{row.earlyWinnerRank}</p>
                  </div>
                  <div className="border border-[var(--border)] bg-[#0b0d10] p-2">
                    <p className="text-[10px] text-[var(--muted)]">Night</p>
                    <p className={`mt-1 text-sm font-black ${rankTone(row.raceNightWinnerRank)}`}>#{row.raceNightWinnerRank}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Suggested: {row.missReason}</p>
                <div className="mt-3">
                  <ModelRaceReviewForm
                    raceId={row.raceId}
                    suggestedReason={row.missReason}
                    review={row.review}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[#0b0d10] text-[10px] uppercase tracking-widest text-[var(--muted)]">
                  <th className="px-3 py-3 text-left">Race</th>
                  <th className="px-3 py-3 text-left">Winner</th>
                  <th className="px-3 py-3 text-center">Early</th>
                  <th className="px-3 py-3 text-center">Race Night</th>
                  <th className="px-3 py-3 text-left">Speed Signal</th>
                  <th className="px-3 py-3 text-left">Review</th>
                </tr>
              </thead>
              <tbody>
                {historical.rows.map((row) => (
                  <tr key={row.raceId} className="border-b border-[var(--border)] align-top last:border-0">
                    <td className="px-3 py-4">
                      <Link href={`/admin/races/${row.raceId}`} className="font-bold text-white hover:text-[var(--accent)]">
                        {row.raceName}
                      </Link>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {row.raceDate} · {row.trackName} · {row.division} · {row.fieldSize} cars
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <p className="font-bold text-white">{row.winner}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Start {row.winnerStart ?? "--"} · QT {row.winnerQtRank ?? "--"}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-center">
                      <p className={`text-lg font-black ${row.earlyWinnerRank === 1 ? "text-green-300" : row.earlyWinnerRank <= 3 ? "text-amber-300" : "text-slate-400"}`}>
                        #{row.earlyWinnerRank}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--muted)]">{row.earlyFavorite} P{row.earlyFavoriteFinish ?? "--"}</p>
                    </td>
                    <td className="px-3 py-4 text-center">
                      <p className={`text-lg font-black ${row.raceNightWinnerRank === 1 ? "text-green-300" : row.raceNightWinnerRank <= 3 ? "text-amber-300" : "text-slate-400"}`}>
                        #{row.raceNightWinnerRank}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--muted)]">{row.raceNightFavorite} P{row.raceNightFavoriteFinish ?? "--"}</p>
                    </td>
                    <td className="px-3 py-4">
                      <p className="font-semibold text-white">{row.quickTimeDriver ?? "No QT"}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {row.quickTimeDriver ? `Finished P${row.quickTimeFinish ?? "--"}` : "Needs qualifying data"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {[
                          ["QT", row.hasQualifying],
                          ["Start", row.hasStartingLineup],
                          ["Heat", row.hasHeatData],
                        ].map(([label, active]) => (
                          <span
                            key={String(label)}
                            className={`border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                              active
                                ? "border-green-400/25 bg-green-400/10 text-green-200"
                                : "border-slate-500/25 bg-slate-500/10 text-slate-400"
                            }`}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <p className="mb-3 text-xs leading-5 text-[var(--muted)]">Suggested: {row.missReason}</p>
                      <ModelRaceReviewForm
                        raceId={row.raceId}
                        suggestedReason={row.missReason}
                        review={row.review}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-black uppercase tracking-widest text-white">Signals To Watch</h3>
            {historical.signals.map((signal) => (
              <div key={signal.label} className="border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{signal.label}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{signal.detail}</p>
                  </div>
                  <p className="font-mono text-xs text-amber-300">{signal.races}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="border border-[var(--border)] bg-[#0b0d10] p-2">
                    <p className="text-sm font-black text-white">{pct(signal.winRate)}</p>
                    <p className="text-[10px] text-[var(--muted)]">Win</p>
                  </div>
                  <div className="border border-[var(--border)] bg-[#0b0d10] p-2">
                    <p className="text-sm font-black text-white">{pct(signal.top3Rate)}</p>
                    <p className="text-[10px] text-[var(--muted)]">Top 3</p>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{signal.note}</p>
              </div>
            ))}
            <Link href="/admin/accuracy" className="block border border-[var(--border)] px-3 py-3 text-center text-xs font-black uppercase tracking-wider text-white hover:border-[var(--accent)]/60">
              Open full history
            </Link>
          </div>
        </div>
      </section>

      <section className="border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-white">Race Queue</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{activeSeason} upcoming model targets</p>
          </div>
          <Link href="/admin/races" className="border border-[var(--border)] px-3 py-2 text-xs font-semibold text-white hover:border-[var(--accent)]/60">
            Manage all
          </Link>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {upcoming.slice(1, 6).map((race) => {
            const winner = race.topPicks[0] ?? null;
            return (
              <Link key={race.id} href={`/admin/races/${race.id}/prediction`} className="grid gap-3 px-4 py-4 hover:bg-[var(--surface-raised)] md:grid-cols-[1fr_auto_auto] md:px-5">
                <span>
                  <span className="block font-semibold text-white">{race.name}</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    {fmt.format(new Date(`${race.raceDate}T12:00:00`))} · {race.trackName}
                  </span>
                </span>
                <span className="text-sm text-[var(--muted)]">{readinessLabel(race)}</span>
                <span className="font-mono text-sm text-amber-300">{winner ? `${winner.driverName} ${pct(winner.probability)}` : "Needs entries"}</span>
              </Link>
            );
          })}
          {upcoming.length <= 1 ? (
            <p className="px-5 py-6 text-sm text-[var(--muted)]">No additional upcoming model targets.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function readTaskStateSnapshot() {
  return window.localStorage.getItem(storageKey) ?? emptyTaskState;
}

function subscribeToTaskState(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === storageKey) {
      onStoreChange();
    }
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(storageChangeEvent, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(storageChangeEvent, onStoreChange);
  };
}

function parseTaskState(snapshot: string) {
  try {
    return JSON.parse(snapshot) as Record<string, boolean>;
  } catch {
    return {};
  }
}
