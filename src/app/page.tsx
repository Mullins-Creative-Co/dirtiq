import Link from "next/link";
import { connection } from "next/server";

import { Nav } from "@/components/nav";
import { TonightBoardView } from "@/components/tonight/board";
import { EmptyState, PageHeader, StatTile } from "@/components/ui/primitives";
import { relativeAge, units } from "@/lib/format";
import { getModelHealth } from "@/lib/model-reports";
import { SITE_NAME } from "@/lib/site";
import { buildTonightBoard } from "@/lib/tonight";

export const dynamic = "force-dynamic";
export const metadata = { title: `Tonight | ${SITE_NAME}`, description: "Tonight's games and races ranked by model win likelihood, with the statistical case, the matchup, and the market for each." };

const longDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });

export default async function TonightPage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  await connection();
  const { sport } = await searchParams;
  const initialSport = typeof sport === "string" && /^[a-z]{2,8}$/.test(sport) ? sport : "all";
  const board = buildTonightBoard(7);
  const health = getModelHealth();
  const tonight = board.items.filter((item) => item.isToday);
  const high = tonight.filter((item) => item.confidenceLabel === "High").length;
  const open = health?.models.reduce((sum, m) => sum + m.open, 0) ?? 0;
  const graded = health?.models.reduce((sum, m) => sum + m.settled, 0) ?? 0;
  const unitsTotal = health?.models.reduce((sum, m) => sum + (m.units ?? 0), 0) ?? null;

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
        <PageHeader
          kicker={longDay.format(new Date(`${board.today}T17:00:00Z`))}
          title="Tonight"
          lede="Upcoming games and races, with outright win likelihood kept separate from the spread lean. Open a matchup to check the model, saved market, and missing inputs before making a decision."
          aside={
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Tonight · all sports" value={tonight.length} detail={`${high} at ≥72% model likelihood`} />
              <StatTile label="Open forecasts" value={open} detail="awaiting results" />
              <StatTile label="Graded" value={graded} detail={graded ? `${units(unitsTotal)} at archived prices` : "ledger is live"} tone={graded && (unitsTotal ?? 0) > 0 ? "good" : "neutral"} />
            </div>
          }
        />

        {board.items.length === 0 ? (
          <EmptyState title="Nothing scheduled in the next week" detail="Forecast a sport or score upcoming races and they appear here." command={"npm run sports:all\nnpm run racing:score"} href="/sports" linkLabel="Sports" />
        ) : (
          <TonightBoardView board={board} initialSport={initialSport} />
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-5 text-xs text-[var(--muted)]">
          <span>Likelihood is the model&apos;s probability that the pick beats its main rival: the win probability for a game, the head-to-head versus the runner-up for a race. It does not measure the quality of a bet. Ledger updated {health ? relativeAge(health.generatedAt) : "never"}.</span>
          <span className="flex gap-4">
            <Link href="/models" className="font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Model health →</Link>
            <Link href="/sports" className="font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Sports →</Link>
          </span>
        </footer>
      </main>
    </div>
  );
}
