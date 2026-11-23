import { connection } from "next/server";
import type { Metadata } from "next";

import { setBetStatusAction } from "./actions";
import { PnlChart } from "@/components/bets/pnl-chart";
import { LogBetForm, type LogBetPrefill } from "@/components/bets/log-bet-form";
import { RefreshResults } from "@/components/bets/refresh-results";
import { BetEditor } from "@/components/bets/bet-editor";
import { getBetEvents } from "@/lib/bet-events";
import { dateTime } from "@/lib/format";
import { teamName, eventName } from "@/lib/team-names";
import { Nav } from "@/components/nav";
import { Card, Chip, EmptyState, Note, PageHeader, Section, StatTile, Table } from "@/components/ui/primitives";
import { listBets, myBetsStorage, settleOpenBets } from "@/lib/my-bets";
import { BET_STATUSES, impliedProbability, profit, summarize } from "@/lib/my-bets/grade";
import { SPORT_LABELS, getTeamNames } from "@/lib/model-reports";
import { SITE_NAME } from "@/lib/site";
import { buildTonightBoard } from "@/lib/tonight";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `My bets | ${SITE_NAME}`, description: "Log the bets you place and track profit, ROI and how the model-backed ones do." };

const PREFILL_KEYS = ["sport", "eventId", "eventLabel", "eventStart", "market", "selection", "selectionLabel", "line", "price", "modelProb", "marketProb", "stake", "book", "note", "placedAt", "status"] as const;

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `−${s}` : v > 0 ? `+${s}` : s;
}
function pct(v: number | null | undefined, d = 1): string { return v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`; }
function american(p: number): string { return p > 0 ? `+${p}` : String(p); }
const eventDay = new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",year:"numeric"});
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
  const events = getBetEvents(board);
  const names = getTeamNames();
  const eventLabel = (b: typeof bets[number]) => eventName(names,b.sport,b.eventLabel);
  const selectionLabel = (b: typeof bets[number]) => {
    const name=teamName(names,b.sport,b.selection);
    return b.selectionLabel.startsWith(b.selection) ? name+b.selectionLabel.slice(b.selection.length) : b.selectionLabel;
  };
  const editPrefill = (b: typeof bets[number]): LogBetPrefill => ({
    sport:b.sport,eventId:b.eventId??"",eventLabel:eventLabel(b),eventStart:b.eventStart??"",market:b.market,
    selection:b.selection,selectionLabel:b.selectionLabel,line:b.line===null?"":String(b.line),price:String(b.price),stake:String(b.stake),
    book:b.book??"",note:b.note??"",placedAt:b.placedAt,status:b.manual?b.status:"auto",
  });
  const storage = myBetsStorage();

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl space-y-5 px-3 pb-24 pt-4 sm:px-6 [&>header]:pb-4">
        <PageHeader kicker="My bets" title="Profit and loss" lede="Log current or past bets. Linked games grade automatically; edit details any time." />

        {storage === "sqlite" ? <Note tone="warn">This copy uses local storage. Hosted saves are disabled here to prevent disappearing bets. Use <a href="https://dirtiq-9h.vercel.app/bets" className="underline">the main My bets page</a> for persistent saves. Local development saves remain available.</Note> : null}
        {graded ? <Note>{graded} bet{graded === 1 ? "" : "s"} just graded from new results.</Note> : null}

        <Section kicker="Totals" title={summary.settled ? `${summary.wins}–${summary.losses}${summary.pushes ? `–${summary.pushes}` : ""} on ${summary.settled} settled` : "Nothing settled yet"} description={summary.open ? `${summary.open} open bet${summary.open === 1 ? "" : "s"} with ${money(summary.openStake).replace("+", "")} at risk.` : undefined}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 [&_.stat]:!p-2 [&_.stat-value]:!text-xl">
            <StatTile label="Net profit" value={money(summary.profit)} tone={summary.profit > 0 ? "good" : summary.profit < 0 ? "bad" : "neutral"} detail={`on ${money(summary.staked).replace("+", "")} decided`} />
            <StatTile label="ROI" value={pct(summary.roi)} detail="profit over decided stake" tone={summary.roi !== null && summary.roi > 0 ? "good" : "neutral"} />
            <StatTile label="Win rate" value={pct(summary.winRate, 0)} detail={summary.avgPrice !== null ? `avg price ${american(summary.avgPrice)}` : undefined} />
            <StatTile label="Model-backed" value={summary.modelEdgeBets ? money(summary.modelEdgeProfit) : "—"} detail={summary.modelEdgeBets ? `${summary.modelEdgeBets} bet${summary.modelEdgeBets === 1 ? "" : "s"} where the model beat the market price` : "bets logged from the board carry the model's number"} tone={summary.modelEdgeProfit > 0 ? "good" : "neutral"} />
          </div>
          <details className="mt-3 text-sm"><summary>Performance chart and sport breakdown</summary>
          {summary.series.length >= 2 ? <Card className="mt-4 p-4"><PnlChart points={summary.series} title="Running profit by bet date" /></Card> : null}
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
          </details>
        </Section>

        <details id="log-section" open={Object.keys(prefill).length>0} className="rounded-lg border border-[var(--border)] p-3"><summary className="cursor-pointer text-sm font-bold text-[var(--accent)]">Add a bet · current or historical</summary><div className="mt-3"><LogBetForm prefill={prefill} events={events}/></div></details>

        <Section kicker="Ledger" title="Every bet" action={<RefreshResults/>} description="Linked games grade from final scores. Edit any saved bet, or choose a result for a manual entry.">
          <div className="space-y-2 md:hidden">{bets.map(b=><article key={b.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]"><span>{SPORT_LABELS[b.sport]??b.sport} · {eventDay.format(new Date(b.eventStart??b.placedAt))}</span><Chip tone={statusTone[b.status]}>{b.status}</Chip></div>
            <p className="mt-1 text-sm leading-5">{eventLabel(b)}</p><p className="mt-1 text-sm font-bold">{selectionLabel(b)}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-strong)]"><span>Price {american(b.price)}</span><span>Stake {b.stake.toFixed(2)}</span>{b.status!=="open"?<span>Profit {money(profit(b))}</span>:null}{b.book?<span>{b.book}</span>:null}</div>
            {!b.eventId?<p className="mt-1 text-[11px] text-[var(--muted)]">Manual entry · no game linked</p>:b.manual?<p className="mt-1 text-[11px] text-[var(--muted)]">Result set manually</p>:null}
            <div className="mt-2"><BetEditor id={b.id} prefill={editPrefill(b)} events={events}/></div>
          </article>)}</div>
          {bets.length ? (
            <div className="hidden md:block [&_td]:!py-2 [&_th]:!py-2"><Table caption="Your bets, newest first">
              <thead><tr><th>Placed</th><th>Sport</th><th>Event</th><th>Bet</th><th className="num">Price</th><th className="num">Stake</th><th className="num">Model / mkt</th><th>Status</th><th className="num">Profit</th><th></th></tr></thead>
              <tbody>{bets.map((b) => (
                <BetEditor key={b.id} id={b.id} prefill={editPrefill(b)} events={events} row>
                  <td className="tnum text-xs text-[var(--muted)]">{dateTime(b.placedAt)}</td>
                  <td>{SPORT_LABELS[b.sport] ?? b.sport}</td>
                  <td><span className="block">{eventLabel(b)}</span>{b.eventStart ? <span className="block text-xs text-[var(--muted)]">{eventDay.format(new Date(b.eventStart))}</span> : null}</td>
                  <td><span className="strong">{selectionLabel(b)}</span><span className="block text-xs text-[var(--muted)]">{b.market}{b.book ? ` · ${b.book}` : ""}{b.note ? ` · ${b.note}` : ""}</span></td>
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
                </BetEditor>
              ))}</tbody>
            </Table></div>
          ) : <EmptyState title="No bets logged" detail="Log your first bet above, or open a pick on the Tonight board and choose “Log this bet”." href="/" linkLabel="Tonight board" />}
        </Section>
      </main>
    </div>
  );
}
