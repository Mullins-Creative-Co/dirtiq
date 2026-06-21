import { connection } from "next/server";
import Link from "next/link";

import { Nav } from "@/components/nav";
import { isActiveModelTarget, isFocusedModelSeries, listRaces } from "@/lib/races";

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function statusTone(status: string) {
  if (status === "upcoming") return "border-amber-400/40 bg-amber-400/10 text-amber-200";
  if (status === "complete") return "border-green-400/35 bg-green-400/10 text-green-200";
  return "border-red-400/35 bg-red-400/10 text-red-200";
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default async function RacesPage() {
  await connection();

  const races = listRaces();
  const activeTargetRaces = races.filter(isActiveModelTarget);
  const focusedRaces = activeTargetRaces.filter(isFocusedModelSeries);
  const minimizedRaces = activeTargetRaces.filter((race) => !isFocusedModelSeries(race));
  const hiddenUnsupported = races.length - activeTargetRaces.length;
  const upcomingRaces = focusedRaces.filter((race) => race.status === "upcoming");
  const completedRaces = focusedRaces.filter((race) => race.status === "complete");
  const cancelledRaces = focusedRaces.filter((race) => race.status === "cancelled");
  const reviewRaces = [...completedRaces, ...cancelledRaces];
  const totalRaces = focusedRaces.length;
  const divisions = new Set(focusedRaces.map((race) => race.division).filter(Boolean)).size;
  const tracks = new Set(focusedRaces.map((race) => race.track_name).filter(Boolean)).size;
  const activeYear = focusedRaces[0]?.race_date ? new Date(`${focusedRaces[0].race_date}T12:00:00`).getFullYear() : 2026;

  function raceRows(sectionRaces: typeof races, mode: "betting" | "review") {
    return sectionRaces.map((race, index) => (
      <tr
        key={race.id}
        className="group border-b border-[var(--border)] last:border-0 hover:bg-[#1d1510]"
      >
        <td className="px-4 py-3 align-top font-mono text-xs font-black text-[var(--accent)]">
          {String(index + 1).padStart(2, "0")}
        </td>
        <td className="px-4 py-3 align-top">
          <Link
            href={`/admin/races/${race.id}`}
            className="font-black uppercase text-white transition-colors group-hover:text-[var(--accent)]"
          >
            {race.name}
          </Link>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {race.division} · {race.track_condition || "Condition TBA"}
          </p>
        </td>
        <td className="px-4 py-3 align-top font-semibold text-white">{race.track_name}</td>
        <td className="px-4 py-3 align-top font-mono text-xs text-[var(--muted)]">
          {fmt.format(new Date(`${race.race_date}T12:00:00`))}
        </td>
        <td className="px-4 py-3 align-top">
          <span className={`border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${statusTone(race.status)}`}>
            {statusLabel(race.status)}
          </span>
        </td>
        <td className="px-4 py-3 align-top">
          <div className="flex justify-end gap-2">
            <Link
              href={`/admin/races/${race.id}`}
              className="border border-[var(--border)] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {mode === "betting" ? "Underwrite" : "Review"}
            </Link>
            {mode === "betting" ? (
              <Link
                href={`/admin/races/${race.id}/prediction`}
                className="bg-[var(--accent)] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-black transition-opacity hover:opacity-90"
              >
                Output
              </Link>
            ) : null}
          </div>
        </td>
      </tr>
    ));
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <section className="overflow-hidden border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid border-b border-[var(--border)] lg:grid-cols-[1fr_auto]">
            <div className="bg-[linear-gradient(135deg,#18120c_0%,#0b0d10_55%,#15191f_100%)] px-5 py-6 sm:px-6">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[var(--accent)]">
                Race control
              </p>
              <h1 className="mt-3 text-4xl font-black uppercase leading-none text-white sm:text-5xl">
                Focused Schedule
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Primary model targets only: Lucas Oil LMDS, WoO Late Models, and DIRTcar Summer Nationals / Hell Tour.
              </p>
            </div>
            <div className="grid min-w-full grid-cols-3 border-t border-[var(--border)] bg-[#0f1216] lg:min-w-[420px] lg:border-l lg:border-t-0">
              {[
                { label: "Season", value: activeYear },
                { label: "Events", value: totalRaces },
                { label: "Tracks", value: tracks },
              ].map((stat) => (
                <div key={stat.label} className="border-r border-[var(--border)] px-4 py-5 last:border-r-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)]">
                    {stat.label}
                  </p>
                  <p className="mt-2 font-mono text-3xl font-black text-white">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#11100d] px-4 py-3 sm:px-5">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Focused", value: totalRaces, active: true },
                { label: "Upcoming", value: upcomingRaces.length },
                { label: "Complete", value: completedRaces.length },
                { label: "Divisions", value: divisions },
              ].map((filter) => (
                <span
                  key={filter.label}
                  className={`border px-3 py-2 text-[10px] font-black uppercase tracking-wider ${
                    filter.active
                      ? "border-[var(--accent)] bg-[var(--accent)] text-black"
                      : "border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  {filter.label} <span className="font-mono">{filter.value}</span>
                </span>
              ))}
            </div>
            <Link
              href="/admin/races/new"
              className="bg-[var(--accent)] px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-black transition-opacity hover:opacity-90"
            >
              New Race
            </Link>
            {hiddenUnsupported > 0 ? (
              <span className="border border-[var(--border)] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[var(--muted)]">
                {hiddenUnsupported} unsupported hidden
              </span>
            ) : null}
            {minimizedRaces.length > 0 ? (
              <span className="border border-[var(--border)] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[var(--muted)]">
                {minimizedRaces.length} other late-model rows minimized
              </span>
            ) : null}
          </div>
        </section>

        {focusedRaces.length === 0 ? (
          <section className="border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
            <p className="text-[var(--muted)]">No races yet.</p>
            <Link
              href="/admin/races/new"
              className="mt-4 inline-block bg-[var(--accent)] px-4 py-2 text-xs font-black uppercase tracking-wider text-black"
            >
              Create Race
            </Link>
          </section>
        ) : (
          <div className="space-y-6">
            <section className="border border-[var(--border)] bg-[var(--surface)]">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] bg-[#12161c] px-5 py-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent)]">
                    Upcoming
                  </p>
                  <h2 className="mt-1 text-xl font-black uppercase text-white">Next Boards</h2>
                </div>
                <p className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                  {upcomingRaces.length} open schedule rows
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[#0b0d10]">
                      {["#", "Event", "Track", "Date", "Status", ""].map((head) => (
                        <th
                          key={head}
                          className={`px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--muted)] ${
                            head === "" ? "text-right" : "text-left"
                          }`}
                        >
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingRaces.length > 0 ? (
                      raceRows(upcomingRaces, "betting")
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                          No upcoming races loaded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {minimizedRaces.length > 0 ? (
              <details className="border border-[var(--border)] bg-[var(--surface)]">
                <summary className="cursor-pointer px-5 py-4 text-xs font-black uppercase tracking-[0.18em] text-[var(--muted)] hover:text-white">
                  Other late-model races minimized ({minimizedRaces.length})
                </summary>
                <div className="border-t border-[var(--border)] px-5 py-4">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {minimizedRaces.slice(0, 18).map((race) => (
                      <Link
                        key={race.id}
                        href={`/admin/races/${race.id}`}
                        className="border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3 hover:border-[var(--accent)]"
                      >
                        <p className="truncate text-xs font-black uppercase text-white">{race.name}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                          {race.division} · {fmt.format(new Date(`${race.race_date}T12:00:00`))}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}

            <section className="border border-[var(--border)] bg-[var(--surface)]">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] bg-[#12161c] px-5 py-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--accent)]">
                    Results
                  </p>
                  <h2 className="mt-1 text-xl font-black uppercase text-white">Settlement Review</h2>
                </div>
                <p className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                  {completedRaces.length} complete · {cancelledRaces.length} cancelled
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[#0b0d10]">
                      {["#", "Event", "Track", "Date", "Status", ""].map((head) => (
                        <th
                          key={head}
                          className={`px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--muted)] ${
                            head === "" ? "text-right" : "text-left"
                          }`}
                        >
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRaces.length > 0 ? (
                      raceRows(reviewRaces, "review")
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                          No completed races ready for review.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
