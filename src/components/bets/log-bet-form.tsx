"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { logBetAction, updateBetAction } from "@/app/bets/actions";
import { BET_MARKETS } from "@/lib/my-bets/grade";
export type LogBetPrefill = Partial<Record<"sport"|"eventId"|"eventLabel"|"eventStart"|"market"|"selection"|"selectionLabel"|"line"|"price"|"modelProb"|"marketProb"|"stake"|"book"|"note"|"placedAt"|"status", string>>;
export type EventOption = { eventId:string; sport:string; label:string; startsAt:string; home:string|null; away:string|null; homeLabel?:string; awayLabel?:string; completed?:boolean };
const SPORTS = [["nfl","NFL"],["nba","NBA"],["nhl","NHL"],["ncaaf","College football"],["ncaab","College basketball"],["mlb","MLB"],["racing","Dirt racing"],["other","Other"]] as const;
const day = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
const eventValue = (e:EventOption) => `${e.label} · ${day.format(new Date(e.startsAt))}`;
function localDate(iso?:string) {
  if(!iso)return "";
  const d=new Date(iso); if(!Number.isFinite(d.getTime()))return "";
  const pad=(v:number)=>String(v).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function LogBetForm({prefill,events,inline=false,editId}:{prefill:LogBetPrefill;events:EventOption[];inline?:boolean;editId?:number}) {
  const id=useId(),router=useRouter();
  const [pending,start]=useTransition(),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState<string|null>(null);
  const initial=events.find(e=>e.eventId===prefill.eventId);
  const [sport,setSport]=useState(prefill.sport??"nfl"),[eventId,setEventId]=useState(prefill.eventId??""),[eventLabel,setEventLabel]=useState(initial?.label??prefill.eventLabel??""),[eventStart,setEventStart]=useState(prefill.eventStart??"");
  const [market,setMarket]=useState(prefill.market??"spread"),[selection,setSelection]=useState(prefill.selection??"");
  const options=events.filter(e=>e.sport===sport),picked=options.find(e=>e.eventId===eventId);
  const fixed=inline&&!editId&&Boolean(prefill.eventId),needsLine=market==="spread"||market==="total";
  function chooseEvent(value:string) {
    const matches=options.filter(e=>eventValue(e)===value||e.label===value);
    const found=matches.length===1?matches[0]:undefined;
    setEventLabel(found?.label??value);setEventId(found?.eventId??"");setEventStart(found?.startsAt??"");
    if(found&&!selection&&found.home)setSelection(found.home);
  }
  if(inline&&saved)return <div role="status" className="text-sm text-[var(--good)]">{saved} <Link href="/bets" className="ml-2 underline">My bets</Link></div>;
  return <form id={inline?id:"log"} aria-label={editId?"Edit bet":"Log bet"} className="grid grid-cols-2 gap-2.5 lg:grid-cols-3" onSubmit={ev=>{
    ev.preventDefault();const fd=new FormData(ev.currentTarget);setError(null);setSaved(null);
    const placed=String(fd.get("placedAt")??"");if(placed){const date=new Date(placed);if(Number.isFinite(date.getTime()))fd.set("placedAt",date.toISOString());}
    if(editId)fd.set("id",String(editId));
    start(async()=>{try{
      const res=await(editId?updateBetAction(fd):logBetAction(fd));
      if(res.error){setError(res.error);return;}
      setSaved(`${editId?"Updated":"Logged"} bet #${res.id}.`);
      if(editId)router.refresh();
      else if(!inline){setSelection("");setEventId("");setEventLabel("");setEventStart("");router.replace("/bets");router.refresh();}
    }catch{setError("Could not confirm the save. Check My bets before trying again.");}});
  }}>
    <input type="hidden" name="eventId" value={eventId}/><input type="hidden" name="eventStart" value={eventStart}/>
    <input type="hidden" name="selectionLabel" value={prefill.selectionLabel??""}/><input type="hidden" name="modelProb" value={prefill.modelProb??""}/><input type="hidden" name="marketProb" value={prefill.marketProb??""}/>
    {fixed?<><input type="hidden" name="sport" value={sport}/><input type="hidden" name="market" value={market}/><input type="hidden" name="eventLabel" value={eventLabel}/><p className="col-span-2 text-sm font-semibold lg:col-span-3">{eventLabel}</p></>:<>
      <Field label="Game or race" className="col-span-2 lg:col-span-3" hint="Search a team or date, including past games. You can also type a historical bet manually.">
        <input name="eventLabel" list={`${id}-events`} value={eventLabel} onChange={e=>chooseEvent(e.target.value)} placeholder="Search full team name or type a past game" className="input" required/>
        <datalist id={`${id}-events`}>{options.map(e=><option key={e.eventId} value={eventValue(e)}>{e.completed?"Final":"Scheduled"}</option>)}</datalist>
      </Field>
      <Field label="Sport"><select name="sport" value={sport} onChange={e=>{setSport(e.target.value);setEventId("");setEventStart("");}} className="input">{SPORTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Market"><select name="market" value={market} onChange={e=>setMarket(e.target.value)} className="input">{BET_MARKETS.map(m=><option key={m} value={m}>{m}</option>)}</select></Field>
    </>}
    <Field label="Selection" className="col-span-2 lg:col-span-1">
      {market==="total"?<select name="selection" value={selection||"over"} onChange={e=>setSelection(e.target.value)} className="input"><option value="over">Over</option><option value="under">Under</option></select>
      :picked?.home&&picked.away&&market!=="other"?<select name="selection" value={selection} onChange={e=>setSelection(e.target.value)} className="input" required>
        <option value="">Choose team</option>{selection&&selection!==picked.home&&selection!==picked.away?<option value={selection}>{selection} — check team</option>:null}
        <option value={picked.home}>{picked.homeLabel??picked.home}</option><option value={picked.away}>{picked.awayLabel??picked.away}</option>
      </select>:<input name="selection" value={selection} onChange={e=>setSelection(e.target.value)} className="input" required/>}
    </Field>
    <Field label={needsLine?"Line":"Line (optional)"}><input name="line" type="number" step="0.5" defaultValue={prefill.line??""} placeholder="-10.5" className="input" required={needsLine}/></Field>
    <Field label="Price"><input name="price" defaultValue={prefill.price??"-110"} placeholder="-105" className="input" required/></Field>
    <Field label="Stake"><input name="stake" type="number" autoFocus={inline} step="0.01" min="0.01" defaultValue={prefill.stake??""} placeholder="1.00" className="input" required/></Field>
    <Field label="Book"><input name="book" defaultValue={prefill.book??""} placeholder="Optional" className="input"/></Field>
    <Field label="Result"><select name="status" defaultValue={prefill.status??"auto"} className="input"><option value="auto">Automatic / open</option><option value="won">Won (manual)</option><option value="lost">Lost (manual)</option><option value="push">Push (manual)</option><option value="void">Void (manual)</option></select></Field>
    <Field label="Placed at (local time)" className="col-span-2 lg:col-span-1"><input name="placedAt" type="datetime-local" defaultValue={localDate(prefill.placedAt)} className="input min-w-0"/></Field>
    <Field label="Note" className="col-span-2"><input name="note" defaultValue={prefill.note??""} placeholder="Optional" className="input"/></Field>
    {!eventId?<p className="col-span-2 text-xs text-[var(--muted)] lg:col-span-3">No game linked. You can still save a historical bet and choose its result manually.</p>:null}
    <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-3"><button type="submit" disabled={pending} className="btn-primary">{pending?"Saving…":editId?"Save changes":"Log bet"}</button>
      {error?<span role="alert" className="text-sm text-[var(--bad)]">{error}</span>:null}{saved?<span role="status" className="text-sm text-[var(--good)]">{saved}</span>:null}
    </div>
  </form>;
}
function Field({label,hint,children,className=""}:{label:string;hint?:string;children:React.ReactNode;className?:string}) {
  return <label className={`block min-w-0 text-sm ${className}`}><span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">{label}</span>{children}{hint?<span className="mt-1 block text-[11px] leading-4 text-[var(--muted)]">{hint}</span>:null}</label>;
}
