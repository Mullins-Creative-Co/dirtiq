"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { logBetAction } from "@/app/bets/actions";
import { BET_MARKETS } from "@/lib/my-bets/grade";

export type LogBetPrefill = Partial<Record<"sport" | "eventId" | "eventLabel" | "eventStart" | "market" | "selection" | "selectionLabel" | "line" | "price" | "modelProb" | "marketProb" | "stake" | "book" | "note", string>>;
export type EventOption = { eventId: string; sport: string; label: string; startsAt: string; home: string | null; away: string | null };

const SPORTS = [["nfl", "NFL"], ["nba", "NBA"], ["nhl", "NHL"], ["ncaaf", "College football"], ["ncaab", "College basketball"], ["mlb", "MLB"], ["racing", "Dirt racing"], ["other", "Other"]] as const;

export function LogBetForm({ prefill, events }: { prefill: LogBetPrefill; events: EventOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [sport, setSport] = useState(prefill.sport ?? "nba");
  const [eventId, setEventId] = useState(prefill.eventId ?? "");
  const [eventLabel, setEventLabel] = useState(prefill.eventLabel ?? "");
  const [eventStart, setEventStart] = useState(prefill.eventStart ?? "");
  const [market, setMarket] = useState(prefill.market ?? "spread");
  const [selection, setSelection] = useState(prefill.selection ?? "");
  const options = events.filter((e) => e.sport === sport);
  const picked = options.find((e) => e.eventId === eventId) ?? null;
  const needsLine = market === "spread" || market === "total";

  function chooseEvent(id: string) {
    setEventId(id);
    const e = events.find((x) => x.eventId === id);
    if (e) { setEventLabel(e.label); setEventStart(e.startsAt); if (!selection && e.home) setSelection(e.home); }
  }

  return (
    <form
      id="log"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        setError(null); setSaved(null);
        start(async () => {
          const res = await logBetAction(fd);
          if (res.error) { setError(res.error); return; }
          setSaved(`Logged bet #${res.id}.`);
          setSelection(""); setEventId(""); setEventLabel(""); setEventStart("");
          router.replace("/bets");
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="eventStart" value={eventStart} />
      <input type="hidden" name="selectionLabel" value={prefill.selectionLabel ?? ""} />
      <input type="hidden" name="modelProb" value={prefill.modelProb ?? ""} />
      <input type="hidden" name="marketProb" value={prefill.marketProb ?? ""} />
      <Field label="Sport">
        <select name="sport" value={sport} onChange={(e) => { setSport(e.target.value); setEventId(""); }} className="input">
          {SPORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Game or race" hint={options.length ? "Pick from the board for automatic grading, or type a name." : "Type a name; no upcoming events on the board for this sport."}>
        {options.length ? (
          <select value={eventId} onChange={(e) => chooseEvent(e.target.value)} className="input">
            <option value="">— choose —</option>
            {options.map((e) => <option key={e.eventId} value={e.eventId}>{e.label} · {e.startsAt.slice(5, 10)}</option>)}
          </select>
        ) : null}
        <input name="eventLabel" value={eventLabel} onChange={(e) => setEventLabel(e.target.value)} placeholder="e.g. NYK at BOS" className="input mt-1" required />
      </Field>
      <Field label="Market">
        <select name="market" value={market} onChange={(e) => setMarket(e.target.value)} className="input">
          {BET_MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="Selection" hint={market === "total" ? "over or under" : picked?.home ? `${picked.home} or ${picked.away} (abbreviation)` : "team abbreviation, driver, or text"}>
        {market === "total" ? (
          <select name="selection" value={selection || "over"} onChange={(e) => setSelection(e.target.value)} className="input">
            <option value="over">over</option><option value="under">under</option>
          </select>
        ) : picked?.home && picked.away && market !== "other" ? (
          <select name="selection" value={selection} onChange={(e) => setSelection(e.target.value)} className="input" required>
            <option value="">— choose —</option>
            <option value={picked.home}>{picked.home} (home)</option>
            <option value={picked.away}>{picked.away} (away)</option>
          </select>
        ) : (
          <input name="selection" value={selection} onChange={(e) => setSelection(e.target.value)} className="input" required />
        )}
      </Field>
      <Field label={needsLine ? "Line" : "Line (optional)"} hint={market === "spread" ? "your side's number, e.g. -3.5 or +6" : market === "total" ? "the total, e.g. 221.5" : undefined}>
        <input name="line" type="number" step="0.5" defaultValue={prefill.line ?? ""} className="input" required={needsLine} />
      </Field>
      <Field label="Price" hint="American, e.g. -110 or +145">
        <input name="price" defaultValue={prefill.price ?? "-110"} className="input" required />
      </Field>
      <Field label="Stake"><input name="stake" type="number" step="0.01" min="0.01" placeholder="25" defaultValue={prefill.stake ?? ""} className="input" required /></Field>
      <Field label="Book (optional)"><input name="book" placeholder="DraftKings" defaultValue={prefill.book ?? ""} className="input" /></Field>
      <Field label="Placed at (optional)"><input name="placedAt" type="datetime-local" className="input" /></Field>
      <Field label="Note (optional)" className="sm:col-span-2 lg:col-span-3"><input name="note" defaultValue={prefill.note ?? ""} className="input" /></Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Log bet"}</button>
        {error ? <span className="text-sm text-[var(--bad)]">{error}</span> : null}
        {saved ? <span className="text-sm text-[var(--good)]">{saved}</span> : null}
        {prefill.modelProb ? <span className="text-xs text-[var(--muted)]">Model {Math.round(Number(prefill.modelProb) * 100)}% on this side{prefill.marketProb ? `, market ${Math.round(Number(prefill.marketProb) * 100)}%` : ""} at log time; saved with the bet.</span> : null}
      </div>
    </form>
  );
}

function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-[var(--muted)]">{hint}</span> : null}
    </label>
  );
}
