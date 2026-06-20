import { connection } from "next/server";
import Link from "next/link";

import { Nav } from "@/components/nav";
import { ModelRaceReviewForm } from "@/components/model-race-review-form";
import { getModelAccuracyDashboard } from "@/lib/model-accuracy";
import { getModelRaceReviewMap } from "@/lib/model-race-reviews";

function pct(n: number, d: number) {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "--";
}

function pctValue(value: number | null) {
  return value === null ? "--" : `${Math.round(value * 100)}%`;
}

function rankLabel(rank: number) {
  return `#${rank}`;
}

function toneForRank(rank: number) {
  if (rank === 1) return "text-green-300";
  if (rank <= 3) return "text-amber-300";
  return "text-slate-400";
}

function dataBadge(label: string, active: boolean) {
  return (
    <span
      className={`border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
        active
          ? "border-green-400/25 bg-green-400/10 text-green-200"
          : "border-slate-500/25 bg-slate-500/10 text-slate-400"
      }`}
    >
      {label}
    </span>
  );
}

export default async function AccuracyPage() {
  await connection();
  const dashboard = getModelAccuracyDashboard(90);
  const { summary } = dashboard;
  const reviewMap = getModelRaceReviewMap(dashboard.rows.map((row) => row.raceId));

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <section className="panel-raised overflow-hidden">
          <div className="grid gap-px bg-[var(--border)] lg:grid-cols-[1.3fr_0.7fr]">
            <div className="bg-[var(--surface)] p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--accent)]">
                Model accuracy
              </p>
              <h1
                style={{ fontFamily: "var(--font-display)" }}
                className="mt-3 text-4xl font-black uppercase leading-none text-white"
              >
                Historical prediction review
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Review completed races, favorite accuracy, winner rank, quick-time conversion, and the
                data gaps that should be fixed before retraining.
              </p>
            </div>
            <div className="grid grid-cols-3 bg-[var(--surface)]">
              {[
                { label: "Races", value: summary.races.toString(), detail: "recent audit" },
                { label: "Entries", value: summary.entries.toString(), detail: "scored rows" },
                { label: "QT Data", value: pct(summary.racesWithQualifying, summary.races), detail: "race coverage" },
              ].map((item) => (
                <div key={item.label} className="border-l border-[var(--border)] px-4 py-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                    {item.label}
                  </p>
                  <p className="mt-2 text-2xl font-black tabular-nums text-white">{item.value}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Early Top 1",
              value: pct(summary.earlyTop1, summary.races),
              sub: `${summary.earlyTop1}/${summary.races} winners ranked first`,
            },
            {
              label: "Early Top 3",
              value: pct(summary.earlyTop3, summary.races),
              sub: `${summary.earlyTop3}/${summary.races} winners in playable group`,
            },
            {
              label: "Race-Night Top 1",
              value: pct(summary.raceNightTop1, summary.races),
              sub: `${summary.raceNightTop1}/${summary.races} with QT/start inputs`,
            },
            {
              label: "Race-Night Top 3",
              value: pct(summary.raceNightTop3, summary.races),
              sub: `${summary.raceNightTop3}/${summary.races} with QT/start inputs`,
            },
          ].map((stat) => (
            <div key={stat.label} className="panel px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                {stat.label}
              </p>
              <p className="mt-2 text-3xl font-black tabular-nums text-white">{stat.value}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{stat.sub}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {dashboard.signals.map((signal) => (
            <div key={signal.label} className="border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-white">{signal.label}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{signal.detail}</p>
                </div>
                <span className="text-xs font-bold text-[var(--accent)]">{signal.races} races</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-px bg-[var(--border)]">
                <div className="bg-[var(--surface-raised)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Win</p>
                  <p className="mt-1 text-2xl font-black text-white">{pctValue(signal.winRate)}</p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">{signal.wins}/{signal.races}</p>
                </div>
                <div className="bg-[var(--surface-raised)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Top 3</p>
                  <p className="mt-1 text-2xl font-black text-white">{pctValue(signal.top3Rate)}</p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">{signal.top3}/{signal.races}</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{signal.note}</p>
            </div>
          ))}
        </section>

        <section className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="text-base font-black text-white">Race Review Table</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                Early form excludes qualifying and lineup. Race-night form includes quick-time, heat, and start data.
              </p>
            </div>
            <Link
              href="/admin/testing"
              className="border border-[var(--border)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)] hover:text-white"
            >
              Model Lab
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                  {[
                    "Race",
                    "Winner",
                    "Early Rank",
                    "Race-Night Rank",
                    "Favorite",
                    "Quick Time",
                    "Data",
                    "Review",
                  ].map((head) => (
                    <th
                      key={head}
                      className={`px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] ${
                        ["Early Rank", "Race-Night Rank"].includes(head) ? "text-center" : "text-left"
                      }`}
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dashboard.rows.map((row) => (
                  <tr
                    key={row.raceId}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)]"
                  >
                    <td className="px-4 py-4">
                      <Link href={`/admin/races/${row.raceId}`} className="font-bold text-white hover:text-[var(--accent)]">
                        {row.raceName}
                      </Link>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {row.raceDate} · {row.trackName} · {row.division} · {row.fieldSize} cars
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-bold text-white">{row.winner}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Start {row.winnerStart ?? "--"} · QT {row.winnerQtRank ?? "--"}
                      </p>
                    </td>
                    <td className={`px-4 py-4 text-center text-lg font-black ${toneForRank(row.earlyWinnerRank)}`}>
                      {rankLabel(row.earlyWinnerRank)}
                    </td>
                    <td className={`px-4 py-4 text-center text-lg font-black ${toneForRank(row.raceNightWinnerRank)}`}>
                      {rankLabel(row.raceNightWinnerRank)}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold text-white">{row.raceNightFavorite}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Finished P{row.raceNightFavoriteFinish ?? "--"}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      {row.quickTimeDriver ? (
                        <>
                          <p className="font-semibold text-white">{row.quickTimeDriver}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Finished P{row.quickTimeFinish}
                            {row.quickTimeWon ? " · won" : row.quickTimeTop3 ? " · top 3" : ""}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">No qualifying</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {dataBadge("QT", row.hasQualifying)}
                        {dataBadge("Start", row.hasStartingLineup)}
                        {dataBadge("Heat", row.hasHeatData)}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <p className="mb-3 text-xs leading-5 text-[var(--muted)]">
                        Suggested: {row.missReason}
                      </p>
                      <ModelRaceReviewForm
                        raceId={row.raceId}
                        suggestedReason={row.missReason}
                        review={reviewMap.get(row.raceId) ?? null}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
