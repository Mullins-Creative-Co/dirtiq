import "server-only";

import { teamLabel } from "@/lib/team-names";

import { getLiveLines, resolveNflEvent } from "@/lib/live-lines";
import { isLiveSport, type LiveLine } from "@/lib/live-lines/core";
import { getDailyCard, getTeamNames, type CardPick, type DailyCard } from "@/lib/model-reports";

export type CardPickView = CardPick & {
  /** The price right now from ESPN, seen from the pick's side; null when the game has started or ESPN has no quote. */
  live: { line: number; price: number | null; edgePts: number; observedAt: string; books: number; moved: number } | null;
  liveStatus: "playable" | "edge-gone" | "unavailable" | "closed";
  logHref: string;
};
export type CardView = Omit<DailyCard, "picks"> & { picks: CardPickView[]; loadedAt: string; today: string;
  /** Published terms plus searchable display names, for handing to a reviewing agent. */
  source: DailyCard };

function logHref(pick: CardPick, line: number, price: number | null): string {
  const q = new URLSearchParams({
    sport: pick.sport, eventId: pick.id, eventLabel: `${pick.away} at ${pick.home}`, eventStart: pick.startsAt,
    market: "spread", selection: pick.pick, line: String(line),
  });
  if (price !== null) q.set("price", String(price));
  return `/bets?${q.toString()}#log`;
}

async function liveFor(pick: CardPick): Promise<LiveLine | null> {
  if (!isLiveSport(pick.sport)) return null;
  const id = pick.sport === "nfl" ? await resolveNflEvent(pick) : pick.gameId;
  return id ? (await getLiveLines(pick.sport, [id])).get(id) ?? null : null;
}

/** Today's card with each open pick checked against ESPN's current line. */
export async function buildCardView(): Promise<CardView | null> {
  const published = getDailyCard();
  if (!published) return null;
  const names = getTeamNames();
  const card = { ...published, picks: published.picks.map((pick) => ({
    ...pick,
    homeName: teamLabel(names, pick.sport, pick.home),
    awayName: teamLabel(names, pick.sport, pick.away),
    pickName: teamLabel(names, pick.sport, pick.pick),
  })) };
  const now = Date.now();
  const picks = await Promise.all(card.picks.map(async (pick): Promise<CardPickView> => {
    const closed = Boolean(pick.result) || Date.parse(pick.startsAt) <= now;
    const quote = closed ? null : await liveFor(pick);
    if (!quote || quote.spread === null) {
      return { ...pick, live: null, liveStatus: closed ? "closed" : "unavailable", logHref: logHref(pick, pick.line, pick.price) };
    }
    const home = pick.side === "home";
    const line = home ? quote.spread : -quote.spread;
    const price = home ? quote.homeSpreadPrice : quote.awaySpreadPrice;
    const edgePts = (pick.modelHomeMargin + quote.spread) * (home ? 1 : -1);
    return {
      ...pick,
      live: { line, price, edgePts, observedAt: quote.observedAt, books: quote.books, moved: line - pick.line },
      liveStatus: edgePts >= pick.threshold ? "playable" : "edge-gone",
      logHref: logHref(pick, line, price),
    };
  }));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  return { ...card, picks, loadedAt: new Date(now).toISOString(), today, source: card };
}
