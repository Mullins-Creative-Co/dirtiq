/** Grading and bookkeeping for bets a person logs. Pure: no I/O, no server-only imports. */

export type BetMarket = "spread" | "moneyline" | "total" | "win" | "top3" | "top5" | "h2h" | "other";
export type BetStatus = "open" | "won" | "lost" | "push" | "void";
export const BET_MARKETS: BetMarket[] = ["spread", "moneyline", "total", "win", "top3", "top5", "h2h", "other"];
export const BET_STATUSES: BetStatus[] = ["open", "won", "lost", "push", "void"];

export type MyBet = {
  id: number;
  sport: string;
  eventId: string | null;        // ledger-style id: "nba:401585184" or "race:1052"
  eventLabel: string;
  eventStart: string | null;     // ISO
  market: BetMarket;
  selection: string;             // team abbreviation, "over"/"under", driver id or free text
  selectionLabel: string;
  line: number | null;           // spread for the selection (negative = laying points) or the total
  price: number;                 // American price
  stake: number;
  book: string | null;
  note: string | null;
  modelProb: number | null;      // model probability of this selection when logged
  marketProb: number | null;     // no-vig market probability when logged
  placedAt: string;              // ISO
  status: BetStatus;
  resultValue: number | null;    // home margin (spread/moneyline), total points, or finishing position
  settledAt: string | null;
  manual: boolean;               // status set by hand; the grader leaves it alone
};

export type GameResult = { eventId: string; home: string; away: string; homeScore: number; awayScore: number; startsAt: string | null };

/** Profit for a settled bet in stake units of currency: +win amount, -stake, or 0. */
export function profit(bet: Pick<MyBet, "stake" | "price" | "status">): number {
  if (bet.status === "won") return round2(bet.stake * winMultiplier(bet.price));
  if (bet.status === "lost") return round2(-bet.stake);
  return 0;
}

export function winMultiplier(price: number): number {
  if (!Number.isFinite(price) || price === 0) return 0;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

export function impliedProbability(price: number): number | null {
  if (!Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
}

/** Grade a team-game bet from a final score. Returns null when it cannot be graded. */
export function gradeGameBet(bet: Pick<MyBet, "market" | "selection" | "line">, result: GameResult): { status: BetStatus; resultValue: number } | null {
  const margin = result.homeScore - result.awayScore;
  const total = result.homeScore + result.awayScore;
  const sel = bet.selection.trim().toUpperCase();
  if (bet.market === "total") {
    if (bet.line === null) return null;
    const side = sel === "OVER" ? 1 : sel === "UNDER" ? -1 : 0;
    if (!side) return null;
    const diff = (total - bet.line) * side;
    return { status: diff > 0 ? "won" : diff < 0 ? "lost" : "push", resultValue: total };
  }
  const isHome = sel === result.home.toUpperCase();
  const isAway = sel === result.away.toUpperCase();
  if (!isHome && !isAway) return null;
  const selMargin = isHome ? margin : -margin;
  if (bet.market === "moneyline") {
    if (selMargin === 0) return { status: "push", resultValue: margin };
    return { status: selMargin > 0 ? "won" : "lost", resultValue: margin };
  }
  if (bet.market === "spread") {
    if (bet.line === null) return null;
    const cover = selMargin + bet.line;
    return { status: cover > 0 ? "won" : cover < 0 ? "lost" : "push", resultValue: margin };
  }
  return null;
}

export type RaceOutcomeRow = { market: string; selection: string; outcome: string | null };

/** Grade a racing bet from settled ledger rows of the same event: a row with the same
 *  market and selection decides it (win/loss/push/void). */
export function gradeRaceBet(bet: Pick<MyBet, "market" | "selection">, rows: RaceOutcomeRow[]): { status: BetStatus } | null {
  const sel = bet.selection.trim().toLowerCase();
  const row = rows.find((r) => r.market === bet.market && r.selection.toLowerCase() === sel && r.outcome !== null);
  if (!row) return null;
  const map: Record<string, BetStatus> = { win: "won", loss: "lost", push: "push", void: "void" };
  const status = map[row.outcome as string];
  return status ? { status } : null;
}

export type BetSummary = {
  bets: number; settled: number; open: number; wins: number; losses: number; pushes: number; voids: number;
  staked: number; openStake: number; profit: number; roi: number | null; winRate: number | null;
  avgPrice: number | null; modelEdgeBets: number; modelEdgeProfit: number;
  bySport: Array<{ sport: string; bets: number; wins: number; losses: number; pushes: number; staked: number; profit: number; roi: number | null }>;
  series: Array<{ at: string; label: string; profit: number; cumulative: number }>;
};

export function summarize(bets: MyBet[]): BetSummary {
  const settled = bets.filter((b) => b.status !== "open");
  const wins = settled.filter((b) => b.status === "won").length;
  const losses = settled.filter((b) => b.status === "lost").length;
  const pushes = settled.filter((b) => b.status === "push").length;
  const voids = settled.filter((b) => b.status === "void").length;
  const decided = settled.filter((b) => b.status === "won" || b.status === "lost");
  const staked = round2(decided.reduce((s, b) => s + b.stake, 0));
  const openStake = round2(bets.filter((b) => b.status === "open").reduce((s, b) => s + b.stake, 0));
  const total = round2(settled.reduce((s, b) => s + profit(b), 0));
  const edge = decided.filter((b) => b.modelProb !== null && b.marketProb !== null && b.modelProb > b.marketProb);
  const sports = new Map<string, MyBet[]>();
  for (const b of bets) sports.set(b.sport, [...(sports.get(b.sport) ?? []), b]);
  const bySport = [...sports.entries()].map(([sport, list]) => {
    const d = list.filter((b) => b.status === "won" || b.status === "lost");
    const st = round2(d.reduce((s, b) => s + b.stake, 0));
    const p = round2(list.reduce((s, b) => s + profit(b), 0));
    return {
      sport, bets: list.length,
      wins: list.filter((b) => b.status === "won").length, losses: list.filter((b) => b.status === "lost").length,
      pushes: list.filter((b) => b.status === "push").length, staked: st, profit: p, roi: st > 0 ? round4(p / st) : null,
    };
  }).sort((a, b) => b.bets - a.bets);
  const ordered = [...settled].sort((a, b) => (a.settledAt ?? a.placedAt).localeCompare(b.settledAt ?? b.placedAt));
  let cumulative = 0;
  const series = ordered.map((b) => {
    const p = profit(b);
    cumulative = round2(cumulative + p);
    return { at: b.settledAt ?? b.placedAt, label: `${b.selectionLabel} ${b.status}`, profit: p, cumulative };
  });
  return {
    bets: bets.length, settled: settled.length, open: bets.length - settled.length, wins, losses, pushes, voids,
    staked, openStake, profit: total, roi: staked > 0 ? round4(total / staked) : null,
    winRate: decided.length ? round4(wins / decided.length) : null,
    avgPrice: decided.length ? Math.round(decided.reduce((s, b) => s + b.price, 0) / decided.length) : null,
    modelEdgeBets: edge.length, modelEdgeProfit: round2(edge.reduce((s, b) => s + profit(b), 0)),
    bySport, series,
  };
}

export function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/\s+/g, "");
  if (!s) return null;
  if (/^(ev|even)$/i.test(s)) return 100;
  const n = Number(s.replace(/^\+/, ""));
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return Math.round(n);
}

function round2(x: number) { return Math.round(x * 100) / 100; }
function round4(x: number) { return Math.round(x * 10000) / 10000; }
