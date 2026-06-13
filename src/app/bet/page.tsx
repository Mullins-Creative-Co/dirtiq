import { connection } from "next/server";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { listRaces } from "@/lib/races";
import { getOrCreateAccount, getAccountBets } from "@/lib/player-bets";
import { AccountPickerForm } from "@/components/account-picker-form";

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

export default async function BetLobbyPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}) {
  await connection();
  const { name } = await searchParams;

  const account = name ? getOrCreateAccount(name) : null;
  const allBets = account ? getAccountBets(account.id) : [];

  const races = listRaces();
  const openRaces = races.filter((r) => r.status === "upcoming");
  const completedRaces = races.filter((r) => r.status === "complete").slice(0, 5);

  const wonBets = allBets.filter((b) => b.status === "won");
  const lostBets = allBets.filter((b) => b.status === "lost");
  const openBets = allBets.filter((b) => b.status === "open");
  const totalWagered = allBets.reduce((s, b) => s + b.stake, 0);
  const totalReturned = wonBets.reduce((s, b) => s + b.payout_if_win, 0);
  const netPL = totalReturned - totalWagered + openBets.reduce((s) => s, 0);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-white">Betting Lobby</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Pick a race, browse props, and bet with fake money.
            </p>
          </div>
          {account && (
            <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-5 py-4 text-right">
              <div className="text-xs text-[var(--muted)] mb-0.5">Playing as</div>
              <div className="text-lg font-bold text-white">{account.name}</div>
              <div className="text-2xl font-black text-[var(--accent)] tabular-nums">{usd(account.balance)}</div>
              <Link
                href="/bet"
                className="text-[10px] text-[var(--muted)] hover:text-white transition-colors"
              >
                Switch account →
              </Link>
            </div>
          )}
        </div>

        {/* Account picker */}
        {!account && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center max-w-sm mx-auto">
            <div className="text-4xl mb-3">🏁</div>
            <h2 className="text-lg font-bold text-white mb-1">Enter your name to start</h2>
            <p className="text-sm text-[var(--muted)] mb-5">
              You&apos;ll get $1,000 in fake money to bet with. No real money involved.
            </p>
            <AccountPickerForm />
          </div>
        )}

        {/* Stats row (only when logged in) */}
        {account && allBets.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Net P&L", value: usd(netPL), positive: netPL >= 0, negative: netPL < 0 },
              { label: "Bets Placed", value: allBets.length.toString(), positive: false, negative: false },
              { label: "W / L", value: `${wonBets.length} / ${lostBets.length}`, positive: false, negative: false },
              { label: "Open Bets", value: openBets.length.toString(), positive: openBets.length > 0, negative: false },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
                <div className="text-xs text-[var(--muted)] mb-1">{s.label}</div>
                <div className={`text-xl font-bold tabular-nums ${s.positive ? "text-green-400" : s.negative ? "text-red-400" : "text-white"}`}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Open races */}
        <section>
          <h2 className="text-base font-semibold text-white mb-4">Open for Betting</h2>
          {openRaces.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-sm text-[var(--muted)]">
              No upcoming races. Add one from the{" "}
              <Link href="/races/new" className="text-[var(--accent)] hover:underline">races page</Link>.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {openRaces.map((r) => {
                const href = account
                  ? `/bet/${r.id}?name=${encodeURIComponent(account.name)}`
                  : `/bet/${r.id}`;
                return (
                  <Link
                    key={r.id}
                    href={href}
                    className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)]/50 hover:bg-[var(--surface-raised)]"
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <p className="font-bold text-white group-hover:text-[var(--accent)] transition-colors">{r.name}</p>
                        <p className="text-xs text-[var(--muted)] mt-0.5">{r.track_name}</p>
                      </div>
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-blue-500/20 text-blue-400 px-2.5 py-1">
                        Open
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                      <span>{fmt.format(new Date(r.race_date + "T12:00:00"))}</span>
                      <span className="text-[var(--accent)] font-medium">{r.track_condition}</span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-[var(--border)]">
                      <span className="text-xs font-semibold text-[var(--accent)]">
                        Bet Now →
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Completed races with results */}
        {completedRaces.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-white mb-4">Recently Settled</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {completedRaces.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 opacity-60"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="font-bold text-white">{r.name}</p>
                      <p className="text-xs text-[var(--muted)] mt-0.5">{r.track_name}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-green-500/20 text-green-400 px-2.5 py-1">
                      Settled
                    </span>
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {fmt.format(new Date(r.race_date + "T12:00:00"))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent bets */}
        {account && allBets.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-white mb-4">
              My Bet History
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">{allBets.length} bets</span>
            </h2>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                    {["Race", "Bet", "Odds", "Stake", "Return", "Status"].map((h) => (
                      <th
                        key={h}
                        className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] ${["Race", "Bet"].includes(h) ? "text-left" : "text-right"}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allBets.slice(0, 20).map((bet) => (
                    <tr
                      key={bet.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)] transition-colors"
                    >
                      <td className="px-3 py-2.5 text-xs text-[var(--muted)]">{bet.race_name}</td>
                      <td className="px-3 py-2.5 text-xs text-white font-medium">{bet.description}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-[var(--muted)]">{bet.american_odds}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-white">{usd(bet.stake)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                        {bet.status === "won" ? (
                          <span className="text-green-400 font-bold">+{usd(bet.payout_if_win - bet.stake)}</span>
                        ) : bet.status === "lost" ? (
                          <span className="text-red-400">-{usd(bet.stake)}</span>
                        ) : bet.status === "void" ? (
                          <span className="text-[var(--muted)]">refund</span>
                        ) : (
                          <span className="text-[var(--muted)]">{usd(bet.payout_if_win)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`text-[10px] font-bold uppercase ${
                          bet.status === "won" ? "text-green-400"
                          : bet.status === "lost" ? "text-slate-500"
                          : bet.status === "void" ? "text-amber-400"
                          : "text-blue-400"
                        }`}>
                          {bet.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
