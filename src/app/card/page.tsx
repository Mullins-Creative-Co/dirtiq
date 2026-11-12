import { RefreshNotice } from "@/components/refresh-notice";
import { InlineBetRow } from "@/components/bets/inline-log-bet";
import { connection } from "next/server";

import { CopyBrief } from "@/components/card/copy-brief";
import { Nav } from "@/components/nav";
import { Chip, EmptyState, Note, PageHeader, Section, StatTile, Table, type Tone } from "@/components/ui/primitives";
import { american, dateTime, pct, relativeAge, signed, spread, units } from "@/lib/format";
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

export default async function CardPage() {
  await connection();
  const card = await buildCardView();

  if (!card) {
    return (
      <div className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
          <RefreshNotice />
          <PageHeader kicker="Card" title="Today’s card" />
          <EmptyState title="No card yet" detail="The card is built by the hourly sports refresh." command="python3 -m dirtiq_model card build" />
        </main>
      </div>
    );
  }

  const now = Date.parse(card.loadedAt);
  const current = card.date === card.today;
  const open = card.picks.filter((p) => !p.result && p.liveStatus !== "closed");
  const playable = open.filter((p) => p.liveStatus === "playable");
  const playableUnits = playable.reduce((sum, p) => sum + p.stakeUnits, 0);
  const stale = !card.forecastsRefreshedAt || now - Date.parse(card.forecastsRefreshedAt) > 3 * 3_600_000;
  const record = card.record;
  const brief = `${CARD_AGENT_PROMPT}\n\nCARD JSON (${card.date}, built ${card.generatedAt}):\n${JSON.stringify(card.source, null, 1)}`;
  const sorted = [...card.picks].sort((a, b) => a.rank - b.rank);

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <RefreshNotice />
        <PageHeader
          kicker={new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${card.date}T17:00:00Z`))}
          title="Today’s card"
          lede="The games where the model disagrees most with the spread, capped and staked, each checked against the current line when you load this page. A shortlist to verify, not a list of proven bets."
          aside={
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Playable now" value={`${playable.length} of ${card.picks.length}`} detail={`${playableUnits.toFixed(1)} units at risk`} />
              <StatTile label="Card record" value={record && record.wins + record.losses > 0 ? `${record.wins}–${record.losses}${record.pushes ? `–${record.pushes}` : ""}` : "—"} detail={record && record.staked > 0 ? `${units(record.units)} · ${pct(record.roi)} ROI over ${record.days} day${record.days === 1 ? "" : "s"}` : "No graded card yet"} tone={record && record.units > 0 ? "good" : "neutral"} />
              <StatTile label="Refreshed" value={relativeAge(card.forecastsRefreshedAt, now)} detail={`${card.qualified} qualified of ${card.priced} priced games`} tone={stale ? "warn" : "neutral"} />
            </div>
          }
        />

        {!current ? <Note tone="warn"><strong>This is the card for {card.date}, not today.</strong> Today’s card appears after the next hourly refresh.</Note> : null}
        {stale ? <Note tone="warn"><strong>Forecasts were last refreshed {relativeAge(card.forecastsRefreshedAt, now)}.</strong> The hourly refresh has stalled; rely only on rows with a live quote.</Note> : null}
        <Note tone="warn"><strong>No edge has been shown.</strong> {card.evidence} Stakes are flat and small for that reason: {card.unit}.</Note>

        <Section title={`${card.picks.length} pick${card.picks.length === 1 ? "" : "s"} · ${card.totalUnits.toFixed(1)} units`} description={`Loaded ${dateTime(card.loadedAt)}. Live quotes are ESPN multi-book medians, cached three minutes; reload for a new one.`}>
          {card.picks.length === 0 ? (
            <EmptyState title="Nothing qualifies yet today" detail={`${card.priced} games have a priced spread and none clears its sport’s bar. Lines for evening games often post late morning; the card is rebuilt every hour.`} />
          ) : (
            <Table caption="Today’s picks, strongest first">
              <thead>
                <tr><th>#</th><th>Game</th><th>Bet</th><th className="num">Stake</th><th>Now</th><th className="num">Model gap</th><th>This rule, backtested</th><th /></tr>
              </thead>
              <tbody>
                {sorted.map((pick) => {
                  const s = status(pick);
                  return (
                    <InlineBetRow key={pick.id} href={pick.logHref} canLog={!pick.result && pick.liveStatus !== "closed"}>
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
            </Table>
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
