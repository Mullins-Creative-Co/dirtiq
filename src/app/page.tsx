import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { listRaces } from "@/lib/races";
import { getDb } from "@/lib/db";
import { calculateRaceOdds } from "@/lib/odds";

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function PLBadge({ value }: { value: number }) {
  const color = value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-[var(--muted)]";
  const prefix = value > 0 ? "+" : "";
  return <span className={`font-bold tabular-nums text-sm ${color}`}>{prefix}{usd(value)}</span>;
}

function OddsTag({ odds }: { odds: string }) {
  const n = parseInt(odds, 10);
  const color = n < 0 ? "text-amber-300 bg-amber-500/10" : n <= 300 ? "text-white bg-white/10" : "text-slate-400 bg-white/5";
  return (
    <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${color}`}>{odds}</span>
  );
}

export default async function AdminDashboard() {
  await connection();
  const db = getDb();
  const races = listRaces();

  // ── Book-wide P&L across all completed races ──────────────────────────────
  const bookStats = db.prepare(`
    SELECT
      COALESCE(SUM(b.amount), 0)                                          AS total_handle,
      COUNT(b.id)                                                          AS total_bets,
      COALESCE(SUM(CASE WHEN b.status = 'won' THEN b.payout_if_win ELSE 0 END), 0) AS total_paid_out,
      COUNT(DISTINCT b.race_id)                                            AS races_with_action
    FROM bets b
    WHERE b.status IN ('won','lost')
  `).get() as { total_handle: number; total_bets: number; total_paid_out: number; races_with_action: number };

  const realizedPL = bookStats.total_handle - bookStats.total_paid_out;

  // Open exposure across upcoming races
  const openExposure = db.prepare(`
    SELECT
      COALESCE(SUM(b.amount), 0)            AS open_handle,
      COALESCE(MAX(driver_payouts.dp), 0)   AS worst_case_payout
    FROM bets b
    CROSS JOIN (
      SELECT MAX(total_payout) AS dp
      FROM (
        SELECT SUM(payout_if_win) AS total_payout
        FROM bets
        WHERE status = 'open'
        GROUP BY race_id, driver_id
      )
    ) driver_payouts
    WHERE b.status = 'open'
  `).get() as { open_handle: number; worst_case_payout: number };

  // ── Per-race P&L for completed races ─────────────────────────────────────
  const racePL = db.prepare(`
    SELECT
      b.race_id,
      COALESCE(SUM(b.amount), 0) AS handle,
      COALESCE(SUM(CASE WHEN b.status = 'won' THEN b.payout_if_win ELSE 0 END), 0) AS paid_out,
      COUNT(b.id) AS num_bets
    FROM bets b
    WHERE b.status IN ('won','lost')
    GROUP BY b.race_id
  `).all() as Array<{ race_id: number; handle: number; paid_out: number; num_bets: number }>;

  const plByRace = new Map(racePL.map((r) => [r.race_id, r]));

  // ── Upcoming races with top lines ─────────────────────────────────────────
  const upcoming = races.filter((r) => r.status === "upcoming");
  const upcomingWithOdds: Array<{
    race: (typeof races)[0];
    topThree: Array<{ name: string; odds: string }>;
    entryCount: number;
    openHandle: number;
  }> = [];

  for (const race of upcoming.slice(0, 6)) {
    const entryCount = (db.prepare("SELECT COUNT(*) AS n FROM race_entries WHERE race_id = ?").get(race.id) as { n: number }).n;
    const { open_handle } = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS open_handle FROM bets WHERE race_id = ? AND status = 'open'"
    ).get(race.id) as { open_handle: number };

    let topThree: Array<{ name: string; odds: string }> = [];
    if (entryCount > 0) {
      try {
        const odds = await calculateRaceOdds(race.id, race.track_id);
        topThree = odds.slice(0, 3).map((d) => ({ name: d.driverName, odds: d.americanOdds }));
      } catch {}
    }

    upcomingWithOdds.push({ race, topThree, entryCount, openHandle: open_handle });
  }

  // ── Completed races for P&L table ─────────────────────────────────────────
  const completed = races.filter((r) => r.status === "complete").slice(0, 10);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">

        {/* ── Top-line book stats ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Realized P&L", value: <PLBadge value={realizedPL} />, sub: `${bookStats.races_with_action} races settled` },
            { label: "Total Handle", value: <span className="text-2xl font-bold text-white">{usd(bookStats.total_handle)}</span>, sub: `${bookStats.total_bets} bets` },
            { label: "Open Handle", value: <span className="text-2xl font-bold text-white">{usd(openExposure.open_handle)}</span>, sub: "across upcoming races" },
            { label: "Worst-Case Exp.", value: <span className={`text-2xl font-bold ${openExposure.worst_case_payout > openExposure.open_handle ? "text-red-400" : "text-white"}`}>{usd(openExposure.worst_case_payout)}</span>, sub: "single-driver max payout" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-2">{s.label}</p>
              {s.value}
              <p className="text-xs text-[var(--muted)] mt-1">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Upcoming lines ── */}
        {upcomingWithOdds.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)]">Live Lines</h2>
              <Link href="/races" className="text-xs text-[var(--muted)] hover:text-white transition-colors">All races →</Link>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden divide-y divide-[var(--border)]">
              {upcomingWithOdds.map(({ race, topThree, entryCount, openHandle }) => (
                <div key={race.id} className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--surface-raised)] transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white text-sm truncate">{race.name}</span>
                      <span className="text-xs text-[var(--muted)] shrink-0">{fmt.format(new Date(race.race_date + "T12:00:00"))}</span>
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">{race.track_name} · {entryCount} drivers</div>
                  </div>

                  {/* Top 3 odds */}
                  <div className="hidden sm:flex items-center gap-3 shrink-0">
                    {topThree.length === 0 ? (
                      <span className="text-xs text-[var(--muted)]">No entries yet</span>
                    ) : (
                      topThree.map((d) => (
                        <div key={d.name} className="text-center">
                          <div className="text-[10px] text-[var(--muted)] truncate max-w-[72px]">{d.name.split(" ").pop()}</div>
                          <OddsTag odds={d.odds} />
                        </div>
                      ))
                    )}
                  </div>

                  {/* Handle + book link */}
                  <div className="shrink-0 text-right">
                    {openHandle > 0 && (
                      <div className="text-xs text-[var(--muted)] mb-1">{usd(openHandle)} handle</div>
                    )}
                    <div className="flex items-center gap-2">
                      <Link href={`/races/${race.id}`}
                        className="text-xs text-[var(--muted)] hover:text-white transition-colors">Lines</Link>
                      <Link href={`/races/${race.id}/book`}
                        className="text-xs font-semibold bg-[var(--accent)] text-black px-3 py-1 rounded hover:opacity-90 transition-opacity">
                        Book
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── P&L by race ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--muted)]">P&amp;L by Race</h2>
          </div>
          {completed.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--muted)]">
              No completed races yet.
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Race", "Date", "Handle", "Paid Out", "P&L", "Bets", ""].map((h, i) => (
                      <th key={i} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${i <= 1 ? "text-left" : "text-right"} ${i === 6 ? "w-16" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {completed.map((race) => {
                    const pl = plByRace.get(race.id);
                    const racePnl = pl ? pl.handle - pl.paid_out : null;
                    return (
                      <tr key={race.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="px-4 py-3 font-medium text-white">{race.name}</td>
                        <td className="px-4 py-3 text-[var(--muted)] text-xs">{fmt.format(new Date(race.race_date + "T12:00:00"))}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)] text-xs">{pl ? usd(pl.handle) : "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)] text-xs">{pl ? usd(pl.paid_out) : "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {racePnl !== null ? <PLBadge value={racePnl} /> : <span className="text-xs text-[var(--muted)]">no bets</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-[var(--muted)] tabular-nums">{pl?.num_bets ?? "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/races/${race.id}/book`}
                            className="text-xs text-[var(--muted)] hover:text-white transition-colors">Book →</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Quick actions ── */}
        <section className="grid gap-3 sm:grid-cols-4">
          {[
            { href: "/races/new", label: "New Race" },
            { href: "/import", label: "Import WoO" },
            { href: "/drivers/new", label: "Add Driver" },
            { href: "/tracks/new", label: "Add Track" },
          ].map((item) => (
            <Link key={item.href} href={item.href}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-white text-center hover:border-[var(--accent)] hover:bg-[var(--surface-raised)] transition-colors">
              {item.label}
            </Link>
          ))}
        </section>

      </main>
    </div>
  );
}
