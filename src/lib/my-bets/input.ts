import { BET_MARKETS, BET_STATUSES, parsePrice, type BetMarket, type BetStatus, type MyBet } from "./grade.ts";
import type { NewBet, BetGrading } from "../my-bets.ts";
export type ParsedBet = { bet: NewBet; grading: BetGrading };
const text = (fd: FormData, key: string) => typeof fd.get(key) === "string" ? String(fd.get(key)).trim() : "";
const number = (fd: FormData, key: string) => { const raw = text(fd,key); const n = Number(raw); return raw && Number.isFinite(n) ? n : null; };
export function parseBetInput(fd: FormData, now = new Date()): ParsedBet | { error: string } {
  const sport = text(fd,"sport").toLowerCase(), eventLabel = text(fd,"eventLabel");
  const market = text(fd,"market") as BetMarket;
  let selection = text(fd,"selection");
  if (!['nfl','nba','nhl','ncaaf','ncaab','mlb','racing','other'].includes(sport)) return {error:"Pick a sport."};
  if (!eventLabel) return {error:"Name the game or race."};
  if (!BET_MARKETS.includes(market)) return {error:"Pick a market."};
  if (!selection) return {error:"Enter the selection."};
  if (sport === 'nfl') selection = ({BUFF:'BUF',WSH:'WAS',LAR:'LA'} as Record<string,string>)[selection.toUpperCase()] ?? selection;
  const price = parsePrice(text(fd,"price")), stake = number(fd,"stake"), line = number(fd,"line");
  if (price === null) return {error:"Price must be American odds such as -110 or +150."};
  if (stake === null || stake <= 0) return {error:"Stake must be a positive amount."};
  if ((market==='spread'||market==='total') && line===null) return {error:`A ${market} bet needs a line.`};
  if (market==='spread' && line!==null && Math.abs(line)>=100) return {error:"Enter the point spread (for example -10.5). Odds such as -105 belong in Price."};
  const eventId = text(fd,"eventId") || null;
  if (eventId && !eventId.startsWith(sport==='racing'?'race:':`${sport}:`)) return {error:"The game does not match this sport. Choose the game again."};
  const rawDate = text(fd,"placedAt"), placedAt = rawDate ? new Date(rawDate) : now;
  if (!Number.isFinite(placedAt.getTime())) return {error:"Enter a valid bet date."};
  const rawStatus = text(fd,"status") || 'auto';
  if (rawStatus!=='auto' && !BET_STATUSES.includes(rawStatus as BetStatus)) return {error:"Choose a valid result."};
  const grading: BetGrading = rawStatus==='auto'||rawStatus==='open' ? {status:'open',manual:false} : {status:rawStatus as BetGrading['status'],manual:true};
  const selectionLabel = market==='spread' ? `${selection} ${line!>0?'+':''}${line}` : market==='total' ? `${selection} ${line}` : market==='moneyline' ? `${selection} ML` : text(fd,'selectionLabel')||selection;
  return {grading,bet:{sport,eventId,eventLabel,eventStart:text(fd,'eventStart')||null,market,selection,selectionLabel,line,price,stake,
    book:text(fd,'book')||null,note:text(fd,'note')||null,modelProb:number(fd,'modelProb'),marketProb:number(fd,'marketProb'),placedAt:placedAt.toISOString()}};
}

/** Preserve a verified historical grade on annotation/price/stake edits; never reuse probabilities at changed terms. */
export function prepareBetEdit(previous: MyBet, input: ParsedBet): ParsedBet {
  const sameGame = previous.sport===input.bet.sport && previous.eventId===input.bet.eventId && previous.market===input.bet.market && previous.selection===input.bet.selection && previous.line===input.bet.line;
  const sameQuote = sameGame && previous.price===input.bet.price;
  const keepGrade = sameGame && previous.status!=="open" && ((!input.grading.manual&&!previous.manual)||(input.grading.status===previous.status&&input.grading.manual===previous.manual));
  return {bet:{...input.bet,modelProb:sameQuote?previous.modelProb:null,marketProb:sameQuote?previous.marketProb:null},
    grading:keepGrade?{...input.grading,status:previous.status,manual:previous.manual,resultValue:previous.resultValue,settledAt:previous.settledAt}:input.grading};
}
