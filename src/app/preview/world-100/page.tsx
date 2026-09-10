import Link from 'next/link';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {LivePolling} from '@/components/live-polling';
import {StatsNav} from '@/components/stats-nav';
import {getStatsHistory} from '@/lib/stats-data';
import {driverStats,pct} from '@/lib/stats-analysis';
import {getCachedMlPredictions} from '@/lib/ml-predictions';
export const dynamic='force-dynamic';
export const metadata={title:'World 100 race preview | dirtIQ'};
type Entry={driverId:number;name:string;car:string;chassis:string;engine:string};
export default function WorldPreview(){
 const source=JSON.parse(readFileSync(path.join(process.cwd(),'public/data/world100.json'),'utf8')) as {source:string;checkedAt:string;entryListAsOf:string;poolRaceId:number;entries:Entry[]};
 const fullHistory=getStatsHistory();
 const posted=fullHistory.filter(r=>r.date>='2026-09-10'&&r.date<='2026-09-12'&&/world 100/i.test(r.raceName)&&r.finish<=3);
 const all=fullHistory.filter(r=>r.date<'2026-09-10');
 const eldora=all.filter(r=>r.trackName.toLowerCase().includes('eldora'));
 const history=new Map(driverStats(eldora).map(d=>[d.id,d]));
 const form=new Map(driverStats(all).map(d=>[d.id,d]));
 const predictions=getCachedMlPredictions(source.poolRaceId);
 const entrants=source.entries.map(e=>({...e,history:history.get(e.driverId),form:form.get(e.driverId),score:predictions.get(e.driverId)?.rawProbability??null})).sort((a,b)=>(b.score??-1)-(a.score??-1)||(b.history?.wins??0)-(a.history?.wins??0));
 const world=eldora.filter(r=>/world 100/i.test(r.raceName)&&r.finish===1);
 const known=world.filter(r=>r.start!==null);
 const baltes=eldora.filter(r=>r.date==='2026-09-06'&&/baltes/i.test(r.raceName)&&r.finish<=5);
 const registeredIds=new Set(entrants.map(e=>e.driverId));
 const startSix=known.filter(r=>r.start!>=6).length;
 return <><StatsNav/><LivePolling enabled={true}/><main className="mx-auto max-w-7xl space-y-8 px-5 py-10"><Link href="/" className="text-sm text-muted">← All racing stats</Link>
 <section className="border-b border-border pb-8"><p className="text-xs font-bold uppercase tracking-[.2em] text-accent">Race notebook · Eldora Speedway · September 10–12, 2026</p><h1 className="mt-4 font-display text-4xl font-black sm:text-6xl">The road to the globe.</h1><p className="mt-5 max-w-3xl text-lg text-muted-strong">World 100 starts with two 25-lap prelim features on Thursday. Watch how speed survives traffic, who gains places after qualifying, and whether recent Eldora form carries over to this field.</p><p className="mt-4 text-xs text-muted">Preview cutoff: September 10, before Thursday’s racing. Registration list dated {source.entryListAsOf}, checked {source.checkedAt.slice(0,10)}. <a className="underline" href={source.source}>Official event details and entry list ↗</a></p></section>
 <section className="grid gap-4 sm:grid-cols-3">{[
 ['THU · SEPT 10','Prelim night one','Twin 25s · $12,000 to win each','Hot laps 6:00 PM · Racing 7:30 PM ET'],
 ['FRI · SEPT 11','Prelim night two','Twin 25s · $12,000 to win each','Hot laps 6:00 PM · Racing 7:30 PM ET'],
 ['SAT · SEPT 12','World 100','Heats, B-features and the 100-lap final','Hot laps 6:30 PM · Racing 7:30 PM ET']
 ].map(([date,title,detail,time])=><article key={date} className="panel p-5"><p className="text-xs font-bold text-accent">{date}</p><h2 className="mt-3 text-xl font-bold">{title}</h2><p className="mt-2 text-sm text-muted-strong">{detail}</p><p className="mt-4 text-xs text-muted">{time}</p></article>)}</section>
 <section className="grid gap-6 lg:grid-cols-2"><article className="panel p-6"><p className="text-xs uppercase tracking-widest text-accent">Test the talking point</p><h2 className="mt-3 text-2xl font-bold">Do winners need a front-row start?</h2><p className="mt-4 font-display text-4xl font-black">{startSix} / {known.length}</p><p className="mt-2 text-muted-strong">Recorded World 100 winners with a known grid position started sixth or farther back: {pct(startSix,known.length)}.</p><p className="mt-4 text-sm text-muted">That is {known.length} known starts out of {world.length} retained World 100 winners—not the event’s full history. It describes where winners started; it does not tell us a sixth-place starter’s chance of winning. Prelim races are a different distance and format.</p><ul className="mt-4 space-y-2 text-sm">{world.map(r=><li key={r.raceId}><a className="text-muted-strong hover:text-white" href={r.source?.startsWith('https://')?r.source:`/race/${r.raceId}`}>{r.date} · {r.driverName} · start {r.start??'unknown'} ↗</a></li>)}</ul></article>
 <article className="panel p-6"><p className="text-xs uppercase tracking-widest text-accent">Recent track evidence</p><h2 className="mt-3 text-2xl font-bold">Baltes form to follow</h2><p className="mt-3 text-sm text-muted-strong">The September 6 twin features offer fresh Eldora evidence. Different fields and track conditions mean this is a watchlist, not proof of a World 100 advantage.</p><ul className="mt-5 space-y-3">{baltes.filter(r=>registeredIds.has(r.driverId)).map(r=><li key={`${r.raceId}-${r.driverId}`} className="flex justify-between gap-4 border-b border-border pb-2 text-sm"><span>{r.driverName}</span><span className="text-muted">{r.start} → {r.finish} · {r.raceName.endsWith('A')?'A':'B'}</span></li>)}</ul><p className="mt-4 text-xs text-muted">Registered drivers who finished top five in a Baltes feature. Arrows show starting and finishing position.</p></article></section>
 <section className="panel p-6"><h2 className="text-2xl font-bold">Weekend result watch</h2><p className="mt-3 text-sm text-muted-strong">Official results are checked every 15 minutes while the refresh worker is running. This page refreshes every 30 seconds.</p>{posted.length?<ul className="mt-4 space-y-2 text-sm">{posted.map(r=><li key={`${r.raceId}-${r.driverId}`}>{r.raceName} · P{r.finish} {r.driverName} · started {r.start??'unknown'}</li>)}</ul>:<p className="mt-4 text-sm text-muted">Awaiting verified Thursday–Saturday feature results. An unpublished or unrecognized box score stays pending.</p>}</section>
 <section><h2 className="text-2xl font-bold">Three things to watch tonight</h2><div className="mt-5 grid gap-4 md:grid-cols-3">{[
 ['Qualifying versus race pace','Track the drivers who gain at least five places without a top-ten finish. A modest result can hide useful race pace; the stats page tests what follows that pattern.'],
 ['Performance within each group','Compare entrants within their assigned prelim field. An overall entry-list ranking is not a feature win probability. Recalculate after the groups and grids are confirmed.'],
 ['Repeatable progress','Look for drivers who move forward across sessions, not just the fastest single lap. Record the qualifying group and start position before judging the finishing order.']
 ].map(([h,t])=><article key={h} className="panel p-5"><h3 className="font-bold">{h}</h3><p className="mt-3 text-sm text-muted-strong">{t}</p></article>)}</div></section>
 <section className="panel overflow-hidden"><div className="p-6"><p className="text-xs font-bold uppercase tracking-widest text-accent">{entrants.length} official registrations</p><h2 className="mt-2 text-2xl font-bold">The field, with context</h2><p className="mt-3 max-w-3xl text-sm text-muted-strong">{predictions.size?'Ordered by the retrained early crown model across the registration pool.':'Ordered by recorded Eldora wins while model scoring is unavailable.'} This is a comparative ranking, not odds for either prelim. Entries are not confirmed feature starters. Historical form uses only recorded, retained races before September 10.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-surface-raised text-xs text-muted"><tr>{['Rank','Driver','Eldora starts / wins','Eldora avg finish','Last five recorded','Chassis'].map(h=><th className="px-5 py-3" key={h}>{h}</th>)}</tr></thead><tbody>{entrants.map((e,i)=><tr key={e.driverId} className="border-t border-border"><td className="px-5 py-3 text-muted">{i+1}</td><td className="whitespace-nowrap px-5 font-semibold">{e.name}<span className="ml-2 text-xs text-muted">#{e.car}</span></td><td className="px-5">{e.history?`${e.history.starts} / ${e.history.wins}`:'No retained history'}</td><td className="px-5">{e.history?.average.toFixed(1)??'—'}</td><td className="whitespace-nowrap px-5 text-muted-strong">{e.form?.last5.join(' · ')??'—'}</td><td className="px-5 text-xs text-muted">{e.chassis}</td></tr>)}</tbody></table></div></section>
 <p className="text-xs text-muted">Model rankings and trends are limited by incomplete series coverage and the excluded conflict records. Timing and entries may change; consult <a className="underline" href={source.source}>Eldora’s official event page</a>. This notebook stays anchored to the pre-Thursday cutoff.</p>
 </main></>;
}
