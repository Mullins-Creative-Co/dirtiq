import type { AvailabilityGame } from "./model-reports.ts";

export function availabilitySummary(game: AvailabilityGame | null | undefined, now = Date.now()) {
  if (!game) return { stale: true, label: "Injury report unavailable", detail: "Missing coverage does not mean healthy." };
  const elapsed = now - Date.parse(game.asOf);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 3*3_600_000)
    return { stale: true, label: "Injury report needs refresh", detail: "The snapshot is over three hours old or its time is unverified. No current valuation." };
  const teams = [game.contexts.home,game.contexts.away];
  const out = teams.flatMap(t=>t.players).filter(p=>p.category === "out" && !p.stale && !p.contradictedByAppearance);
  const uncertain = teams.flatMap(t=>t.players).filter(p=>p.category === "uncertain" && !p.stale);
  const qb = teams.some(t=>t.qbFlag);
  const points = game.homeMarginChange;
  const signed = (n:number) => `${n>0?"+":""}${n.toFixed(1)}`;
  return {
    stale:false,
    label: teams.every(t=>t.coverage === "unknown") ? "Injury coverage unavailable" : `${out.length} listed out · ${uncertain.length} unresolved${qb?" · QB listed":""}`,
    detail: points ? `Experimental home-margin change ${signed(points.min)} to ${signed(points.max)} pts. Separate from the forecast; not a betting adjustment.`
      : "Point impact unvalued; current player/replacement evidence is incomplete. Missing reports do not mean healthy.",
  };
}


/** Source discovery is available even when our automated feed has no coverage. */
export function injuryNewsHref(label: string, sport: string, startsAt: string): string {
  const date = new Date(startsAt);
  const day = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
    : "";
  return `https://www.google.com/search?${new URLSearchParams({ q: `${label} ${sport.toUpperCase()} injury report confirmed starters ${day}`.trim() })}`;
}


/** The numeric variant is written by Python; the UI only enforces display expiry. */
export function injuryProjectionView(game: AvailabilityGame | null | undefined, now: number) {
  const p=game?.injuryAdjustedProjection;
  if (!game || !p || p.status !== "applied" || p.asOf !== game.asOf || availabilitySummary(game,now).stale || !(Date.parse(game.startsAt)>now)) return null;
  if (![p.homeMargin,p.homeSpread,p.total].some(n=>typeof n==="number" && Number.isFinite(n))) return null;
  return p;
}
