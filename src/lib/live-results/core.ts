import { nflEspnId } from "../live-lines/core.ts";
import type { GameResult, MyBet } from "../my-bets/grade.ts";
export type NflCandidate = { eventId: string; home: string; away: string; startsAt: string };
export function nflCandidate(bet: Pick<MyBet, "eventId" | "eventStart">, now = Date.now()): NflCandidate | null {
  const match = /^nfl:\d{4}_\d{2}_([A-Z]{2,3})_([A-Z]{2,3})$/.exec(bet.eventId ?? "");
  const start = Date.parse(bet.eventStart ?? "");
  if (!match || !Number.isFinite(start) || start > now || now - start > 4 * 86_400_000) return null;
  return { eventId: bet.eventId!, home: match[2], away: match[1], startsAt: bet.eventStart! };
}
export function nflFinalResults(payload: unknown, candidates: NflCandidate[]): GameResult[] {
  const data = payload as { events?: Array<{ id?: string; status?: { type?: { completed?: boolean; name?: string } }; competitions?: Array<{ competitors?: Array<{ homeAway?: string; score?: string }> }> }> } | null;
  if (!Array.isArray(data?.events)) return [];
  const events = data.events.filter(event => event && typeof event === "object" && event.status?.type?.completed === true && event.status.type.name === "STATUS_FINAL");
  const rows: GameResult[] = [];
  for (const game of candidates) {
    const id = nflEspnId({ events }, game.home, game.away, game.startsAt);
    const event = events.find(e => String(e.id) === id);
    const competitors = event?.competitions?.[0]?.competitors;
    const h = competitors?.find(c => c.homeAway === "home")?.score;
    const a = competitors?.find(c => c.homeAway === "away")?.score;
    if (typeof h !== "string" || typeof a !== "string" || !/^\d+$/.test(h) || !/^\d+$/.test(a)) continue;
    const homeScore = Number(h), awayScore = Number(a);
    if (!Number.isSafeInteger(homeScore) || !Number.isSafeInteger(awayScore)) continue;
    rows.push({ ...game, homeScore, awayScore });
  }
  return rows;
}
