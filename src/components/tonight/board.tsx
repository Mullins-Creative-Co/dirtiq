"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Chip, type Tone } from "@/components/ui/primitives";
import { pct, signed } from "@/lib/format";
import type { TonightBoard, TonightItem } from "@/lib/tonight";

const toneFor: Record<TonightItem["confidenceLabel"], Tone> = { High: "good", Medium: "warn", Low: "neutral" };
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });

export function TonightBoardView({ board, initialSport = "all" }: { board: TonightBoard; initialSport?: string }) {
  const [sport, setSport] = useState<string>(board.sports.some((s) => s.sport === initialSport) ? initialSport : "all");
  const [minConfidence, setMinConfidence] = useState<"all" | "medium" | "high">("all");
  const [withMarket, setWithMarket] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(() => {
    const scoped = board.items.filter((item) => initialSport === "all" || item.sport === initialSport);
    return scoped.find((item) => item.isToday)?.key ?? scoped[0]?.key ?? null;
  });
  const FEATURED_PER_SPORT = 6;

  const items = useMemo(() => board.items.filter((item) =>
    (sport === "all" || item.sport === sport)
    && (minConfidence === "all" || item.confidenceLabel === "High" || (minConfidence === "medium" && item.confidenceLabel === "Medium"))
    && (!withMarket || item.market !== null),
  ), [board.items, sport, minConfidence, withMarket]);

  const groups = useMemo(() => {
    const map = new Map<string, TonightItem[]>();
    for (const item of items) {
      const key = item.isToday ? "today" : item.dayKey;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    // Featured view: the top few per sport per day, so one busy league cannot bury the others.
    const trimmed: Array<[string, TonightItem[], number]> = [];
    for (const [key, group] of map.entries()) {
      if (showAll || sport !== "all") { trimmed.push([key, group, 0]); continue; }
      const seen = new Map<string, number>();
      const kept = group.filter((item) => {
        const n = (seen.get(item.sport) ?? 0) + 1;
        seen.set(item.sport, n);
        return n <= FEATURED_PER_SPORT;
      });
      trimmed.push([key, kept, group.length - kept.length]);
    }
    return trimmed;
  }, [items, showAll, sport]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filters">
        <FilterButton active={sport === "all"} onClick={() => setSport("all")}>All ({board.items.length})</FilterButton>
        {board.sports.map((s) => (
          <FilterButton key={s.sport} active={sport === s.sport} onClick={() => setSport(s.sport)}>{s.label} ({s.count})</FilterButton>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-[var(--border-strong)] sm:block" />
        <FilterButton active={minConfidence === "high"} onClick={() => setMinConfidence(minConfidence === "high" ? "all" : "high")}>High confidence</FilterButton>
        <FilterButton active={minConfidence === "medium"} onClick={() => setMinConfidence(minConfidence === "medium" ? "all" : "medium")}>Medium+</FilterButton>
        <FilterButton active={withMarket} onClick={() => setWithMarket((v) => !v)}>Has a line</FilterButton>
        <FilterButton active={showAll} onClick={() => setShowAll((v) => !v)}>{showAll ? "Featured only" : "Show all"}</FilterButton>
      </div>

      {items.length === 0 ? (
        <p className="panel border-dashed p-6 text-sm text-[var(--muted)]">Nothing matches these filters.</p>
      ) : null}

      {groups.map(([key, group, hidden]) => (
        <section key={key} className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl font-black">{key === "today" ? "Tonight" : dayFmt.format(new Date(`${key}T17:00:00Z`))}</h2>
            <span className="text-xs text-[var(--muted)]">{group.length} {group.length === 1 ? "event" : "events"} · sorted by confidence{hidden ? ` · ${hidden} more under Show all` : ""}</span>
          </div>
          <ol className="space-y-2">
            {group.map((item, index) => (
              <ItemCard key={item.key} item={item} index={index + 1} open={openKey === item.key} onToggle={() => setOpenKey(openKey === item.key ? null : item.key)} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition-colors ${active ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--muted-strong)] hover:text-white"}`}>
      {children}
    </button>
  );
}

function ItemCard({ item, index, open, onToggle }: { item: TonightItem; index: number; open: boolean; onToggle: () => void }) {
  const panelId = `tonight-${item.key.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <li className={`panel overflow-hidden ${open ? "ring-1 ring-[var(--accent)]/40" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId}
        className="grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] sm:grid-cols-[2rem_1.2fr_1fr_auto_auto]">
        <span className="tnum text-xs text-[var(--muted)]">{index}</span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{item.title}</span>
          <span className="block truncate text-xs text-[var(--muted)]">{item.subtitle} · {item.startsAtLabel}</span>
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm">{item.pickDetail}</span>
          <span className="block truncate text-xs text-[var(--muted)]">{item.market?.spreadLabel ? `Market ${item.market.spreadLabel}` : item.kind === "game" ? "No market line" : `${item.raceTable?.length ?? 0} contenders shown`}{item.market?.lean ? ` · lean ${item.market.lean} ${item.market.edgePts !== null ? `${Math.abs(item.market.edgePts).toFixed(1)} pts` : ""}` : ""}</span>
        </span>
        <span className="hidden sm:block"><Chip tone={toneFor[item.confidenceLabel]}>{item.confidenceLabel}</Chip></span>
        <span className="text-right">
          <span className="tnum block font-display text-2xl font-black leading-none">{item.confidence >= 0.995 ? "99%+" : pct(item.confidence, 0)}</span>
          <span className="block text-[10px] uppercase tracking-wider text-[var(--muted)]">{item.kind === "game" ? "to win" : "vs runner-up"}</span>
        </span>
      </button>

      {open ? (
        <div id={panelId} className="grid gap-5 border-t border-[var(--border)] px-4 py-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-5">
            <div>
              <p className="kicker">Why</p>
              <p className="mt-1 text-base font-semibold">{item.pickDetail}</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-[var(--muted-strong)]">
                {item.rationale.map((line) => <li key={line}>{line}</li>)}
              </ol>
            </div>
            {item.market ? (
              <div>
                <p className="kicker">Market and price</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <Stat label="Spread" value={item.market.spreadLabel ?? "—"} detail={item.market.spreadPrices ?? undefined} />
                  <Stat label="Moneyline" value={item.market.moneyline ?? "—"} />
                  <Stat label="Model fair price" value={`${item.pick} ${item.market.fairPrice}`} detail={`${pct(item.market.modelWinProb, 0)} to win`} />
                  <Stat label="Market implies" value={item.market.marketWinProb === null ? "—" : pct(item.market.marketWinProb, 0)} detail="no-vig" />
                  <Stat label="Cover prob" value={item.market.coverProb === null ? "—" : pct(item.market.coverProb, 0)} detail={`${item.pick} at the spread`} />
                  <Stat label="Lean" value={item.market.lean ? `${item.market.lean} ${item.market.edgePts !== null ? `${Math.abs(item.market.edgePts).toFixed(1)} pts` : ""}` : "none"} detail={item.market.edgePts !== null ? `model − market ${signed(item.market.edgePts, 1)}` : undefined} />
                </dl>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.market.book ? `Line from ${item.market.book}. ` : ""}A lean is a research flag at a fixed threshold, not a bet. Expected value needs a current executable price.</p>
              </div>
            ) : item.kind === "game" ? (
              <p className="note">No line in the public source for this game. The projection stands alone and is not recorded as a priced forecast.</p>
            ) : null}
          </div>

          <div className="space-y-5">
            <div>
              <p className="kicker">Matchup</p>
              <table className="data-table mt-2">
                <caption className="sr-only">Matchup comparison</caption>
                <thead><tr><th></th><th className="num">{item.matchupHeaders[0]}</th><th className="num">{item.matchupHeaders[1]}</th></tr></thead>
                <tbody>
                  {item.matchup.map((row) => (
                    <tr key={row.label}><td className="text-[var(--muted)]" title={row.hint}>{row.label}</td><td className="num strong">{row.a}</td><td className="num">{row.b}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {item.raceTable ? (
              <div>
                <p className="kicker">Field</p>
                <table className="data-table mt-2">
                  <caption className="sr-only">Top contenders</caption>
                  <thead><tr><th className="num">#</th><th>Driver</th><th className="num">Win</th><th className="num">Top 3</th><th className="num">Exp. finish</th><th className="num">Last five</th></tr></thead>
                  <tbody>
                    {item.raceTable.map((row) => (
                      <tr key={row.driver}><td className="num text-[var(--muted)]">{row.rank}</td><td className="strong">{row.driver}{row.car ? <span className="ml-1 text-xs font-normal text-[var(--muted)]">#{row.car}</span> : null}</td><td className="num">{pct(row.win, 1)}</td><td className="num">{pct(row.top3, 0)}</td><td className="num">{row.expectedFinish === null ? "—" : row.expectedFinish.toFixed(1)}</td><td className="num text-[var(--muted)]">{row.last5}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
              <span>{item.ledger ? `Ledger: ${item.ledger.open} open${item.ledger.record ? `, graded ${item.ledger.record}` : ""}${item.ledger.recordedAt ? `, first recorded ${item.ledger.recordedAt.slice(0, 16).replace("T", " ")} UTC` : ""}` : "Not in the ledger (no priced market)."}</span>
              <Link href={item.href} className="font-bold uppercase tracking-[0.14em] text-[var(--accent)]">{item.kind === "game" ? `${item.sportLabel} page →` : "Race page →"}</Link>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</dt>
      <dd className="tnum font-semibold">{value}</dd>
      {detail ? <dd className="text-xs text-[var(--muted)]">{detail}</dd> : null}
    </div>
  );
}
