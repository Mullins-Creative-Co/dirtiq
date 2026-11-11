import "server-only";

import { consolidateLiveLines, LIVE_LINE_TTL_MS, nflEspnId, type LiveLine, type LiveSport } from "./live-lines/core.ts";

const LEAGUES: Record<LiveSport, string> = {
  nba: "basketball/nba", ncaab: "basketball/mens-college-basketball",
  ncaaf: "football/college-football", nfl: "football/nfl",
};
type ResponseData = { payload: unknown; observedAt: string };
const cache = new Map<string, { expires: number; value: Promise<ResponseData | null> }>();
const waiting: Array<() => void> = [];
let active = 0;

async function json(url: string): Promise<ResponseData | null> {
  const saved = cache.get(url);
  if (saved && saved.expires > Date.now()) return saved.value;
  const entry = { expires: Infinity, value: Promise.resolve(null) as Promise<ResponseData | null> };
  entry.value = (async () => {
    if (active >= 12) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    let value: unknown = null;
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0 (dirtiq-live-lines)" } });
      if (response.ok) value = await response.json();
    } catch { /* An outage is a null result, never a page error. */ }
    finally {
      const next = waiting.shift();
      if (next) next(); else active--;
    }
    entry.expires = Date.now() + (value === null ? 30_000 : LIVE_LINE_TTL_MS);
    return value === null ? null : { payload: value, observedAt: new Date().toISOString() };
  })();
  cache.set(url, entry);
  // Bound memory on long-lived servers; don't evict in-flight requests.
  if (cache.size > 2048) for (const [key, value] of cache) {
    if (value.expires !== Infinity) cache.delete(key);
    if (cache.size <= 2048) break;
  }
  return entry.value;
}

/** Fetch ESPN ids in parallel, with a process-wide 12-request limit and three-minute cache. */
export async function getLiveLines(sport: LiveSport, eventIds: string[]): Promise<Map<string, LiveLine | null>> {
  const entries = await Promise.all([...new Set(eventIds)].map(async (id): Promise<[string, LiveLine | null]> => {
    if (!/^\d+$/.test(id)) return [id, null];
    const path = LEAGUES[sport];
    const url = `https://sports.core.api.espn.com/v2/sports/${path.split("/")[0]}/leagues/${path.split("/")[1]}/events/${id}/competitions/${id}/odds?limit=50`;
    const response = await json(url);
    const value = response ? consolidateLiveLines(response.payload, response.observedAt) : null;
    return [id, value];
  }));
  return new Map(entries);
}

export async function resolveNflEvent(game: { home: string; away: string; startsAt: string }): Promise<string | null> {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(game.startsAt)).replaceAll("-", "");
  const payload = await json(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date}&limit=100`);
  return nflEspnId(payload?.payload, game.home, game.away, game.startsAt);
}
