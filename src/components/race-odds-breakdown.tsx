"use client";
import { useState } from "react";

// Mirror of ReasoningFactors from odds.ts (serialized, no server-only)
type Reasoning = {
  trackWinRate: number | null; trackStarts: number;
  lastEventHere: number | null;
  similarTrackWinRate: number | null; similarTrackStarts: number;
  seasonWinRate: number | null; seasonStarts: number;
  avgFinish: number | null; last5AvgFinish: number | null;
  streak: number; streakType: "win" | "podium" | "top5" | "none";
  tonightHeatPos: number | null; tonightQtRank: number | null; tonightQtRunners: number;
  startingPosition: number | null; startingPosWinRate: number | null; startingPosStarts: number;
  quickTimeRate: number | null; heatWinRate: number | null;
  distanceWinRate: number | null; distanceStarts: number;
  dnfRate: number | null;
  featurePlusMinus: number | null; featurePmRaces: number;
  conditionWinRate: number | null; conditionStarts: number;
  specialtyBonus: number;
  compositeScore: number;
  metricSeries: string;
  highlights: string[]; warnings: string[];
};

type DriverOdds = {
  driverId: number; driverName: string; carNumber: string | null;
  americanOdds: string; impliedProbability: number; rawScore: number; eloRating: number;
  reasoning: Reasoning;
};

type FactorRow = {
  id: string; label: string; value: string;
  maxWeight: number; contribution: number;
  status: "good" | "ok" | "bad" | "empty";
};

function pct(n: number | null, d = 0) {
  if (n === null) return "—";
  return `${(n * 100).toFixed(d)}%`;
}

function buildFactors(r: Reasoning, fieldSize: number): FactorRow[] {
  const rows: FactorRow[] = [];

  // 1. Track Win Rate (0.25 with ≥3 starts, 0.13 with 1-2)
  const tw = r.trackStarts >= 3 ? 0.25 : r.trackStarts >= 1 ? 0.13 : 0;
  rows.push({
    id: "track_wr", label: "Track Win Rate",
    value: r.trackWinRate !== null ? `${pct(r.trackWinRate)} (${r.trackStarts} starts)` : `No history (${r.trackStarts} starts)`,
    maxWeight: 0.25, contribution: (r.trackWinRate ?? 0) * tw,
    status: tw === 0 ? "empty" : (r.trackWinRate ?? 0) >= 0.35 ? "good" : "ok",
  });

  // 2. Last Event Here (0.10)
  let lastScore = 0;
  if (r.lastEventHere !== null && r.lastEventHere > 0) {
    const p = r.lastEventHere;
    lastScore = p === 1 ? 1.0 : p <= 3 ? 0.75 : p <= 5 ? 0.55 : p <= 10 ? 0.35 : Math.max(0, (fieldSize - p) / fieldSize);
  }
  rows.push({
    id: "last_here", label: "Last Race Here",
    value: r.lastEventHere !== null && r.lastEventHere > 0 ? `P${r.lastEventHere}` : "No prior race here",
    maxWeight: 0.10, contribution: lastScore * 0.10,
    status: r.lastEventHere === null ? "empty" : r.lastEventHere <= 3 ? "good" : r.lastEventHere <= 8 ? "ok" : "bad",
  });

  // 3. Similar Track WR (0.20)
  rows.push({
    id: "sim_wr", label: "Similar-Track WR",
    value: r.similarTrackWinRate !== null ? `${pct(r.similarTrackWinRate)} (${r.similarTrackStarts} wt. starts)` : "No similar-track data",
    maxWeight: 0.20, contribution: (r.similarTrackWinRate ?? 0) * 0.20,
    status: r.similarTrackWinRate === null ? "empty" : r.similarTrackWinRate >= 0.25 ? "good" : "ok",
  });

  // 4. Season Win Rate (0.15)
  rows.push({
    id: "season_wr", label: "Season Win Rate",
    value: r.seasonWinRate !== null ? `${pct(r.seasonWinRate)} (${r.seasonStarts} starts)` : "No season data",
    maxWeight: 0.15, contribution: (r.seasonWinRate ?? 0) * 0.15,
    status: r.seasonWinRate === null ? "empty" : r.seasonWinRate >= 0.25 ? "good" : r.seasonWinRate >= 0.08 ? "ok" : "bad",
  });

  // 5. Streak (0.12)
  const streakScore = r.streak > 0 ? Math.min(1, r.streak / 4) : 0;
  rows.push({
    id: "streak", label: `Streak (${r.streakType})`,
    value: r.streak > 0 ? `${r.streak} consecutive ${r.streakType}${r.streak > 1 ? "s" : ""}` : "No active streak",
    maxWeight: 0.12, contribution: streakScore * 0.12,
    status: r.streak === 0 ? "empty" : r.streak >= 3 ? "good" : "ok",
  });

  // 6. Avg Feature Finish (0.10)
  const avgFinScore = r.avgFinish !== null ? Math.max(0, (fieldSize - r.avgFinish) / fieldSize) : 0;
  rows.push({
    id: "avg_finish", label: "Avg Feature Finish",
    value: r.avgFinish !== null ? r.avgFinish.toFixed(1) : "—",
    maxWeight: 0.10, contribution: avgFinScore * 0.10,
    status: r.avgFinish === null ? "empty" : r.avgFinish <= 5 ? "good" : r.avgFinish <= 10 ? "ok" : "bad",
  });

  // 7. Last 5 Momentum (0.10)
  const last5Score = r.last5AvgFinish !== null ? Math.max(0, (fieldSize - r.last5AvgFinish) / fieldSize) : 0;
  rows.push({
    id: "last5", label: "Last 5 Momentum",
    value: r.last5AvgFinish !== null ? `${r.last5AvgFinish.toFixed(1)} avg` : "—",
    maxWeight: 0.10, contribution: last5Score * 0.10,
    status: r.last5AvgFinish === null ? "empty" : r.last5AvgFinish <= 4.5 ? "good" : r.last5AvgFinish >= 14 ? "bad" : "ok",
  });

  // 8. Distance Bucket WR (0.08)
  rows.push({
    id: "dist_wr", label: "Distance Bucket WR",
    value: r.distanceWinRate !== null ? `${pct(r.distanceWinRate)} (${r.distanceStarts} starts)` : "—",
    maxWeight: 0.08, contribution: (r.distanceWinRate ?? 0) * 0.08,
    status: r.distanceWinRate === null ? "empty" : r.distanceWinRate >= 0.25 ? "good" : "ok",
  });

  // 9. Quick Time Rate (0.07)
  rows.push({
    id: "qt_rate", label: "Quick Time Rate",
    value: r.quickTimeRate !== null ? pct(r.quickTimeRate) : "—",
    maxWeight: 0.07, contribution: (r.quickTimeRate ?? 0) * 0.07,
    status: r.quickTimeRate === null ? "empty" : r.quickTimeRate >= 0.25 ? "good" : "ok",
  });

  // 10. Heat Win Rate (0.06)
  rows.push({
    id: "heat_wr", label: "Season Heat Win Rate",
    value: r.heatWinRate !== null ? pct(r.heatWinRate) : "—",
    maxWeight: 0.06, contribution: (r.heatWinRate ?? 0) * 0.06,
    status: r.heatWinRate === null ? "empty" : r.heatWinRate >= 0.45 ? "good" : "ok",
  });

  // 11. DNF Risk (penalty)
  const dnfPenalty = r.dnfRate !== null && r.dnfRate > 0.12 ? -(r.dnfRate * 0.12) : 0;
  rows.push({
    id: "dnf", label: "DNF Risk",
    value: r.dnfRate !== null ? pct(r.dnfRate) : "—",
    maxWeight: 0.12, contribution: dnfPenalty,
    status: dnfPenalty < -0.01 ? "bad" : "empty",
  });

  // 12. Feature +/- (0.05)
  const pmScore = r.featurePlusMinus !== null && r.featurePmRaces >= 3
    ? Math.max(0, Math.min(1, (r.featurePlusMinus + 10) / 20)) : 0;
  rows.push({
    id: "feature_pm", label: "Feature +/−",
    value: r.featurePlusMinus !== null ? (r.featurePlusMinus >= 0 ? `+${r.featurePlusMinus.toFixed(1)}` : r.featurePlusMinus.toFixed(1)) + ` pos (${r.featurePmRaces} races)` : `—`,
    maxWeight: 0.05, contribution: pmScore * 0.05,
    status: r.featurePlusMinus === null ? "empty" : r.featurePlusMinus >= 3 ? "good" : r.featurePlusMinus <= -3 ? "bad" : "ok",
  });

  // 13. Tonight Heat (0.20) — active signal
  const heatBonusScore = r.tonightHeatPos !== null
    ? Math.max(0, (fieldSize - (r.tonightHeatPos - 1)) / fieldSize) : 0;
  rows.push({
    id: "tonight_heat", label: "Tonight Heat Finish",
    value: r.tonightHeatPos !== null ? `P${r.tonightHeatPos}` : "Not set",
    maxWeight: 0.20, contribution: heatBonusScore * 0.20,
    status: r.tonightHeatPos === null ? "empty" : r.tonightHeatPos <= 3 ? "good" : r.tonightHeatPos <= Math.ceil(fieldSize * 0.5) ? "ok" : "bad",
  });

  // 14. Tonight QT (0.10) — active signal
  const qtBonusScore = r.tonightQtRank !== null && r.tonightQtRunners >= 3
    ? Math.max(0, (r.tonightQtRunners - (r.tonightQtRank - 1)) / r.tonightQtRunners) : 0;
  rows.push({
    id: "tonight_qt", label: "Tonight QT Rank",
    value: r.tonightQtRank !== null ? `P${r.tonightQtRank} of ${r.tonightQtRunners}` : "Not set",
    maxWeight: 0.10, contribution: qtBonusScore * 0.10,
    status: r.tonightQtRank === null ? "empty" : r.tonightQtRank <= 3 ? "good" : "ok",
  });

  // 15. Starting Position (0.12) — active signal
  let startContrib = 0;
  if (r.startingPosition !== null) {
    const posAdv = Math.max(0, (fieldSize - (r.startingPosition - 1)) / fieldSize);
    const conv = r.startingPosWinRate ?? posAdv * 0.5;
    startContrib = (0.60 * posAdv + 0.40 * conv) * 0.12;
  }
  rows.push({
    id: "start_pos", label: "Feature Start Pos",
    value: r.startingPosition !== null
      ? `P${r.startingPosition}${r.startingPosWinRate !== null ? ` · ${pct(r.startingPosWinRate)} hist. conv.` : ""}`
      : "Lineup not posted",
    maxWeight: 0.12, contribution: startContrib,
    status: r.startingPosition === null ? "empty" : r.startingPosition <= 4 ? "good" : r.startingPosition <= 10 ? "ok" : "bad",
  });

  // 16. Specialty Bonus (manual / AI-set)
  if (r.specialtyBonus > 0) {
    rows.push({
      id: "specialty", label: "Track Specialty Bonus",
      value: `+${(r.specialtyBonus * 100).toFixed(0)} pts`,
      maxWeight: r.specialtyBonus, contribution: r.specialtyBonus,
      status: "good",
    });
  }

  return rows;
}

function OddsChip({ odds }: { odds: string }) {
  const isNeg = odds.startsWith("-");
  return (
    <span className={`inline-block rounded-lg px-3 py-1 text-sm font-bold tabular-nums font-mono ${
      isNeg ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "bg-slate-700/60 text-white"
    }`}>{odds}</span>
  );
}

function ContribBar({ contribution, maxWeight }: { contribution: number; maxWeight: number }) {
  const isNeg = contribution < 0;
  const fill = maxWeight > 0 ? Math.min(1, Math.abs(contribution) / maxWeight) : 0;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="w-20 h-1.5 rounded-full bg-slate-800 shrink-0">
        <div
          className={`h-1.5 rounded-full ${isNeg ? "bg-red-500/70" : fill > 0.6 ? "bg-[var(--accent)]" : fill > 0.3 ? "bg-amber-500" : "bg-slate-600"}`}
          style={{ width: `${fill * 100}%` }}
        />
      </div>
      <span className={`text-[10px] tabular-nums font-mono w-12 ${
        isNeg ? "text-red-400" : contribution > 0.05 ? "text-[var(--accent)]" : "text-slate-500"
      }`}>
        {contribution === 0 ? "—" : isNeg ? contribution.toFixed(3) : `+${contribution.toFixed(3)}`}
      </span>
    </div>
  );
}

function DriverCard({
  d, rank, fieldSize, totalComposite,
}: {
  d: DriverOdds; rank: number; fieldSize: number; totalComposite: number;
}) {
  const [open, setOpen] = useState(false);
  const factors = buildFactors(d.reasoning, fieldSize);
  const r = d.reasoning;

  const impliedPct = (d.impliedProbability * 100).toFixed(1);
  const eloDisplay = d.eloRating > 0 ? d.eloRating.toFixed(0) : "—";

  // Sort factors by contribution descending (positives first, then empty, then penalties)
  const sortedFactors = [...factors].sort((a, b) => {
    if (a.contribution < 0 && b.contribution >= 0) return 1;
    if (b.contribution < 0 && a.contribution >= 0) return -1;
    return b.contribution - a.contribution;
  });

  const activePrelim = r.tonightHeatPos !== null || r.tonightQtRank !== null || r.startingPosition !== null;

  return (
    <div className={`rounded-2xl border bg-[var(--surface)] overflow-hidden transition-colors ${
      rank === 1 ? "border-[var(--accent)]/40" : "border-[var(--border)]"
    }`}>
      {/* Driver header row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-4 px-5 py-4 hover:bg-[var(--surface-raised)] transition-colors text-left"
      >
        {/* Rank */}
        <div className="w-6 shrink-0 pt-0.5">
          <span className={`text-sm font-bold tabular-nums ${rank === 1 ? "text-[var(--accent)]" : "text-slate-500"}`}>
            {rank}
          </span>
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-white">{d.driverName}</span>
            {d.carNumber && <span className="text-xs font-mono text-amber-400">#{d.carNumber}</span>}
            <span className="text-[9px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-300 border border-blue-500/30 rounded px-1.5 py-0.5">
              {r.metricSeries}
            </span>
            {activePrelim && (
              <span className="text-[9px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded px-1.5 py-0.5">
                Live Data
              </span>
            )}
            {r.specialtyBonus > 0 && (
              <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">
                Specialist
              </span>
            )}
          </div>
          {/* Highlights + warnings */}
          {r.highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {r.highlights.slice(0, 3).map((h, i) => (
                <span key={i} className="text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-0.5">
                  {h}
                </span>
              ))}
              {r.warnings.slice(0, 2).map((w, i) => (
                <span key={i} className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">
                  ⚠ {w}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Odds + probability */}
        <div className="shrink-0 text-right space-y-1">
          <OddsChip odds={d.americanOdds} />
          <div className="text-[10px] text-[var(--muted)] tabular-nums">{impliedPct}% implied</div>
        </div>

        {/* Score bar */}
        <div className="shrink-0 w-20 pt-1.5 hidden sm:block">
          <div className="h-1 rounded-full bg-slate-800">
            <div
              className="h-1 rounded-full bg-[var(--accent)]"
              style={{ width: `${Math.min(100, (d.rawScore / (totalComposite / fieldSize * 2)) * 100)}%` }}
            />
          </div>
          <div className="text-[9px] text-slate-600 tabular-nums mt-0.5 text-right">
            Elo {eloDisplay}
          </div>
        </div>

        <div className="shrink-0 pt-1 text-slate-600 text-xs">{open ? "▲" : "▼"}</div>
      </button>

      {/* Expanded factor breakdown */}
      {open && (
        <div className="border-t border-[var(--border)]">
          {/* Score summary */}
          <div className="flex gap-6 px-5 py-3 bg-[var(--surface-raised)] text-xs">
            <div>
              <span className="text-[var(--muted)]">Composite </span>
              <span className="text-white font-bold tabular-nums">{r.compositeScore.toFixed(4)}</span>
            </div>
            <div>
              <span className="text-[var(--muted)]">Elo rating </span>
              <span className="text-white font-bold tabular-nums">{eloDisplay}</span>
            </div>
            <div>
              <span className="text-[var(--muted)]">Implied prob </span>
              <span className="text-[var(--accent)] font-bold tabular-nums">{impliedPct}%</span>
            </div>
            <div>
              <span className="text-[var(--muted)]">Profile </span>
              <span className="text-blue-300 font-bold">{r.metricSeries}</span>
            </div>
            <div>
              <span className="text-[var(--muted)]">Elo blend </span>
              <span className="text-white tabular-nums">{activePrelim ? "30/70" : "45/55"}</span>
            </div>
          </div>

          {/* Factor table */}
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Factor", "Value", "Max wt.", "Contribution"].map((h) => (
                  <th key={h} className={`px-4 py-2 text-[9px] uppercase tracking-widest text-[var(--muted)] font-semibold ${h === "Factor" || h === "Value" ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedFactors.map((f) => (
                <tr key={f.id} className={`border-b border-[var(--border)] last:border-0 ${
                  f.status === "empty" ? "opacity-40" : ""
                } ${f.contribution > 0.05 ? "bg-[var(--accent)]/3" : ""}`}>
                  <td className="px-4 py-2 font-medium text-white whitespace-nowrap">{f.label}</td>
                  <td className={`px-4 py-2 max-w-xs truncate ${
                    f.status === "good" ? "text-green-400" :
                    f.status === "bad" ? "text-red-400" :
                    "text-[var(--muted)]"
                  }`}>{f.value}</td>
                  <td className="px-4 py-2 text-right text-slate-500 tabular-nums">
                    {f.maxWeight > 0 ? (f.maxWeight * 100).toFixed(0) + "%" : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end">
                      <ContribBar contribution={f.contribution} maxWeight={f.maxWeight} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* All highlights */}
          {(r.highlights.length > 3 || r.warnings.length > 2) && (
            <div className="px-4 py-3 border-t border-[var(--border)] flex flex-wrap gap-1.5">
              {r.highlights.slice(3).map((h, i) => (
                <span key={i} className="text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-0.5">{h}</span>
              ))}
              {r.warnings.slice(2).map((w, i) => (
                <span key={i} className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">⚠ {w}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RaceOddsBreakdown({
  odds,
  fieldSize,
}: {
  odds: DriverOdds[];
  fieldSize: number;
}) {
  const [expandAll, setExpandAll] = useState(false);
  const totalComposite = odds.reduce((s, d) => s + d.rawScore, 0);

  if (odds.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="text-[var(--muted)]">No drivers entered yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted)]">
          {fieldSize} drivers · click any row to see all {16} factor contributions
        </p>
        <button
          onClick={() => setExpandAll((o) => !o)}
          className="text-xs text-[var(--muted)] hover:text-white border border-[var(--border)] rounded-lg px-3 py-1.5 transition-colors"
        >
          {expandAll ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {odds.map((d, i) => (
        <DriverCard
          key={d.driverId}
          d={d}
          rank={i + 1}
          fieldSize={fieldSize}
          totalComposite={totalComposite}
        />
      ))}
    </div>
  );
}
