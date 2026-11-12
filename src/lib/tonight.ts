import "server-only";

import { teamLabel, type TeamNames } from "@/lib/team-names";

import { american, fairAmerican, num, probability as pct, signed, spread } from "@/lib/format";
import {
  SPORT_LABELS, getTeamNames, getLedgerIndex, getUpcomingRaceBoards, listSportReports,
  type LedgerEventSummary, type RaceBoard, type SportReport, type SportUpcoming, type TeamForm,
} from "@/lib/model-reports";
import { forecastReadiness, hasMarket, isUpcomingGame, validProbability, type ForecastReadiness } from "@/lib/forecast-readiness";
import { getLiveLines, resolveNflEvent } from "@/lib/live-lines";
import { featuredLiveKeys, gameBetTerms, isLiveSport, liveEdge, noVigHome, type LiveLine } from "@/lib/live-lines/core";
import { todayDateString } from "@/lib/races";

/** One scannable item on the Tonight board: a game or a race, with a pick, a confidence,
 *  the statistical rationale, the matchup comparison and the market. Built server-side
 *  from the engines' reports so the page itself stays simple. */

export type ConfidenceLabel = "High" | "Medium" | "Low";

export type MatchupRow = { label: string; a: string; b: string; hint?: string };

export type TonightMarket = {
  observedAt: string | null;
  spreadLabel: string | null; spreadPrices: string | null; moneyline: string | null;
  marketWinProb: number | null; modelWinProb: number | null; fairPrice: string | null;
  coverProb: number | null; edgePts: number | null; lean: string | null; book: string | null; note: string | null;
};

export type TonightItem = {
  key: string; kind: "game" | "race"; sport: string; sportLabel: string;
  startsAt: string; startsAtLabel: string; isToday: boolean; dayKey: string;
  title: string; subtitle: string;
  homeTeam?: string; awayTeam?: string;
  pick: string; pickDetail: string;
  /** Probability the pick beats its main rival: win probability for a game, head-to-head versus the runner-up for a race. */
  confidence: number; confidenceLabel: ConfidenceLabel;
  rationale: string[];
  matchupHeaders: [string, string]; matchup: MatchupRow[];
  raceTable?: Array<{ rank: number; driver: string; car: string | null; win: number; top3: number | null; expectedFinish: number | null; last5: string; elo: number | null }>;
  market: TonightMarket | null;
  liveMarket?: TonightMarket | null;
  liveStatus?: "available" | "unavailable";
  savedLogHref?: string;
  readiness?: ForecastReadiness;
  ledger: { open: number; graded: number; record: string | null; recordedAt: string | null } | null;
  href: string;
  /** Prefilled link to log this pick on the My bets page. */
  logHref: string;
};

const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

function dayKeyOf(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function label(confidence: number): ConfidenceLabel {
  return confidence >= 0.72 ? "High" : confidence >= 0.6 ? "Medium" : "Low";
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function formLine(team: string, form: TeamForm | null | undefined) {
  if (!form) return `${team}: no completed games this season yet.`;
  const record = form.ties ? `${form.wins}-${form.losses}-${form.ties}` : `${form.wins}-${form.losses}`;
  return `${team} is ${record} this season (last five ${form.lastRecord}, average margin ${signed(form.avgMargin)}).`;
}

function lastFive(form: TeamForm | null | undefined) {
  if (!form || !form.last.length) return "—";
  return form.last.map((r) => `${r.margin > 0 ? "W" : r.margin < 0 ? "L" : "T"}${Math.abs(r.margin)}`).join(" ");
}

function ledgerSummary(summary: LedgerEventSummary | undefined): TonightItem["ledger"] {
  if (!summary) return null;
  return {
    open: summary.open, graded: summary.graded,
    record: summary.graded ? `${summary.wins}-${summary.losses}-${summary.pushes}` : null,
    recordedAt: summary.firstForecastAt,
  };
}

function gameItem(report: SportReport, game: SportUpcoming, ledger: Map<string, LedgerEventSummary>, today: string, now: number, live: LiveLine | null = null, names: TeamNames = {}): TonightItem {
  const homeWin = game.homeWinProb ?? 0.5;
  const pickHome = homeWin >= 0.5;
  const pick = pickHome ? game.home : game.away;
  const other = pickHome ? game.away : game.home;
  const confidence = pickHome ? homeWin : 1 - homeWin;
  const margin = game.projectedHomeMargin ?? 0;
  const pickMargin = pickHome ? margin : -margin;
  const hr = game.homeRating ?? null;
  const ar = game.awayRating ?? null;
  const pr = pickHome ? hr : ar;
  const orr = pickHome ? ar : hr;
  const teams = report.ratings.length;
  const unit = report.sport === "mlb" ? "runs" : report.sport === "nhl" ? "goals" : "points";
  const neutral = Boolean(game.neutral);
  const hfa = game.homeAdvantage ?? null;

  const rationale: string[] = [];
  if (pr && orr) {
    rationale.push(`${pick} rates ${signed(pr.rating)} (${ordinal(pr.rank)} of ${teams}) against ${other} at ${signed(orr.rating)} (${ordinal(orr.rank)}): a ${num(Math.abs(pr.rating - orr.rating), 1)}-${unit.slice(0, -1)} gap in team strength.`);
  }
  if (neutral) rationale.push("Neutral site, so no home advantage is applied.");
  else if (hfa !== null) rationale.push(`${game.home} is at home, worth about ${signed(hfa)} ${unit} in this league right now.`);
  rationale.push(`Projected margin: ${pick} by ${num(Math.abs(pickMargin), 1)} ${unit}, with a typical miss of ±${num(game.marginSd, 1)}. Model-only win probability: ${pct(confidence, 0)}. Winning outright and covering the spread are different outcomes.`);
  rationale.push(formLine(game.home, game.homeForm));
  rationale.push(formLine(game.away, game.awayForm));
  if (pr && pr.sd >= 3) rationale.push(`Rating uncertainty is still wide (SD ${num(pr.sd, 1)}); early-season ratings move fast.`);
  const fixedLine = report.sport === "nhl" || report.sport === "mlb";
  if (fixedLine && game.marketHomeWinProb !== null && game.marketHomeWinProb !== undefined) {
    const mktPick = pickHome ? game.marketHomeWinProb : 1 - game.marketHomeWinProb;
    rationale.push(`The market prices ${pick} to win ${pct(mktPick, 0)} after removing the vig against the model's ${pct(confidence, 0)}; in ${unit} that is a ${signed(game.edgePts ?? 0, 2)} gap (${game.lean && game.lean !== "none" ? `leans ${game.lean === "home" ? game.home : game.away}` : "inside the lean threshold"}). The listed ${game.home} ${spread(game.marketHomeSpread)} is a fixed ${report.sport === "mlb" ? "run" : "puck"} line, not a margin estimate.`);
  } else if (game.marketHomeSpread !== null && game.marketHomeSpread !== undefined) {
    const mktMargin = -game.marketHomeSpread;
    const mktWin = game.marketHomeWinProb ?? null;
    const diff = margin - mktMargin;
    rationale.push(`The market has ${game.home} ${spread(game.marketHomeSpread)}${mktWin !== null ? ` and prices ${game.home} to win ${pct(mktWin, 0)} after removing the vig` : ""}; the model's margin differs by ${signed(diff, 1)} ${unit} (${game.lean && game.lean !== "none" ? `leans ${game.lean === "home" ? game.home : game.away}` : "inside the lean threshold"}).`);
  } else {
    rationale.push("No spread in the public source for this game. Any saved moneyline is shown separately; there is no supported spread comparison.");
  }
  const blended = game.stackedMarketHomeWinProb ?? null;
  if (blended !== null) {
    const blendedPick = pickHome ? blended : 1 - blended;
    rationale.push(`The market-informed estimate gives ${pick} ${pct(blendedPick, 0)} to win, versus ${pct(confidence, 0)} without the line. This estimate uses the market as an input, so it is not independent confirmation of an edge.`);
  }
  if (game.headline === "stacked") rationale.push(`Headline numbers use the stacked layer: ratings, rest and back-to-backs${report.sport === "mlb" ? ", plus probable pitchers" : ""}. Game-day injuries and confirmed lineups are not included.`);

  const matchup: MatchupRow[] = [
    { label: "Rating", a: hr ? `${signed(hr.rating)} (${ordinal(hr.rank)})` : "—", b: ar ? `${signed(ar.rating)} (${ordinal(ar.rank)})` : "—", hint: `${unit} above average on a neutral field` },
    { label: "Rating SD", a: hr ? num(hr.sd, 1) : "—", b: ar ? num(ar.sd, 1) : "—" },
    { label: "Season", a: game.homeForm ? `${game.homeForm.wins}-${game.homeForm.losses}${game.homeForm.ties ? `-${game.homeForm.ties}` : ""}` : "—", b: game.awayForm ? `${game.awayForm.wins}-${game.awayForm.losses}${game.awayForm.ties ? `-${game.awayForm.ties}` : ""}` : "—" },
    { label: "Avg margin", a: game.homeForm ? signed(game.homeForm.avgMargin) : "—", b: game.awayForm ? signed(game.awayForm.avgMargin) : "—" },
    { label: "Last five", a: lastFive(game.homeForm), b: lastFive(game.awayForm), hint: "most recent last" },
    { label: "Win prob", a: pct(homeWin, 0), b: pct(1 - homeWin, 0) },
  ];

  const spreadLabel = game.marketHomeSpread === null || game.marketHomeSpread === undefined ? null : `${game.home} ${spread(game.marketHomeSpread)}`;
  const market: TonightMarket | null = hasMarket(game)
    ? {
        observedAt: game.lineObservedAt ?? null,
        spreadLabel,
        spreadPrices: game.marketHomePrice !== null && game.marketHomePrice !== undefined ? `${american(game.marketHomePrice)} / ${american(game.marketAwayPrice)}` : null,
        moneyline: game.marketHomeMl !== null && game.marketHomeMl !== undefined ? `${game.home} ${american(game.marketHomeMl)} · ${game.away} ${american(game.marketAwayMl)}` : null,
        marketWinProb: pickHome ? (game.marketHomeWinProb ?? null) : game.marketHomeWinProb !== null && game.marketHomeWinProb !== undefined ? 1 - game.marketHomeWinProb : null,
        modelWinProb: confidence, fairPrice: fairAmerican(confidence),
        coverProb: pickHome ? (game.homeCoverProb ?? null) : (game.awayCoverProb ?? null),
        edgePts: game.edgePts ?? null,
        lean: game.lean && game.lean !== "none" ? (game.lean === "home" ? game.home : game.away) : null,
        book: game.book ?? null, note: game.note ?? null,
      }
    : null;

  const liveHomeProb = live ? noVigHome(live.homeMl, live.awayMl) : null;
  const liveComparison = live ? liveEdge(game.projectedHomeMargin, live.spread, report.backtest?.selectionThreshold) : null;
  const liveMarket: TonightMarket | null = live ? {
    observedAt: live.observedAt,
    spreadLabel: live.spread === null ? null : `${game.home} ${spread(live.spread)}`,
    spreadPrices: live.homeSpreadPrice !== null || live.awaySpreadPrice !== null ? `${american(live.homeSpreadPrice)} / ${american(live.awaySpreadPrice)}` : null,
    moneyline: live.homeMl === null ? null : `${game.home} ${american(live.homeMl)} · ${game.away} ${american(live.awayMl)}`,
    marketWinProb: liveHomeProb === null ? null : pickHome ? liveHomeProb : 1 - liveHomeProb,
    modelWinProb: confidence, fairPrice: fairAmerican(confidence), coverProb: null,
    edgePts: liveComparison?.edgePts ?? null,
    lean: liveComparison?.lean === "home" ? game.home : liveComparison?.lean === "away" ? game.away : null,
    book: `ESPN multi-book median (${live.books} books)`,
    note: report.backtest?.selectionThreshold == null ? "Lean unavailable: report has no selection threshold." : `Lean threshold: ${report.backtest.selectionThreshold} points.`,
  } : null;
  const key = `${report.sport}:${game.gameId}`;
  return {
    key, kind: "game", sport: report.sport, sportLabel: report.label,
    homeTeam: game.home, awayTeam: game.away,
    startsAt: game.startsAt, startsAtLabel: `${dayFmt.format(new Date(game.startsAt))} · ${timeFmt.format(new Date(game.startsAt))} ET`,
    isToday: dayKeyOf(game.startsAt) === today, dayKey: dayKeyOf(game.startsAt),
    title: `${teamLabel(names, report.sport, game.away)} at ${teamLabel(names, report.sport, game.home)}`, subtitle: `${report.label}${neutral ? " · neutral site" : ""}`,
    pick: teamLabel(names, report.sport, pick), pickDetail: `${teamLabel(names, report.sport, pick)} to win · projected by ${num(Math.abs(pickMargin), 1)}`,
    confidence, confidenceLabel: label(confidence), rationale,
    matchupHeaders: [teamLabel(names, report.sport, game.home), teamLabel(names, report.sport, game.away)], matchup, market, liveMarket,
    readiness: forecastReadiness(report, game, now),
    ledger: ledgerSummary(ledger.get(key)), href: `/sports/${report.sport}`,
    logHref: logBetHref({
      sport: report.sport, eventId: key, eventLabel: `${game.away} at ${game.home}`, eventStart: game.startsAt,
      ...gameBetTerms(fixedLine ? { ...game, marketHomeSpread: null } : game, live),
    }),
  };
}

function raceItem(board: RaceBoard, ledger: Map<string, LedgerEventSummary>, today: string): TonightItem {
  const top = board.rows[0];
  const second = board.rows[1] ?? null;
  let headToHead = second ? top.probability / (top.probability + second.probability) : top.probability;
  if (board.pairwise && second) {
    const i = board.pairwise.driverIds.indexOf(top.driverId);
    const j = board.pairwise.driverIds.indexOf(second.driverId);
    if (i >= 0 && j >= 0) headToHead = board.pairwise.probabilities[i][j];
  }
  const startsAt = `${board.race.race_date}T23:30:00Z`;
  const rationale: string[] = [];
  rationale.push(`${top.driverName} is ${pct(top.probability, 0)} to win a ${board.fieldSize}-car field, ${pct(top.top3Probability, 0)} to finish top three, with an expected finish of ${num(top.expectedFinish, 1)}.`);
  if (second) rationale.push(`Runner-up in the model is ${second.driverName} at ${pct(second.probability, 0)}; head to head the model has ${top.driverName} ahead ${pct(headToHead, 0)} of the time.`);
  for (const factor of top.factors.slice(0, 3)) {
    const direction = factor.value > 0 ? "lifts" : "drags";
    rationale.push(`${factor.meaning.charAt(0).toUpperCase()}${factor.meaning.slice(1)}${factor.raw !== null ? ` (${num(factor.raw, 2)})` : ""} ${direction} ${top.driverName} ${signed(factor.value, 2)} relative to the field.`);
  }
  if (top.recentFinishes.length) rationale.push(`Last ${top.recentFinishes.length} finishes: ${top.recentFinishes.map((r) => r.finish).join(", ")}${top.trackStarts ? `; ${top.trackStarts} prior starts here averaging ${num(top.trackAvgFinish, 1)}` : "; no prior starts at this track"}.`);
  rationale.push(board.stage === "race-night"
    ? `Race-night model: starting spots (${board.readiness.starts}/${board.fieldSize}), qualifying (${board.readiness.qualifying}/${board.fieldSize}) and heats (${board.readiness.heats}/${board.fieldSize}) are in.`
    : `Early model: starting spots and heat results are not in yet, so this is form and history only. Probabilities tighten after qualifying.`);
  if (board.calibrationTemperature && Math.abs(board.calibrationTemperature - 1) > 0.02) rationale.push(`Probabilities are tempered by ${num(board.calibrationTemperature, 2)} from the out-of-sample calibration fit.`);

  const matchup: MatchupRow[] = second
    ? [
        { label: "Win", a: pct(top.probability, 1), b: pct(second.probability, 1) },
        { label: "Top three", a: pct(top.top3Probability, 0), b: pct(second.top3Probability, 0) },
        { label: "Expected finish", a: num(top.expectedFinish, 1), b: num(second.expectedFinish, 1) },
        { label: "Elo", a: top.elo === null ? "—" : num(top.elo, 0), b: second.elo === null ? "—" : num(second.elo, 0) },
        { label: "Last five", a: top.recentFinishes.map((r) => r.finish).join(" ") || "—", b: second.recentFinishes.map((r) => r.finish).join(" ") || "—", hint: "finishing positions, most recent last" },
        { label: "Here", a: top.trackStarts ? `${top.trackStarts} starts, avg ${num(top.trackAvgFinish, 1)}` : "no starts", b: second.trackStarts ? `${second.trackStarts} starts, avg ${num(second.trackAvgFinish, 1)}` : "no starts" },
        { label: "Starting spot", a: top.startingPosition === null ? "TBD" : String(top.startingPosition), b: second.startingPosition === null ? "TBD" : String(second.startingPosition) },
      ]
    : [];

  const raceTable = board.rows.map((row, index) => ({
    rank: index + 1, driver: row.driverName, car: row.carNumber, win: row.probability, top3: row.top3Probability,
    expectedFinish: row.expectedFinish, last5: row.recentFinishes.map((r) => r.finish).join(" ") || "—", elo: row.elo,
  }));

  const key = `race:${board.race.id}`;
  return {
    key, kind: "race", sport: "racing", sportLabel: SPORT_LABELS.racing,
    startsAt, startsAtLabel: `${dayFmt.format(new Date(startsAt))} · ${board.race.track_name}`,
    isToday: board.race.race_date === today, dayKey: board.race.race_date,
    title: board.race.name, subtitle: `${board.modelSeries ?? board.race.division} · ${board.race.track_name}`,
    pick: top.driverName, pickDetail: `${top.driverName} to win · ${pct(top.probability, 0)} · fair ${fairAmerican(top.probability)}`,
    confidence: headToHead, confidenceLabel: label(headToHead), rationale,
    matchupHeaders: [top.driverName, second?.driverName ?? "Field"], matchup, raceTable,
    market: null,
    ledger: ledgerSummary(ledger.get(key)), href: `/admin/races/${board.race.id}/prediction`,
    logHref: logBetHref({
      sport: "racing", eventId: key, eventLabel: board.race.name, eventStart: startsAt, market: "win",
      selection: `driver:${top.driverId}`, selectionLabel: `${top.driverName} to win`, line: null, price: null,
      modelProb: top.probability, marketProb: null,
    }),
  };
}

function logBetHref(p: { sport: string; eventId: string; eventLabel: string; eventStart: string; market: string; selection: string; selectionLabel?: string;
  line: number | null; price: number | null; modelProb: number | null; marketProb: number | null }): string {
  const q = new URLSearchParams();
  q.set("sport", p.sport); q.set("eventId", p.eventId); q.set("eventLabel", p.eventLabel); q.set("eventStart", p.eventStart);
  q.set("market", p.market); q.set("selection", p.selection);
  if (p.selectionLabel) q.set("selectionLabel", p.selectionLabel);
  if (p.line !== null) q.set("line", String(p.line));
  if (p.price !== null) q.set("price", String(p.price));
  if (p.modelProb !== null) q.set("modelProb", p.modelProb.toFixed(4));
  if (p.marketProb !== null) q.set("marketProb", p.marketProb.toFixed(4));
  return `/bets?${q.toString()}#log`;
}

export type TonightBoard = {
  today: string; generatedAt: string;
  /** Newest forecast run among the sport reports: the age of every saved line and lean. */
  refreshedAt: string | null;
  items: TonightItem[];
  sports: Array<{ sport: string; label: string; count: number }>;
};

export async function buildTonightBoard(horizonDays = 7, options: { live?: boolean } = {}): Promise<TonightBoard> {
  const now = Date.now();
  const today = todayDateString();
  const ledger = getLedgerIndex();
  const reports = listSportReports();
  const names = getTeamNames();
  const limit = new Date(`${today}T05:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + horizonDays + 1);
  const items: TonightItem[] = [];
  const gamesByKey = new Map<string, { report: SportReport; game: SportUpcoming }>();
  const placeholders = new Set(["NON_D1", "FCS"]);
  for (const report of reports) {
    for (const game of report.upcoming) {
      if (!isUpcomingGame(game, now, limit.getTime()) || !validProbability(game.homeWinProb)) continue;
      // Pooled placeholder opponents (non-Division-I, FCS) are rating sinks, not matchups worth showing.
      if (placeholders.has(game.home) || placeholders.has(game.away)) continue;
      const item = gameItem(report, game, ledger, today, now, null, names);
      items.push(item);
      gamesByKey.set(item.key, { report, game });
    }
  }
  for (const board of getUpcomingRaceBoards(12, 8)) {
    if (!board.rows.length) continue;
    items.push(raceItem(board, ledger, today));
  }
  items.sort((a, b) => Number(b.isToday) - Number(a.isToday) || a.dayKey.localeCompare(b.dayKey) || b.confidence - a.confidence || a.startsAt.localeCompare(b.startsAt));
  if (options.live !== false) {
    const featured = featuredLiveKeys(items, now);
    await Promise.all(items.map(async (item, index) => {
      if (!featured.has(item.key) || !isLiveSport(item.sport)) return;
      const { report, game } = gamesByKey.get(item.key)!;
      const id = item.sport === "nfl" ? await resolveNflEvent(game) : game.gameId;
      const live = id ? (await getLiveLines(item.sport, [id])).get(id) ?? null : null;
      items[index] = { ...gameItem(report, game, ledger, today, now, live, names),
        liveStatus: live ? "available" : "unavailable", savedLogHref: item.logHref };
    }));
  }
  const counts = new Map<string, { sport: string; label: string; count: number }>();
  for (const item of items) {
    const entry = counts.get(item.sport) ?? { sport: item.sport, label: item.sportLabel, count: 0 };
    entry.count += 1;
    counts.set(item.sport, entry);
  }
  const refreshedAt = reports
    .map((report) => typeof report.forecastGeneratedAt === "string" ? report.forecastGeneratedAt : report.generatedAt)
    .filter((stamp) => Number.isFinite(Date.parse(stamp)))
    .sort().at(-1) ?? null;
  return { today, generatedAt: new Date().toISOString(), refreshedAt, items, sports: [...counts.values()] };
}
