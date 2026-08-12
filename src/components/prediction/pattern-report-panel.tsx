"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createUnderwritingNoteAction } from "@/app/actions";
import type { PatternAnalysis } from "@/lib/pattern-analysis";

type PatternReportPanelProps = {
  raceId: number;
  trackId: number;
  raceName: string;
  trackName: string;
  entries: Array<{ driverId?: number; driverName: string; carNumber: string | null }>;
  analysis: PatternAnalysis;
};

export function PatternReportPanel({
  raceId,
  trackId,
  raceName,
  trackName,
  entries,
  analysis,
}: PatternReportPanelProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lookback, setLookback] = useState("10");
  const [report, setReport] = useState(() =>
    buildPatternTemplate(raceName, trackName, "10", entries)
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entryList = useMemo(
    () =>
      entries
        .map((entry) => `${entry.carNumber ? `${entry.carNumber} ` : ""}${entry.driverName}`)
        .join(", "),
    [entries]
  );

  function resetTemplate(nextLookback = lookback) {
    setReport(buildPatternTemplate(raceName, trackName, nextLookback, entries));
  }

  function saveReport() {
    setError(null);
    setSaving(true);

    startTransition(async () => {
      const result = await createUnderwritingNoteAction({
        raceId,
        trackId,
        scope: "race",
        noteType: "pattern_report",
        title: `Pattern report: ${raceName}`,
        note: report,
        sourceUrl,
      });

      setSaving(false);
      if (result.error) {
        setError(result.error);
        return;
      }

      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-purple-500/30 bg-[var(--surface)] overflow-hidden">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-purple-300">
              Pattern Analysis
            </p>
            <h2 className="mt-1 text-base font-bold text-white">Race Trend Report</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Build the historical filter, then save full fits, partial fits, eliminations, and caveats to this race.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
            Last
            <input
              value={lookback}
              onChange={(event) => {
                setLookback(event.target.value);
                resetTemplate(event.target.value);
              }}
              className="w-16 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-sm font-semibold text-white outline-none focus:border-[var(--accent)]"
            />
            runnings
          </label>
        </div>
      </div>

      <div className="border-b border-[var(--border)] p-5">
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">Auto Pattern Read</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Last {analysis.winners.length}/{analysis.lookback} from {analysis.basis}. {analysis.bridgeNote}
                </p>
              </div>
              <span className="border border-purple-400/30 bg-purple-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-purple-200">
                75% filter
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {analysis.criteria.length > 0 ? (
                analysis.criteria.map((criterion) => (
                  <div key={criterion.key} className="flex items-center justify-between gap-3 border border-[var(--border)] bg-[#0b0d10] px-3 py-2">
                    <span className="text-xs font-semibold text-white">{criterion.label}</span>
                    <span className="font-mono text-xs text-amber-300">
                      {criterion.matched}/{criterion.total}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs leading-5 text-[var(--muted)]">
                  No 75% winner filter yet. That usually means the local historical sample is thin or mixed across event types.
                </p>
              )}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-widest text-[var(--muted)]">
                    <th className="py-2 text-left">Winner</th>
                    <th className="py-2 text-left">Race</th>
                    <th className="py-2 text-right">Wins</th>
                    <th className="py-2 text-right">Prev</th>
                    <th className="py-2 text-right">Last 5</th>
                    <th className="py-2 text-right">Track</th>
                    <th className="py-2 text-right">Start</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.winners.slice(0, 10).map((winner) => (
                    <tr key={winner.raceId} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 pr-3 font-semibold text-white">{winner.winner}</td>
                      <td className="py-2 pr-3 text-[var(--muted)]">
                        {winner.raceDate} · {winner.month}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-white">{winner.seasonWinsAtRaceTime}</td>
                      <td className="py-2 pr-3 text-right text-[var(--muted)]">{winner.wonPreviousEvent ? "Y" : "N"}</td>
                      <td className="py-2 pr-3 text-right text-[var(--muted)]">{winner.wonInLast5 ? "Y" : "N"}</td>
                      <td className="py-2 pr-3 text-right text-[var(--muted)]">{winner.priorWinAtTrack ? "Win" : winner.priorTop3AtTrack ? "T3" : "N"}</td>
                      <td className="py-2 text-right font-mono text-[var(--muted)]">{winner.startingPosition ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <h3 className="text-sm font-bold text-white">This Field Fit</h3>
            <div className="mt-4 space-y-2">
              {analysis.field.slice(0, 12).map((driver) => (
                <div key={driver.driverId} className="border border-[var(--border)] bg-[#0b0d10] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-white">{driver.driverName}</p>
                      <p className="mt-1 text-[11px] text-[var(--muted)]">
                        {driver.matched}/{driver.total || 0} matched
                        {driver.lucasStanding ? ` · LOLMDS P${driver.lucasStanding}` : ""}
                        {driver.lucasWins ? ` · ${driver.lucasWins} Lucas wins` : ""}
                      </p>
                    </div>
                    <span className={`border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                      driver.fit === "Full"
                        ? "border-green-400/30 bg-green-400/10 text-green-200"
                        : driver.fit === "Partial"
                          ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                          : "border-slate-500/30 bg-slate-500/10 text-slate-300"
                    }`}>
                      {driver.fit}
                    </span>
                  </div>
                  {driver.missing.length > 0 ? (
                    <p className="mt-2 text-[11px] leading-4 text-[var(--muted)]">
                      Missing: {driver.missing.slice(0, 2).join("; ")}
                    </p>
                  ) : null}
                </div>
              ))}
              {analysis.field.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">No entries attached yet.</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <textarea
            value={report}
            onChange={(event) => setReport(event.target.value)}
            rows={14}
            className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-[var(--accent)]"
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="Optional source URL"
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => resetTemplate()}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:border-[var(--accent)]/60"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={saveReport}
              disabled={saving || !report.trim()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Report"}
            </button>
          </div>
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <h3 className="text-sm font-bold text-white">Entry List</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              {entryList || "No entries attached yet."}
            </p>
          </div>
          {[
            "Season wins at race time",
            "Won previous event",
            "Won in last 5 starts",
            "Prior win at this track",
            "Starting position",
            "Month of season",
            "2026 LOLMDS standing",
          ].map((field) => (
            <div
              key={field}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs font-semibold text-slate-200"
            >
              {field}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function buildPatternTemplate(
  raceName: string,
  trackName: string,
  lookback: string,
  entries: Array<{ driverId?: number; driverName: string; carNumber: string | null }>
) {
  const entryList = entries.map((entry) => entry.driverName).join(", ");

  return `DirtIQ pattern analysis for ${raceName} at ${trackName}.

Pull the last ${lookback || "[N]"} runnings. For each winner, fill:
- Season wins at race time:
- Won previous event Y/N:
- Won in last 5 Y/N:
- Prior win at this track Y/N:
- Starting position:
- Month of season:
- 2026 LOLMDS standing:

Conjunctive filter:
- Criteria appearing in 75%+ of winners:
- Full-profile threshold:
- Partial-profile threshold:

Apply to this year's entry list:
${entryList || "[paste entry list]"}

Full profile:
-

Partial profile:
-

Eliminated:
-

Model caveat:
- Keep as caveat unless the signal repeats across enough races to audit as a feature.`;
}
