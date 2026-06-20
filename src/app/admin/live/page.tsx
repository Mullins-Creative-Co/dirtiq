import Link from "next/link";
import { connection } from "next/server";
import { Nav } from "@/components/nav";
import { LiveSyncControl } from "@/components/live-sync-control";
import { buildPredictionCard } from "@/lib/prediction-card";
import { isActiveModelTarget, listRaces } from "@/lib/races";
import { getStorageStatus } from "@/lib/storage-status";

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function statusStyle(status: string, isLive: number, bettingStatus: string | null) {
  if (status === "complete") return "border-green-400/35 bg-green-500/10 text-green-300";
  if (isLive) return "border-red-400/35 bg-red-500/10 text-red-300";
  if ((bettingStatus ?? "open") !== "open") return "border-amber-400/35 bg-amber-500/10 text-amber-300";
  return "border-sky-400/35 bg-sky-500/10 text-sky-300";
}

function statusLabel(status: string, isLive: number, bettingStatus: string | null) {
  if (status === "complete") return "Complete";
  if (isLive) return "Live";
  if ((bettingStatus ?? "open") !== "open") return "Locked";
  return "Open";
}

export default async function LiveAdminPage() {
  await connection();

  const races = listRaces()
    .filter((race) => isActiveModelTarget(race) && (race.status === "upcoming" || race.is_live || race.status === "complete"))
    .slice(0, 6)
    .map((race) => {
      const card = buildPredictionCard(race.id);
      return {
        id: race.id,
        name: race.name,
        raceDate: race.race_date,
        trackName: race.track_name,
        status: race.status,
        isLive: race.is_live,
        bettingStatus: race.betting_status,
        mrpEventId: race.mrp_event_id,
        entries: card?.readiness.entries ?? 0,
        heats: card?.readiness.heats ?? 0,
        qualifying: card?.readiness.qualifying ?? 0,
        starts: card?.readiness.starts ?? 0,
        topPick: card?.rows[0]
          ? {
              name: card.rows[0].driverName,
              probability: card.rows[0].modelProbability,
              confidence: card.rows[0].confidence,
            }
          : null,
      };
    });
  const storage = getStorageStatus();

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Nav />
      <main className="mx-auto max-w-5xl space-y-4 px-3 pb-24 pt-4 sm:px-6 sm:py-8">
        <LiveSyncControl />

        <section className={`border ${storage.needsHostedRaceStore ? "border-amber-500/40 bg-amber-500/10" : "border-green-500/35 bg-green-500/10"} px-4 py-3`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)]">Source of truth</p>
              <h2 className="mt-1 text-sm font-black uppercase text-white">
                {storage.runtime === "vercel" ? "Production" : "Local"} · race data {storage.raceStore === "sqlite_vercel_tmp" ? "temporary" : "local file"}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-300">{storage.summary}</p>
              <Link href="/admin/storage" className="mt-2 inline-flex text-xs font-black uppercase tracking-wide text-[var(--accent)]">
                Storage setup
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)] text-center">
              <div className="bg-[var(--surface)] px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)]">Front-end bets</p>
                <p className="mt-1 text-xs font-black uppercase text-white">{storage.publicBetStore}</p>
              </div>
              <div className="bg-[var(--surface)] px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)]">Seed DB</p>
                <p className="mt-1 text-xs font-black uppercase text-white">{storage.hasSeed ? "Ready" : "Missing"}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)]">What to do</p>
          </div>
          <div className="grid gap-px bg-[var(--border)] sm:grid-cols-3">
            {[
              ["1", "Sync MRP", "Pull entries, heats, qualifying, and finals."],
              ["2", "Review model", "Check probability, reasons, caveats, and series routing."],
              ["3", "Publish lines", "Use admin line control; public boards stay separate."],
            ].map(([number, title, detail]) => (
              <div key={number} className="bg-[var(--surface)] px-4 py-4">
                <p className="text-2xl font-black text-[var(--accent)]">{number}</p>
                <p className="mt-1 text-sm font-black text-white">{title}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-white">Model Control Races</h2>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Back end only</span>
          </div>

          {races.map((race) => (
            <article key={race.id} className="border border-[var(--border)] bg-[var(--surface)]">
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--racing-red)]">
                      {dateFmt.format(new Date(`${race.raceDate}T12:00:00`))} · {race.trackName}
                    </p>
                    <h3 className="mt-1 text-lg font-black uppercase leading-6 text-white">{race.name}</h3>
                  </div>
                  <span className={`shrink-0 border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${statusStyle(race.status, race.isLive, race.bettingStatus)}`}>
                    {statusLabel(race.status, race.isLive, race.bettingStatus)}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-px border border-[var(--border)] bg-[var(--border)]">
                  {[
                    ["Entries", race.entries],
                    ["QT", race.qualifying],
                    ["Heat", race.heats],
                    ["Start", race.starts],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-[var(--surface-raised)] px-2 py-2 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{label}</p>
                      <p className="mt-1 text-lg font-black text-white">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Model leader</p>
                  <p className="mt-1 text-sm font-black text-white">
                    {race.topPick
                      ? `${race.topPick.name} · ${Math.round(race.topPick.probability * 1000) / 10}% · ${race.topPick.confidence}`
                      : "Needs entries/model"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/admin/races/${race.id}`} className="border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3 text-center text-xs font-black uppercase tracking-wide text-white">
                    Race Control
                  </Link>
                  <Link href={`/admin/races/${race.id}/book`} className="border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3 text-center text-xs font-black uppercase tracking-wide text-white">
                    Lines
                  </Link>
                </div>
              </div>
            </article>
          ))}

          {races.length === 0 && (
            <div className="border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--muted)]">
              No active late-model races loaded.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
