import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getRace } from "@/lib/races";
import { getOrCreateAccount, getPlayerRaceBets, generateProps } from "@/lib/player-bets";
import { PlayerBettingBoard } from "@/components/player-betting-board";

const fmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

export default async function BetRacePage({
  params,
  searchParams,
}: {
  params: Promise<{ raceId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  await connection();
  const { raceId: raceIdStr } = await params;
  const { name } = await searchParams;

  const raceId = parseInt(raceIdStr, 10);
  if (isNaN(raceId)) notFound();

  const race = getRace(raceId);
  if (!race) notFound();

  const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const account = name ? plain(getOrCreateAccount(name)) : null;
  const existingBets = account ? plain(getPlayerRaceBets(account.id, raceId)) : [];
  const markets = plain(generateProps(raceId, race.track_id));

  const isSettled = race.status === "complete";
  const lobbyHref = account
    ? `/bet?name=${encodeURIComponent(account.name)}`
    : "/bet";

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Nav />
      <main className="mx-auto max-w-7xl px-6 py-10 space-y-6">

        {/* Breadcrumb + header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
              <Link href={lobbyHref} className="hover:text-white transition-colors">← Lobby</Link>
              <span>/</span>
              <span className="text-white">{race.name}</span>
            </div>
            <h1 className="mt-2 text-3xl font-bold text-white">{race.name}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {race.track_name} · {fmt.format(new Date(race.race_date + "T12:00:00"))} · {race.track_condition}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold shrink-0 ${
            isSettled ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"
          }`}>
            {isSettled ? "Settled" : "Open"}
          </span>
        </div>

        {isSettled && (
          <div className="rounded-2xl border border-green-500/30 bg-green-500/5 px-5 py-4 text-sm text-green-400">
            This race has been settled — bets have been graded. Results are final.
          </div>
        )}

        {markets.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
            <p className="text-sm text-[var(--muted)]">No drivers entered yet — betting markets will appear once the field is set.</p>
            <Link href={`/races/${raceId}`} className="mt-3 inline-block text-xs text-[var(--accent)] hover:underline">
              Go to race page to add drivers →
            </Link>
          </div>
        ) : (
          <PlayerBettingBoard
            raceId={raceId}
            raceName={race.name}
            account={account}
            markets={markets}
            existingBets={existingBets}
            isSettled={isSettled}
          />
        )}
      </main>
    </div>
  );
}
