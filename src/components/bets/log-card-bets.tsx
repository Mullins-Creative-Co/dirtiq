"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logCardBetsAction } from "@/app/bets/actions";
import { BetEditor } from "@/components/bets/bet-editor";
import type { EventOption } from "@/components/bets/log-bet-form";
import type { MyBet } from "@/lib/my-bets/grade";

export function LogCardBets({date, count, unstaked, events}: {date: string; count: number; unstaked: number; events: EventOption[]}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [bets, setBets] = useState<MyBet[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-primary" disabled={pending || count === 0} onClick={() => start(async () => {
        setError("");
        try {
          const result = await logCardBetsAction(date);
          setBets(result.bets);
          setMessage(`${result.added} logged${result.existing ? ` · ${result.existing} already saved` : ""}.`);
          if (result.error) setError(result.error);
          if (result.bets.length) router.refresh();
        } catch {
          setError("Could not confirm every save. Try again; already logged picks will be skipped.");
        }
      })}>{pending ? "Logging…" : `Log all ${count} at $1 each`}</button>
      {message ? <span role="status" className="text-sm">{message} <Link href="/bets" className="text-[var(--accent)] underline">My bets</Link></span> : null}
    </div>
    <p className="mt-2 text-xs text-[var(--muted)]">{count === 0 ? "No picks on this card to log." : `Save all ${count} picks at $1 each, using checked current prices for today’s open games and the saved terms for past games.`}{unstaked > 0 ? ` ${unstaked === count ? "All" : unstaked} of them ${unstaked === 1 && count > 1 ? "is" : "are"} unstaked on the card: the model has not shown an edge there, so this is your own $1.` : ""} Already logged picks are skipped. Edit lines below after saving.</p>
    {error ? <p role="alert" className="mt-2 text-sm text-[var(--bad)]">{error}</p> : null}
    {bets.length ? <details className="mt-3" open><summary className="cursor-pointer text-sm font-bold">Edit logged bets</summary>
      <div className="mt-2 space-y-2">{bets.map(bet => <div key={bet.id} className="rounded border border-[var(--border)] p-2">
        <p className="mb-2 text-sm">{bet.eventLabel}</p>
        <BetEditor id={bet.id} events={events} prefill={{sport:bet.sport,eventId:bet.eventId??"",eventLabel:bet.eventLabel,eventStart:bet.eventStart??"",market:bet.market,selection:bet.selection,selectionLabel:bet.selectionLabel,line:bet.line===null?"":String(bet.line),price:String(bet.price),stake:String(bet.stake),book:bet.book??"",note:bet.note??"",placedAt:bet.placedAt,status:bet.manual?bet.status:"auto"}}/>
      </div>)}</div>
    </details> : null}
  </div>;
}
