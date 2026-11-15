"use client";
import { useId, useState, type ReactNode } from "react";
import { deleteBetAction } from "@/app/bets/actions";
import { LogBetForm, type EventOption, type LogBetPrefill } from "@/components/bets/log-bet-form";
export function BetEditor({id,prefill,events,children,row=false}:{id:number;prefill:LogBetPrefill;events:EventOption[];children?:ReactNode;row?:boolean}){
  const [open,setOpen]=useState(false),panel=useId();
  const controls=<div className="flex items-center gap-3"><button type="button" aria-expanded={open} aria-controls={panel} onClick={()=>setOpen(!open)} className="text-xs font-bold text-[var(--accent)]">{open?'Close':'Edit'}</button>
    <form action={deleteBetAction}><input type="hidden" name="id" value={id}/><button type="submit" aria-label={`Delete bet ${id}`} className="text-xs text-[var(--muted)]">Delete</button></form></div>;
  const form=open?<div id={panel} className="w-full max-w-[calc(100vw-3rem)] rounded-md border border-[var(--border)] p-3 text-left whitespace-normal"><LogBetForm key={id} editId={id} prefill={prefill} events={events} inline/></div>:null;
  return row?<><tr>{children}<td>{controls}</td></tr>{open?<tr><td colSpan={10}>{form}</td></tr>:null}</>:<div className="space-y-2">{controls}{form}</div>;
}
