/** Pure ESPN odds rules, shared with tests. No fetching or artifact reads here. */
import type { SportUpcoming } from "../model-reports.ts";

export const LIVE_LINE_TTL_MS = 3 * 60_000;
export function isFreshLiveLine(observedAt: string | null | undefined, now: number) {
  const observed = observedAt ? Date.parse(observedAt) : NaN;
  return Number.isFinite(observed) && observed <= now && now - observed < LIVE_LINE_TTL_MS;
}
export const FEATURED_PER_SPORT = 6;
export const LIVE_SPORTS = ["nfl", "ncaaf", "nba", "ncaab"] as const;
export type LiveSport = typeof LIVE_SPORTS[number];
export type LiveLine = {
  spread: number | null; homeSpreadPrice: number | null; awaySpreadPrice: number | null;
  homeMl: number | null; awayMl: number | null; total: number | null; books: number; observedAt: string;
};
export const isLiveSport = (sport: string): sport is LiveSport => LIVE_SPORTS.some((s) => s === sport);
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
function number(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === "boolean" || String(v).trim() === "") return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}
function american(v: unknown) {
  const b = obj(v), raw = b.american ?? b.value ?? v;
  return number(typeof raw === "string" ? raw.replace(/EVEN|even/g, "100") : raw);
}
function legal(v: number | null) {
  if (v === null) return null;
  if (Math.abs(v) < 1) return null;
  return Math.abs(v) < 100 ? (v < 0 ? -100 : 100) : v;
}
function median(values: Array<number | null>) {
  const a = values.filter((n): n is number => n !== null).sort((a, b) => a - b);
  const m = Math.floor(a.length / 2);
  return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null;
}
// Python round uses ties-to-even, including when medians fall on a half price.
function priceMedian(values: Array<number | null>) {
  const n = median(values);
  if (n === null) return null;
  const floor = Math.floor(n);
  const rounded = n - floor === .5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(n);
  return Math.abs(rounded) < 100 ? (rounded < 0 ? -100 : 100) : rounded;
}
const EXCLUDED = ["live", "accuscore", "numberfire", "teamrankings", "consensus", "pickcenter"];

/** Mirrors adapters/espn_odds.py book_row + consolidate: close overrides top-level,
 * home handicap, paired moneylines, medians over real books only. */
export function consolidateLiveLines(payload: unknown, observedAt: string): LiveLine | null {
  const items = obj(payload).items;
  if (!Array.isArray(items)) return null;
  const books = items.flatMap((raw) => {
    const item = obj(raw), provider = obj(item.provider).name;
    if (typeof provider !== "string" || !provider || EXCLUDED.some((s) => provider.toLowerCase().includes(s))) return [];
    const h = obj(item.homeTeamOdds), a = obj(item.awayTeamOdds), hc = obj(h.close), ac = obj(a.close);
    let spread = number(item.spread);
    if (spread !== null && h.favorite !== null && h.favorite !== undefined) spread = h.favorite ? -Math.abs(spread) : Math.abs(spread);
    const book = {
      spread: american(hc.pointSpread) ?? spread,
      homeSpreadPrice: legal(american(hc.spread) ?? number(h.spreadOdds)),
      awaySpreadPrice: legal(american(ac.spread) ?? number(a.spreadOdds)),
      homeMl: legal(american(hc.moneyLine) ?? number(h.moneyLine)),
      awayMl: legal(american(ac.moneyLine) ?? number(a.moneyLine)), total: number(item.overUnder),
    };
    return [book.spread, book.homeMl, book.awayMl, book.total].every((v) => v === null) ? [] : [book];
  });
  if (!books.length) return null;
  const paired = books.filter((b) => b.homeMl !== null && b.awayMl !== null);
  const spreads = books.filter((b) => b.spread !== null);
  return {
    spread: median(spreads.map((b) => b.spread)),
    homeSpreadPrice: priceMedian(spreads.map((b) => b.homeSpreadPrice)),
    awaySpreadPrice: priceMedian(spreads.map((b) => b.awaySpreadPrice)),
    homeMl: priceMedian(paired.map((b) => b.homeMl)), awayMl: priceMedian(paired.map((b) => b.awayMl)),
    total: median(books.map((b) => b.total)), books: books.length, observedAt,
  };
}

export function noVigHome(home: number | null, away: number | null): number | null {
  if (home === null || away === null || !Number.isFinite(home) || !Number.isFinite(away) || Math.abs(home) < 100 || Math.abs(away) < 100) return null;
  const implied = (p: number) => p < 0 ? -p / (-p + 100) : 100 / (p + 100);
  const h = implied(home), a = implied(away);
  return h / (h + a);
}

export function liveEdge(margin: number | null, spread: number | null, threshold: number | null | undefined) {
  const edgePts = margin !== null && spread !== null && Number.isFinite(margin) && Number.isFinite(spread) ? margin + spread : null;
  const lean = edgePts === null || threshold == null || !Number.isFinite(threshold) || threshold <= 0 ? null
    : Math.abs(edgePts) < threshold ? "none" : edgePts > 0 ? "home" : "away";
  return { edgePts, lean };
}

/** A moneyline is flagged only when the model's win probability beats the price by this much
 *  expected value, and never on a long shot: past +300 the backtests lose about 20% a bet. */
export const ML_MIN_EV = 0.08;
export const ML_MAX_PRICE = 300;
/** Past this the model and the price are too far apart to be anything but a rating error. */
export const ML_MAX_EV = 0.5;
export type MoneylineValue = { side: "home" | "away"; team: string; price: number; modelProb: number; breakEven: number; ev: number; underdog: boolean };

/** The one moneyline worth a look in this game, or null. Favorites are not flagged for being
 *  favorites: the price has to be better than the model's own win probability requires. */
export function moneylineValue(game: SportUpcoming, live: LiveLine | null = null): MoneylineValue | null {
  const pHome = game.homeWinProb;
  if (pHome == null || !Number.isFinite(pHome) || pHome <= 0 || pHome >= 1) return null;
  const paired = live && live.homeMl !== null && live.awayMl !== null;
  const homeMl = paired ? live.homeMl : game.marketHomeMl, awayMl = paired ? live.awayMl : game.marketAwayMl;
  const side = (which: "home" | "away", price: number | null | undefined, p: number): MoneylineValue | null => {
    if (price == null || !Number.isFinite(price) || Math.abs(price) < 100 || price > ML_MAX_PRICE) return null;
    const payout = price > 0 ? price / 100 : 100 / -price;
    const ev = p * payout - (1 - p);
    return ev < ML_MIN_EV || ev > ML_MAX_EV ? null : { side: which, team: which === "home" ? game.home : game.away, price, modelProb: p, breakEven: 1 / (1 + payout), ev, underdog: price > 0 };
  };
  const home = side("home", homeMl, pHome), away = side("away", awayMl, 1 - pHome);
  return home && away ? (home.ev >= away.ev ? home : away) : home ?? away;
}

/** Select exactly the default featured rows; filters/Show all never grow the network slate. */
export function featuredLiveKeys(items: Array<{ key: string; sport: string; startsAt: string; isToday: boolean }>, now: number) {
  const counts = new Map<string, number>();
  return new Set(items.filter((item) => {
    const start = Date.parse(item.startsAt), n = counts.get(item.sport) ?? 0;
    if (!isLiveSport(item.sport) || !item.isToday || start <= now || start > now + 86_400_000 || n >= FEATURED_PER_SPORT) return false;
    counts.set(item.sport, n + 1);
    return true;
  }).map((item) => item.key));
}

export function gameBetTerms(game: SportUpcoming, live: LiveLine | null = null) {
  const pickHome = (game.homeWinProb ?? .5) >= .5;
  const handicap = live ? live.spread : game.marketHomeSpread;
  const isSpread = handicap != null;
  // Never combine a spread with the moneyline price (the old link did this).
  const price = live ? (isSpread ? (pickHome ? live.homeSpreadPrice : live.awaySpreadPrice) : (pickHome ? live.homeMl : live.awayMl))
    : isSpread ? (pickHome ? game.marketHomePrice : game.marketAwayPrice) : (pickHome ? game.marketHomeMl : game.marketAwayMl);
  const homeProb = live ? noVigHome(live.homeMl, live.awayMl) : noVigHome(game.marketHomeMl, game.marketAwayMl) ?? game.marketHomeWinProb ?? null;
  return {
    market: isSpread ? "spread" : "moneyline", selection: pickHome ? game.home : game.away,
    line: isSpread ? (pickHome ? handicap : -handicap) : null, price: price ?? null,
    // Saved cover probabilities describe the saved line only. Live cover probabilities need the model distribution.
    modelProb: isSpread ? (live ? null : pickHome ? game.homeCoverProb : game.awayCoverProb) : (pickHome ? game.homeWinProb : game.homeWinProb == null ? null : 1 - game.homeWinProb),
    marketProb: homeProb === null ? null : pickHome ? homeProb : 1 - homeProb,
  };
}

/** NFL reports use nflverse ids. Require an exact home/away/date match; never guess. */
export function nflEspnId(payload: unknown, home: string, away: string, startsAt: string): string | null {
  const aliases: Record<string, string> = { WSH: "WAS", LAR: "LA" };
  const normalize = (v: unknown) => aliases[String(v)] ?? String(v);
  const events = obj(payload).events;
  if (!Array.isArray(events)) return null;
  const matches = events.filter((raw) => {
    const event = obj(raw), competitions = event.competitions;
    if (!Array.isArray(competitions)) return false;
    return competitions.some((rawComp) => {
      const comp = obj(rawComp), competitors = comp.competitors;
      if (!Array.isArray(competitors) || Math.abs(Date.parse(String(comp.date ?? event.date)) - Date.parse(startsAt)) > 60_000) return false;
      return ["home", "away"].every((side) => competitors.some((rawTeam) => {
        const team = obj(rawTeam);
        return team.homeAway === side && normalize(obj(team.team).abbreviation) === normalize(side === "home" ? home : away);
      }));
    });
  });
  const id = matches.length === 1 ? String(obj(matches[0]).id ?? "") : "";
  return /^\d+$/.test(id) ? id : null;
}
