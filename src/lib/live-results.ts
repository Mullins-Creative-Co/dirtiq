import "server-only";
import { nflCandidate, nflFinalResults } from "./live-results/core";
import type { GameResult, MyBet } from "./my-bets/grade";
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** Only missing, linked NFL finals. Never infer a game from a free-text bet. */
export async function getNflFinalResults(bets: MyBet[]): Promise<GameResult[]> {
  const candidates = bets.map(b => nflCandidate(b)).filter(c => c !== null);
  const days = [...new Set(candidates.map(c => date.format(new Date(c.startsAt)).replaceAll("-", "")))];
  const groups = await Promise.all(days.map(async day => {
    try {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day}&limit=100`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) return [];
      return nflFinalResults(await response.json(), candidates);
    } catch { return []; }
  }));
  return [...new Map(groups.flat().map(r => [r.eventId, r])).values()];
}
