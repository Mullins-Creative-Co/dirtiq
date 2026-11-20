import Link from "next/link";
import type { AvailabilityGame } from "@/lib/model-reports";
import { availabilitySummary, injuryNewsHref } from "@/lib/availability-display";

type Matchup = { sport: string; label: string; startsAt: string };

export function AvailabilitySummary({ game, now, matchup }: { game?: AvailabilityGame | null; now: number; matchup?: Matchup }) {
  const state = availabilitySummary(game, now);
  const sport = game?.sport ?? matchup?.sport;
  const href = game ? `/injuries?sport=${game.sport}#${encodeURIComponent(game.id)}` : sport ? `/injuries?sport=${sport}` : "/injuries";
  const check = matchup ?? (game ? { sport: game.sport, label: `${game.contexts.away.name} at ${game.contexts.home.name}`, startsAt: game.startsAt } : null);
  return <div className="mt-2 rounded border border-[var(--border)] p-2 text-xs text-[var(--muted)]">
    <Link className="font-bold text-[var(--accent)] underline" href={href}>Check injuries</Link>
    <p className="mt-1">{state.label}. {state.detail}</p>
    {check ? <a className="mt-1 inline-block underline" href={injuryNewsHref(check.label, check.sport, check.startsAt)} target="_blank" rel="noopener noreferrer">Search matchup injury news ↗</a> : null}
  </div>;
}
