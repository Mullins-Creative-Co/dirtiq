import { RefreshNotice } from "@/components/refresh-notice";
import { InlineLogBet, InlineBetRow } from "@/components/bets/inline-log-bet";
import { connection } from "next/server";

import { CopyBrief } from "@/components/card/copy-brief";
import { Nav } from "@/components/nav";
import { Chip, EmptyState, Note, PageHeader, Section, StatTile, Table, type Tone } from "@/components/ui/primitives";
import { american, dateTime, pct, relativeAge, signed, spread, units } from "@/lib/format";
import { listCardDates } from "@/lib/model-reports";
import { buildCardView, type CardPickView } from "@/lib/card";
import { CARD_AGENT_PROMPT, CARD_JSON_URL } from "@/lib/card-agent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today’s card", description: "The day’s ranked, staked shortlist of spread bets across NFL, college football, NBA and college basketball, checked against the current line." };

const startTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

function status(pick: CardPickView): { label: string; tone: Tone; detail: string } {
  if (pick.result) {
    const tone: Tone = pick.result.outcome === "win" ? "good" : pick.result.outcome === "loss" ? "bad" : "neutral";
    return { label: pick.result.outcome, tone, detail: `${pick.homeName ?? pick.home} ${pick.result.homeScore}, ${pick.awayName ?? pick.away} ${pick.result.awayScore} · ${units(pick.result.units)}` };
  }
  if (pick.liveStatus === "closed") return { label: "Started", tone: "neutral", detail: "Graded at the listed line once the result is published." };
  if (pick.live) {
    const moved = pick.live.moved === 0 ? "line unchanged" : `line moved ${signed(pick.live.moved, 1)} ${pick.live.moved > 0 ? "in your favor" : "against you"}`;
    const now = `Now ${pick.pickName ?? pick.pick} ${spread(pick.live.line)} (${american(pick.live.price)}), ${moved}`;
    return pick.liveStatus === "playable"
      ? { label: "Playable", tone: "good", detail: `${now}; model still ${signed(pick.live.edgePts, 1)} pts past it.` }
      : { label: "Edge gone", tone: "warn", detail: `${now}; the model is only ${signed(pick.live.edgePts, 1)} pts past it, under the ${pick.threshold}-pt bar. Skip unless you can still get ${spread(pick.line)}.` };
  }
  return pick.status === "edge-gone"
    ? { label: "Edge gone", tone: "warn", detail: "At the last hourly refresh the line had moved under the bar. No live quote right now." }
    : { label: "Check price", tone: "warn", detail: "No live quote right now; confirm the line with your book before betting." };
}

export default async function CardPage({searchParams}:{searchParams:Promise<{date?:string|string[]}>}) {
  await connection();
  const params=await searchParams;
  const requested=typeof params.date==='string'?params.date:undefined;
  const card = await buildCardView(requested);
  const dates = listCardDates();

  if (!card) {
    return (
      <div className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-7xl space-y-3 px-3 py-3 sm:space-y-5 sm:px-6 sm:py-6 [&>header]:gap-3 [&>header]:pb-3 [&_.stat]:!p-2.5 [&_.stat-value]:!text-2xl [&_.stat-detail]:!text-[11px]">
          <RefreshNotice />
          <PageHeader kicker="Card" title="Today’s card" />
          <EmptyState title={requested?"No saved card for this date":"No card yet"} detail={requested?"Choose an available date on today’s card, or log a historical bet from My bets.":"The card is built by the hourly sports refresh."} href="/card" linkLabel="Today’s card" command="python3 -m dirtiq_model card build" />
        </main>
      </div>
    );
  }

  const now = Date.parse(card.loadedAt);
  const current = card.date === card.today;
  const open = card.picks.filter((p) => !p.result && p.liveStatus !== "closed");
  const playable = open.filter((p) => p.liveStatus === "playable");
  const playableUnits = playable.reduce((sum, p) => sum + p.stakeUnits, 0);
  const stale = current && (!card.forecastsRefreshedAt || now - Date.parse(card.forecastsRefreshedAt) > 3 * 3_600_000);
  const record = card.record;
  const brief = `${CARD_AGENT_PROMPT}\n\nCARD JSON (${card.date}, built ${card.generatedAt}):\n${JSON.stringify(card.source, null, 1)}`;
  const sorted = [...card.picks].sort((a, b) => a.rank - b.rank);
  const eventFor = (pick:CardPickView) => ({eventId:pick.id,sport:pick.sport,label:`${pick.awayName??pick.away} at ${pick.homeName??pick.home}`,startsAt:pick.startsAt,home:pick.home,away:pick.away,homeLabel:pick.homeName??pick.home,awayLabel:pick.awayName??pick.away,completed:Boolean(pick.result)});

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-3 px-3 py-3 sm:space-y-5 sm:px-6 sm:py-6 [&>header]:gap-3 [&>header]:pb-3 [&_.stat]:!p-2.5 [&_.stat-value]:!text-2xl [&_.stat-detail]:!text-[11px]">
        {current?<RefreshNotice />:null}
        <form method="get" className="flex flex-wrap items-center gap-2 text-sm"><label className="flex items-center gap-2">Card date<select name="date" defaultValue={card.date} className="input !w-auto !py-1.5">{dates.map(date=><option key={date} value={date}>{date}</option>)}</select></label><button className="text-xs font-bold text-[var(--accent)]" type="submit">View card</button></form>
        <PageHeader
          kicker={new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${card.date}T17:00:00Z`))}
          title={current?"Today’s card":"Past card"}
          lede="Spread picks at locked lines. Log or edit what you actually bet."
          aside={
            <div className="grid grid-cols-3 gap-2">
              <StatTile label={current?"Playable now":"Saved picks"} value={current?`${playable.length} of ${card.picks.length}`:card.picks.length} detail={current?`${playableUnits.toFixed(1)} units at risk`:"Log what you actually bet"} />
              <StatTile label="Card record" value={record && record.wins + record.losses > 0 ? `${record.wins}–${record.losses}${record.pushes ? `–${record.pushes}` : ""}` : "—"} detail={record && record.staked > 0 ? `${units(record.units)} · ${pct(record.roi)} ROI over ${record.days} day${record.days === 1 ? "" : "s"}` : "No graded card yet"} tone={record && record.units > 0 ? "good" : "neutral"} />
              <StatTile label="Refreshed" value={relativeAge(card.forecastsRefreshedAt, now)} detail={`${card.qualified} qualified of ${card.priced} priced games`} tone={stale ? "warn" : "neutral"} />
            </div>
          }
        />

        {!current ? <Note><strong>Saved card for {card.date}.</strong> You can log a past bet below; enter the line and price you actually took.</Note> : null}
        {stale ? <Note tone="warn"><strong>Forecasts were last refreshed {relativeAge(card.forecastsRefreshedAt, now)}.</strong> The hourly refresh has stalled; rely only on rows with a live quote.</Note> : null}
        <div className="note note-warn"><strong>No edge has been shown.</strong> These rules lost money in backtests.<details className="mt-1"><summary>Evidence and stakes</summary>{card.evidence} {card.unit}.</details></div>

        <Section title={`${card.picks.length} pick${card.picks.length === 1 ? "" : "s"} · ${card.totalUnits.toFixed(1)} units`} description={current?`Quotes checked ${startTime.format(new Date(card.loadedAt))} ET · refresh to update.`:"Log any finished pick below."}>
          {card.picks.length === 0 ? (
            <EmptyState title="Nothing qualifies yet today" detail={`${card.priced} games have a priced spread and none clears its sport’s bar. Lines for evening games often post late morning; the card is rebuilt every hour.`} />
          ) : (
            <>
            <div className="space-y-2 md:hidden">{sorted.map(pick=>{const s=status(pick);return <article key={pick.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]"><span>{pick.sportLabel} · {startTime.format(new Date(pick.startsAt))} ET</span><Chip tone={s.tone}>{s.label}</Chip></div>
              <p className="mt-1 text-sm leading-5">{pick.awayName??pick.away} at {pick.homeName??pick.home}</p>
              <p className="mt-1 text-sm font-bold">{pick.pickName??pick.pick} {spread(pick.line)} ({american(pick.price)})</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Card stake {pick.stakeUnits.toFixed(1)}u · gap {pick.edgePts.toFixed(1)} pts</p>
              <div className="mt-2"><InlineLogBet href={pick.logHref} event={eventFor(pick)} label="Log bet" /></div>
              <details className="mt-2 text-xs text-[var(--muted)]"><summary>Price and model details</summary><p className="mt-1">{s.detail}</p><p className="mt-1">{pick.record?`${pct(pick.record.winRate)} wins, ${pct(pick.record.roi)} ROI in the backtest`:"No backtest record"}</p></details>
            </article>})}</div>
            <div className="hidden md:block [&_td]:!py-2"><Table caption="Card picks, strongest first">
              <thead>
                <tr><th>#</th><th>Game</th><th>Bet</th><th className="num">Stake</th><th>Now</th><th className="num">Model gap</th><th>This rule, backtested</th><th /></tr>
              </thead>
              <tbody>
                {sorted.map((pick) => {
                  const s = status(pick);
                  return (
                    <InlineBetRow key={pick.id} href={pick.logHref} event={eventFor(pick)}>
                      <td className="num">{pick.rank}</td>
                      <td>
                        <span className="strong block">{pick.awayName ?? pick.away} at {pick.homeName ?? pick.home}</span>
                        <span className="block text-xs text-[var(--muted)]">{pick.sportLabel} · {startTime.format(new Date(pick.startsAt))} ET</span>
                      </td>
                      <td>
                        <span className="strong block">{pick.pickName ?? pick.pick} {spread(pick.line)} ({american(pick.price)})</span>
                        <span className="block text-xs text-[var(--muted)]" title={dateTime(pick.lockedAt)}>listed {relativeAge(pick.lockedAt, now)}</span>
                      </td>
                      <td className="num">{pick.stakeUnits.toFixed(1)}u</td>
                      <td>
                        <Chip tone={s.tone}>{s.label}</Chip>
                        <span className="mt-1 block max-w-xs text-xs text-[var(--muted)]">{s.detail}{pick.live ? ` Quote ${relativeAge(pick.live.observedAt, now)}.` : ""}</span>
                      </td>
                      <td className="num">
                        <span className="block">{signed(pick.edgePts, 1)} pts</span>
                        <span className="block text-xs text-[var(--muted)]">{pick.marketAwareAgrees ? "market-aware model agrees" : "market-aware model disagrees"}</span>
                      </td>
                      <td className="text-xs text-[var(--muted)]">
                        {pick.record ? `${pct(pick.record.winRate)} wins, ${pct(pick.record.roi)} ROI on ${pick.record.picks.toLocaleString("en-US")} picks; needs ${pct(pick.breakEvenProb)} at this price` : "No backtest record"}
                      </td>
                    </InlineBetRow>
                  );
                })}
              </tbody>
            </Table></div>
            </>
          )}
        </Section>

        <Section title="Second opinion" description="The model knows scores, not injuries or lineups. Hand the card to an assistant that can search the web before you bet.">
          <div className="flex flex-wrap items-center gap-3">
            <CopyBrief text={brief} label="Copy instructions and card" />
            <span className="text-xs text-[var(--muted)]">Paste into ChatGPT or any assistant with web search. An agent on a schedule can read the card itself at <a className="underline" href={CARD_JSON_URL}>{CARD_JSON_URL}</a>.</span>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm">Show the instructions</summary>
            <pre className="note mt-2 max-h-96 overflow-auto whitespace-pre-wrap">{CARD_AGENT_PROMPT}</pre>
          </details>
        </Section>

        <Section title="How the card is built">
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-strong)]">
            {card.rules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </Section>
      </main>
    </div>
  );
}
