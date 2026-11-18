import Link from "next/link";
import type { AvailabilityGame } from "@/lib/model-reports";
import { availabilitySummary } from "@/lib/availability-display";

export function AvailabilitySummary({game,now}:{game?:AvailabilityGame|null;now:number}) {
  const state=availabilitySummary(game,now);
  return <div className="mt-2 rounded border border-[var(--border)] p-2 text-xs text-[var(--muted)]">
    <Link className="font-bold text-[var(--accent)] underline" href={game?`/injuries?sport=${game.sport}#${encodeURIComponent(game.id)}`:"/injuries"}>{state.label}</Link>
    <p className="mt-1">{state.detail}</p>
  </div>;
}
