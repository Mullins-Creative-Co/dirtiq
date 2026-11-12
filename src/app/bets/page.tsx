import { connection } from "next/server";
import type { Metadata } from "next";

import { deleteBetAction, setBetStatusAction } from "./actions";
import { PnlChart } from "@/components/bets/pnl-chart";
import { LogBetForm, type EventOption, type LogBetPrefill } from "@/components/bets/log-bet-form";
import { Nav } from "@/components/nav";
import { Card, Chip, EmptyState, Note, PageHeader, Section, StatTile, Table } from "@/components/ui/primitives";
import { listBets, myBetsStorage, settleOpenBets } from "@/lib/my-bets";
import { BET_STATUSES, impliedProbability, profit, summarize } from "@/lib/my-bets/grade";
import { SPORT_LABELS } from "@/lib/model-reports";
import { SITE_NAME } from "@/lib/site";
import { buildTonightBoard } from "@/lib/tonight";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `My bets | ${SITE_NAME}`, description: "Log the bets you place and track profit, ROI and how the model-backed ones do." };

const PREFILL_KEYS = ["sport", "eventId", "eventLabel", "eventStart", "market", "selection", "selectionLabel", "line", "price", "modelProb", "marketProb", "stake", "book", "note"] as const;

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `−${s}` : v > 0 ? `+${s}` : s;
}
function pct(v: number | null | undefined, d = 1): string { return v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`; }
function american(p: number): string { return p > 0 ? `+${p}` : String(p); }
const statusTone = { open: "neutral", won: "good", lost: "bad", push: "neutral", void: "neutral" } as const;

export default async function BetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const prefill: LogBetPrefill = {};
  for (const k of PREFILL_KEYS) { const v = sp[k]; if (typeof v === "string" && v) prefill[k] = v; }
  const graded = await settleOpenBets();
  const bets = await listBets();
  const summary = summarize(bets);
  const board = await buildTonightBoard(10, { live: false });
  const events: EventOption[] = board.items.map((it) => ({
    eventId: it.key, sport: it.sport, label: it.title, startsAt: it.startsAt,
    home: it.kind === "game" ? it.homeTeam ?? it.matchupHeaders[0] : null, away: it.kind === "game" ? it.awayTeam ?? it.matchupHeaders[1] : null,
  }));
  const storage = myBetsStorage();

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
        <PageHeader kicker="My bets" title="Profit and loss" lede="Log what you actually bet. Game bets grade themselves from final scores, race bets from the settled ledger, and anything else you can mark by hand. The model's probability on your side is saved with each bet so you can see whether the picks it liked made money." />

        {storage === "sqlite" ? <Note tone="warn">Bets are being stored in the local database. On the hosted site they go to the Postgres database set in <code>DATABASE_URL</code>.</Note> : null}
        {graded ? <Note>{graded} bet{graded === 1 ? "" : "s"} just graded from new results.</Note> : null}

        <Section kicker="Totals" title={summary.settled ? `${summary.wins}–${summary.losses}${summary.pushes ? `–${summary.pushes}` : ""} on ${summary.settled} settled` : "Nothing settled yet"} description={summary.open ? `${summary.open} open bet${summary.open === 1 ? "" : "s"} with ${money(summary.openStake).replace("+", "")} at risk.` : undefined}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Net profit" value={money(summary.profit)} tone={summary.profit > 0 ? "good" : summary.profit < 0 ? "bad" : "neutral"} detail={`on ${money(summary.staked).replace("+", "")} decided`} />
            <StatTile label="ROI" value={pct(summary.roi)} detail="profit over decided stake" tone={summary.roi !== null && summary.roi > 0 ? "good" : "neutral"} />
            <StatTile label="Win rate" value={pct(summary.winRate, 0)} detail={summary.avgPrice !== null ? `avg price ${american(summary.avgPrice)}` : undefined} />
            <StatTile label="Model-backed" value={summary.modelEdgeBets ? money(summary.modelEdgeProfit) : "—"} detail={summary.modelEdgeBets ? `${summary.modelEdgeBets} bet${summary.modelEdgeBets === 1 ? "" : "s"} where the model beat the market price` : "bets logged from the board carry the model's number"} tone={summary.modelEdgeProfit > 0 ? "good" : "neutral"} />
          </div>
          {summary.series.length >= 2 ? <Card className="mt-4 p-4"><PnlChart points={summary.series} title="Running profit" /></Card> : null}
          {summary.bySport.length > 1 ? (
            <div className="mt-4">
              <Table caption="By sport">
                <thead><tr><th>Sport</th><th className="num">Bets</th><th className="num">Record</th><th className="num">Staked</th><th className="num">Profit</th><th className="num">ROI</th></tr></thead>
                <tbody>{summary.bySport.map((s) => (
                  <tr key={s.sport}><td className="strong">{SPORT_LABELS[s.sport] ?? s.sport}</td><td className="num">{s.bets}</td><td className="num">{s.wins}–{s.losses}{s.pushes ? `–${s.pushes}` : ""}</td><td className="num">{money(s.staked).replace("+", "")}</td><td className="num">{money(s.profit)}</td><td className="num">{pct(s.roi)}</td></tr>
                ))}</tbody>
              </Table>
            </div>
          ) : null}
        </Section>

        <Section kicker="Log" title="Log a bet" id="log-section" description="Use “Log this bet” on the Tonight board to prefill a pick, or enter one here.">
          <Card className="p-4"><LogBetForm prefill={prefill} events={events} /></Card>
        </Section>

        <Section kicker="Ledger" title="Every bet" description="Open bets grade automatically once results publish. Use the status menu to settle anything the grader cannot see, or to correct it.">
          {bets.length ? (
            <Table caption="Your bets, newest first">
              <thead><tr><th>Placed</th><th>Sport</th><th>Event</th><th>Bet</th><th className="num">Price</th><th className="num">Stake</th><th className="num">Model / mkt</th><th>Status</th><th className="num">Profit</th><th></th></tr></thead>
              <tbody>{bets.map((b) => (
                <tr key={b.id}>
                  <td className="tnum text-xs text-[var(--muted)]">{b.placedAt.slice(0, 16).replace("T", " ")}</td>
                  <td>{SPORT_LABELS[b.sport] ?? b.sport}</td>
                  <td><span className="block">{b.eventLabel}</span>{b.eventStart ? <span className="block text-xs text-[var(--muted)]">{b.eventStart.slice(0, 10)}</span> : null}</td>
                  <td><span className="strong">{b.selectionLabel}</span><span className="block text-xs text-[var(--muted)]">{b.market}{b.book ? ` · ${b.book}` : ""}{b.note ? ` · ${b.note}` : ""}</span></td>
                  <td className="num">{american(b.price)}<span className="block text-xs text-[var(--muted)]">{pct(impliedProbability(b.price), 0)} implied</span></td>
                  <td className="num">{b.stake.toFixed(2)}</td>
                  <td className="num text-xs">{b.modelProb !== null ? pct(b.modelProb, 0) : "—"} / {b.marketProb !== null ? pct(b.marketProb, 0) : "—"}</td>
                  <td>
                    <form action={setBetStatusAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={b.id} />
                      <Chip tone={statusTone[b.status]}>{b.status}</Chip>
                      <select name="status" defaultValue={b.status} className="input !w-auto !py-0.5 text-xs" aria-label="Set status">
                        {BET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button type="submit" className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">Set</button>
                    </form>
                    {b.resultValue !== null ? <span className="block text-xs text-[var(--muted)]">{b.market === "total" ? `total ${b.resultValue}` : `home margin ${b.resultValue > 0 ? "+" : ""}${b.resultValue}`}</span> : null}
                  </td>
                  <td className={`num ${b.status === "won" ? "text-[var(--good)]" : b.status === "lost" ? "text-[var(--bad)]" : ""}`}>{b.status === "open" ? "—" : money(profit(b))}</td>
                  <td><form action={deleteBetAction}><input type="hidden" name="id" value={b.id} /><button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--bad)]" aria-label={`Delete bet ${b.id}`}>✕</button></form></td>
                </tr>
              ))}</tbody>
            </Table>
          ) : <EmptyState title="No bets logged" detail="Log your first bet above, or open a pick on the Tonight board and choose “Log this bet”." href="/" linkLabel="Tonight board" />}
        </Section>
      </main>
    </div>
  );
}
