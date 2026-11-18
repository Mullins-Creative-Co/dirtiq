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
