"use client";

import { useId, useState, type ReactNode } from "react";
import { LogBetForm, type LogBetPrefill } from "@/components/bets/log-bet-form";

function prefillFromHref(href: string): LogBetPrefill {
  const query = new URLSearchParams(href.split("?")[1]?.split("#")[0] ?? "");
  return Object.fromEntries(query.entries()) as LogBetPrefill;
}

export function InlineLogBet({ href }: { href: string }) {
  const [prefill, setPrefill] = useState<LogBetPrefill | null>(null);
  const open = prefill !== null;
  const id = useId();
  return (
    <div className="space-y-4">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setPrefill(prefill ? null : prefillFromHref(href))} className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
        {open ? "Close log form" : "Log this bet"}
      </button>
      {prefill ? <div id={id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><LogBetForm prefill={prefill} events={[]} inline /></div> : null}
    </div>
  );
}

/** Keep the expanded form in its own full-width row, directly below this pick. */
export function InlineBetRow({ children, href, canLog }: { children: ReactNode; href: string; canLog: boolean }) {
  const [prefill, setPrefill] = useState<LogBetPrefill | null>(null);
  const open = prefill !== null;
  const id = useId();
  return (
    <>
      <tr>
        {children}
        <td>{canLog ? <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setPrefill(prefill ? null : prefillFromHref(href))} className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">{open ? "Close" : "Log bet"}</button> : null}</td>
      </tr>
      {canLog && prefill ? <tr><td colSpan={8}><div id={id} className="w-full max-w-[calc(100vw-4rem)] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left whitespace-normal"><LogBetForm prefill={prefill} events={[]} inline /></div></td></tr> : null}
    </>
  );
}
