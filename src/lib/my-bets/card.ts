import type { DailyCard } from "../model-reports.ts";
import type { NewBet } from "../my-bets.ts";
import { teamName, type TeamNames } from "../team-names.ts";

/** Listed terms are the starting point; personal edits never change the published card. */
export function cardBetInputs(card: DailyCard, names: TeamNames, now = new Date()): NewBet[] {
  return card.picks.filter(pick => pick.stakeUnits > 0).map(pick => ({
    sport: pick.sport, eventId: pick.id,
    eventLabel: `${teamName(names, pick.sport, pick.away)} at ${teamName(names, pick.sport, pick.home)}`,
    eventStart: pick.startsAt, market: "spread", selection: pick.pick,
    selectionLabel: `${pick.pick} ${pick.line > 0 ? "+" : ""}${pick.line}`,
    line: pick.line, price: pick.price, stake: 1,
    book: pick.book, note: null, modelProb: null,
    marketProb: pick.breakEvenProb, placedAt: now.toISOString(),
  }));
}
