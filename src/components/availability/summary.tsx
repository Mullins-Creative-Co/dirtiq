import Link from "next/link";
import type { AvailabilityGame } from "@/lib/model-reports";
import { availabilitySummary, injuryNewsHref, injuryProjectionView } from "@/lib/availability-display";

import { num, signed, spread } from "@/lib/format";

type Matchup = { sport: string; label: string; startsAt: string };

export function AvailabilitySummary({ game, now, matchup }: { game?: AvailabilityGame | null; now: number; matchup?: Matchup }) {
  const state = availabilitySummary(game, now);
  const projection = injuryProjectionView(game,now);
  const sport = game?.sport ?? matchup?.sport;
  const href = game ? `/injuries?sport=${game.sport}#${encodeURIComponent(game.id)}` : sport ? `/injuries?sport=${sport}` : "/injuries";
  const check = matchup ?? (game ? { sport: game.sport, label: `${game.contexts.away.name} at ${game.contexts.home.name}`, startsAt: game.startsAt } : null);
  return <div className="mt-2 rounded border border-[var(--border)] p-2 text-xs text-[var(--muted)]">
    <p className="font-bold text-[var(--foreground)]">Injury-adjusted prediction</p>
    {projection ? <div className="mt-2 space-y-1 text-sm">
      <p className="font-bold">{projection.homeSpread !== null ? `${game!.home} ${spread(projection.homeSpread)}` : "Spread adjustment unavailable"} · Total {num(projection.total,1)}</p>
      <p className="text-xs">Baseline: {game!.home} {spread(projection.baselineHomeSpread)} · total {num(projection.baselineTotal,1)}. Injury change: margin {signed(projection.marginChange,1)} pts · total {signed(projection.totalChange,1)} pts.</p>
      {projection.homeMarginRange ? <p className="text-xs">Home-margin scenarios {signed(projection.homeMarginRange[0],1)} to {signed(projection.homeMarginRange[1],1)} pts{projection.totalRange ? ` · total scenarios ${num(projection.totalRange[0],1)} to ${num(projection.totalRange[1],1)}` : ""}. Scenario ranges are not confidence intervals.</p> : null}
      {projection.validation ? <p className="text-xs">Forward test: {projection.validation.marginGames} spread games · baseline error {num(projection.validation.baselineMae,2)} vs adjusted {num(projection.validation.adjustedMae,2)} pts · {projection.validation.totalGames} total games. Lower error is better.</p> : null}
      <p className="text-xs">Experimental listed-out replacement estimate; unresolved players retain reference minutes. Baseline win probabilities, locked picks and stakes are unchanged. No demonstrated betting edge.</p>
    </div> : <p className="mt-1">Adjustment unavailable: {game?.injuryAdjustedProjection?.reason ?? "Current player-value evidence is missing."}</p>}
    <p className="mt-2 font-semibold">Listed injuries</p>
    <p className="mt-1">{state.label}. {state.detail}</p>
    {game && !state.stale ? <div className="mt-2 space-y-2">{[game.contexts.away, game.contexts.home].map(team => {
      const players = [...team.players].sort((a,b) => Number(b.position === "QB") - Number(a.position === "QB") || (b.baselineMinutes ?? 0) - (a.baselineMinutes ?? 0));
      const playerLine = (p: typeof players[number]) => <span>{p.name}: <strong>{p.status}</strong>{p.stale || p.contradictedByAppearance ? " · needs recheck" : ""}</span>;
      return <div key={team.team}><p className="font-semibold">{team.name}</p>
        {players.length ? <><ul className="mt-1 space-y-1">{players.slice(0,4).map(p => <li key={p.athleteId ?? p.name}>{playerLine(p)}</li>)}</ul>
          {players.length > 4 ? <details className="mt-1"><summary className="cursor-pointer underline">{players.length-4} more player reports</summary><ul className="mt-1 space-y-1">{players.slice(4).map(p => <li key={p.athleteId ?? p.name}>{playerLine(p)}</li>)}</ul></details> : null}</>
          : <p>{team.coverage === "unknown" || team.coverage === "unavailable" ? "Availability not verified." : "No issues listed; roster health is not verified."}</p>}
      </div>;
    })}<p>Report collected {new Date(game.asOf).toLocaleString("en-US", { timeZone:"America/New_York", month:"short", day:"numeric", hour:"numeric", minute:"2-digit" })} ET.</p></div> : null}
    <details className="mt-2"><summary className="cursor-pointer underline">Sources and injury checks</summary>
      <Link className="mt-1 inline-block underline" href={href}>Full injury report</Link>
      {check ? <a className="ml-3 inline-block underline" href={injuryNewsHref(check.label, check.sport, check.startsAt)} target="_blank" rel="noopener noreferrer">Search matchup injury news ↗</a> : null}
    </details>
  </div>;
}
