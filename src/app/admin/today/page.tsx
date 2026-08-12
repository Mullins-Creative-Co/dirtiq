import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getTodayMarketBoards } from "@/lib/today-market-board";
import { todayDateString } from "@/lib/races";

function pct(value: number, decimals = 1) {
  return `${(value * 100).toFixed(decimals)}%`;
}

function formatTime(value: string | null) {
  if (!value) return "not published";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: string | null, isLive: number) {
  if (isLive) return "Live";
  if ((status ?? "open") === "open") return "Open";
  if (status === "locked") return "Locked";
  if (status === "settled") return "Settled";
  return status ?? "Open";
}

function toneForRecommendation(recommendation: string) {
  if (recommendation === "Play") return "border-green-500/35 bg-green-500/10 text-green-300";
  if (recommendation === "Lean") return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  return "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]";
}

export default async function TodayOddsPage() {
  await connection();
  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  const boards = plain(getTodayMarketBoards());
  const today = todayDateString();
  const lineCount = boards.reduce((sum, board) => sum + board.topOutrights.length, 0);
  const propCount = boards.reduce(
    (sum, board) => sum + board.propsByType.reduce((inner, group) => inner + group.lines.length, 0),
    0
  );

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Today Odds</p>
              <h1 className="mt-1 text-3xl font-black text-white">Current race-night board</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Today only. Focused late model races only. Use this for quick odds review, likely bets, and props without the model lab clutter.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)]">
              {[
                { label: "Date", value: today },
                { label: "Races", value: boards.length.toString() },
                { label: "Lines", value: `${lineCount}/${propCount}` },
              ].map((item) => (
                <div key={item.label} className="bg-[var(--surface-raised)] px-4 py-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{item.label}</p>
                  <p className="mt-1 text-sm font-black text-white tabular-nums">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {boards.length === 0 ? (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">No active board for today</p>
            <h2 className="mt-3 text-xl font-black text-white">No focused late model race is open for today.</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted)]">
              This page only shows today&apos;s Lucas, WoO, Crown/combined, and Hell Tour races. Sprint races and future dates stay out of this view.
            </p>
            <Link
              href="/admin/races"
              className="mt-5 inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:opacity-90"
            >
              Review all races
            </Link>
          </section>
        ) : (
          <div className="space-y-6">
            {boards.map((board) => (
              <section key={board.race.id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-200">
                          {board.race.division}
                        </span>
                        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                          {statusLabel(board.race.betting_status, board.race.is_live)}
                        </span>
                        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                          {board.lineStatus === "published" ? "Published lines" : board.lineStatus === "preview" ? "Preview prices" : "No prices"}
                        </span>
                      </div>
                      <h2 className="mt-2 text-xl font-black text-white">{board.race.name}</h2>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {board.race.track_name} · {board.fieldSize} entries · Q {board.readiness.qualifying} · H {board.readiness.heats} · Starts {board.readiness.starts}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/admin/races/${board.race.id}`} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:text-white">
                        Control
                      </Link>
                      <Link href={`/admin/races/${board.race.id}/prediction`} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:text-white">
                        Prediction
                      </Link>
                      <Link href={`/admin/races/${board.race.id}/book`} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-bold text-white hover:opacity-90">
                        Lines
                      </Link>
                    </div>
                  </div>
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                    Last publish: {formatTime(board.lastPublishedAt)}
                  </p>
                </div>

                <div className="grid gap-0 xl:grid-cols-[1.25fr_0.75fr]">
                  <div className="border-b border-[var(--border)] xl:border-b-0 xl:border-r">
                    <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
                      <h3 className="text-sm font-black text-white">Top 10 Outrights</h3>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Model vs market</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[820px] text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border)] bg-[var(--background)]">
                            {["Rank", "Driver", "Market", "Fair", "Win%", "Call", "Why"].map((heading) => (
                              <th
                                key={heading}
                                className={`px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] ${
                                  ["Driver", "Why"].includes(heading) ? "text-left" : "text-right"
                                }`}
                              >
                                {heading}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {board.topOutrights.map((line) => (
                            <tr key={line.driverId} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)]">
                              <td className="px-4 py-3 text-right text-xs tabular-nums text-[var(--muted)]">{line.rank}</td>
                              <td className="px-4 py-3">
                                <p className="font-semibold text-white">{line.driverName}</p>
                                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                                  {line.carNumber ? `#${line.carNumber} · ` : ""}{line.entryStatus} · {line.confidence}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-sm font-black text-amber-300">{line.marketOdds}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-[var(--muted)]">{line.fairOdds}</td>
                              <td className="px-4 py-3 text-right text-xs tabular-nums text-white">{pct(line.modelProbability)}</td>
                              <td className="px-4 py-3 text-right">
                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${toneForRecommendation(line.recommendation)}`}>
                                  {line.recommendation}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs leading-5 text-[var(--muted)]">
                                {line.reasons[0] ?? line.warnings[0] ?? line.source}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
                      <h3 className="text-sm font-black text-white">Props</h3>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Best visible markets</span>
                    </div>
                    <div className="divide-y divide-[var(--border)]">
                      {board.propsByType.length === 0 ? (
                        <div className="px-5 py-8 text-sm text-[var(--muted)]">No props available yet.</div>
                      ) : (
                        board.propsByType.map((group) => (
                          <div key={group.type} className="px-5 py-4">
                            <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">{group.label}</h4>
                            <div className="mt-3 space-y-2">
                              {group.lines.map((line) => (
                                <div key={`${line.type}-${line.description}-${line.marketOdds}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-white">{line.description}</p>
                                    <p className="mt-0.5 text-[10px] text-[var(--muted)]">{pct(line.impliedProbability, 0)} implied</p>
                                  </div>
                                  <p className="font-mono text-sm font-black text-amber-300">{line.marketOdds}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
