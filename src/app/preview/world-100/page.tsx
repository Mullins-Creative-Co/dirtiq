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

const recentChampions=[
 [2025,'Ricky Thornton Jr.','first globe'],[2024,'Bobby Pierce','second globe'],[2023,"Hudson O’Neal",'first globe'],
 [2022,'Jonathan Davenport','fifth globe'],[2021,'Brandon Overton','first globe'],[2020,'Jonathan Davenport','fourth globe'],
 [2019,'Jonathan Davenport','third globe'],[2018,'Tim McCreadie','first globe'],[2017,'Jonathan Davenport','second globe'],
 [2016,'Bobby Pierce','first globe'],[2015,'Jonathan Davenport','first globe'],
] as const;
const modernWinnerStarts=[
 [2025,'Ricky Thornton Jr.',1,'https://www.eldoraspeedway.com/event_coverage/55th-world-100/'],
 [2024,'Bobby Pierce',3,'https://www.eldoraspeedway.com/event_coverage/54th-world-100/'],
 [2023,"Hudson O’Neal",2,'https://www.eldoraspeedway.com/event_coverage/53rd-world-100/'],
 [2022,'Jonathan Davenport',1,'https://www.eldoraspeedway.com/event_coverage/2022-world-100/'],
 [2021,'Brandon Overton',3,'https://www.eldoraspeedway.com/event_coverage/51st-world-100/'],
 [2020,'Jonathan Davenport',6,'https://www.eldoraspeedway.com/event_coverage/50th-world-100/'],
 [2019,'Jonathan Davenport',7,'https://www.eldoraspeedway.com/event_coverage/49th-annual-world-100-9-7-19/'],
 [2018,'Tim McCreadie',5,'https://www.eldoraspeedway.com/event_coverage/48th-annual-world-100/'],
 [2017,'Jonathan Davenport',3,'https://www.eldoraspeedway.com/event_coverage/47th-annual-world-100/'],
 [2016,'Bobby Pierce',22,'https://www.eldoraspeedway.com/event_coverage/46th-annual-world-100/'],
 [2015,'Jonathan Davenport',18,'https://www.eldoraspeedway.com/races/schedule/world-100/'],
] as const;
const championRunIn=[
 [2021,'Brandon Overton',4,2,4,'2.3'],[2022,'Jonathan Davenport',4,3,4,'1.8'],
 [2023,"Hudson O’Neal",7,2,5,'4.3'],[2024,'Bobby Pierce',6,2,5,'3.7'],
 [2025,'Ricky Thornton Jr.',7,3,6,'2.6'],
] as const;

export default function WorldPreview(){
 const source=JSON.parse(readFileSync(path.join(process.cwd(),'public/data/world100.json'),'utf8')) as {source:string;checkedAt:string;entryListAsOf:string;poolRaceId:number;entries:Entry[]};
 const fullHistory=getStatsHistory();
 const posted=fullHistory.filter(r=>r.date>='2026-09-10'&&r.date<='2026-09-12'&&/world 100/i.test(r.raceName)&&r.finish<=3);
 const historical=fullHistory.filter(r=>r.date<'2026-09-10');
 const eldora=historical.filter(r=>r.trackName.toLowerCase().includes('eldora'));
 const history=new Map(driverStats(eldora).map(d=>[d.id,d]));
 const predictions=getCachedMlPredictions(source.poolRaceId);
 const entrants=source.entries.map(e=>({...e,history:history.get(e.driverId),score:predictions.get(e.driverId)?.rawProbability??null,probability:predictions.get(e.driverId)?.probability??null})).sort((a,b)=>(b.score??-1)-(a.score??-1));
 const baltes=eldora.filter(r=>r.date==='2026-09-06'&&/baltes/i.test(r.raceName)&&r.finish<=5);
 const registeredIds=new Set(entrants.map(e=>e.driverId));
 const modelTop=entrants.filter(e=>e.probability!==null).slice(0,8);
 const prelimWinners=posted.filter(r=>r.finish===1&&/prelim|twin 25/i.test(r.raceName));
 const tally=(values:string[])=>[...new Map(values.map(v=>[v,values.filter(x=>x===v).length])).entries()].sort((a,b)=>b[1]-a[1]);
 const chassis=tally(entrants.map(e=>e.chassis.startsWith('Rocket')?'Rocket family':e.chassis||'Unreported'));
 const engines=tally(entrants.map(e=>e.engine.replace('Cornette','Cornett').replace('Scott Bailey Racing Engines','Scott Bailey')||'Unreported'));
 const firstTimers=recentChampions.filter(([, ,note])=>note==='first globe').length;
 const topSix=modernWinnerStarts.filter(([, ,start])=>start<=6).length;
 const davenport=entrants.find(e=>e.name==='Jonathan Davenport');
 const american=(p:number)=>`+${Math.round(((1-p)/p)*10)*10}`;

 return <><StatsNav/><LivePolling enabled={true}/><main className="mx-auto max-w-7xl space-y-10 px-5 py-10">
  <section className="border-b border-border pb-8"><p className="text-xs font-bold uppercase tracking-[.2em] text-accent">World 100 notebook · Eldora Speedway · September 10–12, 2026</p><h1 className="mt-4 font-display text-4xl font-black sm:text-6xl">What does this year’s winner look like?</h1><p className="mt-5 max-w-3xl text-lg text-muted-strong">Recent winners arrived with national-tour momentum, protected track position and usually already knew how to win at this level. DirtIQ will update the profile as verified prelim results arrive.</p><p className="mt-4 text-xs text-muted">Registration list dated {source.entryListAsOf}, checked {source.checkedAt.slice(0,10)}. <a className="underline" href={source.source}>Official entry list ↗</a></p></section>

  <section><p className="text-xs font-bold uppercase tracking-[.2em] text-accent">The modern winner profile</p><h2 className="mt-2 font-display text-3xl font-black">Four signals that matter most</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
   <article className="panel p-5"><p className="font-display text-4xl font-black">5 / 5</p><p className="mt-2 text-sm text-muted-strong">Last five champions had won a national-tour feature in the previous 28 days.</p></article>
   <article className="panel p-5"><p className="font-display text-4xl font-black">24 / 28</p><p className="mt-2 text-sm text-muted-strong">Top-five finishes in those champions’ combined four-week tour sample.</p></article>
   <article className="panel p-5"><p className="font-display text-4xl font-black">6 straight</p><p className="mt-2 text-sm text-muted-strong">World 100s won from a starting position of sixth or better.</p></article>
   <article className="panel p-5"><p className="font-display text-4xl font-black">7 / 11</p><p className="mt-2 text-sm text-muted-strong">Since 2015 won by either Jonathan Davenport or Bobby Pierce.</p></article>
  </div><div className="mt-4 rounded border border-border bg-surface-raised p-5 text-sm text-muted-strong"><b className="text-white">DirtIQ’s read:</b> prioritize a driver with a win and repeated top-five speed in the last month, then demand front-three qualifying or enough prelim passing speed to earn a top-six Saturday start. A deep-grid win is possible, but the last two came back-to-back in 2015 and 2016.</div></section>

  <section className="grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
   <article className="panel p-6"><p className="text-xs font-bold uppercase tracking-widest text-accent">Opening fair market</p><h2 className="mt-2 text-2xl font-bold">The model’s leading eight</h2><ol className="mt-5 space-y-3">{modelTop.map((e,i)=><li key={e.driverId} className="flex items-center justify-between border-b border-border pb-3 text-sm"><span><b className="mr-3 text-muted">{i+1}</b>{e.name} <span className="text-xs text-muted">#{e.car}</span></span><span><b>{american(e.probability!)}</b> <span className="ml-1 text-xs text-muted">{(e.probability!*100).toFixed(1)}%</span></span></li>)}</ol><Link href="/odds/world-100" className="mt-5 inline-block font-bold text-accent">Open all {entrants.length} prices and compare a line →</Link><p className="mt-3 text-xs text-muted">No-vig early estimates before confirmed groups, qualifying and prelim results.</p></article>
   <article className="panel overflow-hidden"><div className="p-6"><p className="text-xs font-bold uppercase tracking-widest text-accent">Four-week tour form</p><h2 className="mt-2 text-2xl font-bold">Every recent champion arrived hot</h2><p className="mt-3 text-sm text-muted-strong">The last five champions combined for 12 wins in 28 deduplicated Lucas Oil or World of Outlaws features immediately before the World 100.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-surface-raised text-xs text-muted"><tr>{['Champion','Starts','Wins','Top 5s','Avg.'].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{championRunIn.map(([year,name,starts,wins,top5,avg])=><tr key={year} className="border-t border-border"><td className="whitespace-nowrap px-4 py-3"><b>{year}</b> · {name}</td><td className="px-4 py-3">{starts}</td><td className="px-4 py-3 font-bold">{wins}</td><td className="px-4 py-3">{top5}</td><td className="px-4 py-3">{avg}</td></tr>)}</tbody></table></div><p className="p-5 text-xs text-muted">Window: 28 days before each World 100. Baltes results excluded.</p></article>
  </section>

  <section className="panel overflow-hidden">
   <div className="border-b border-border p-6"><p className="text-xs font-bold uppercase tracking-widest text-accent">Leakage-free replay · Thursday night</p><h2 className="mt-2 text-2xl font-bold">Could the model find last night’s winners?</h2><p className="mt-3 max-w-3xl text-sm text-muted-strong">This replay was run after the races, but the model was trained only through September 6 and the scoring database withheld all September 10 finishes. It received each 26-car field and starting grid—the information available before the features.</p></div>
   <div className="grid md:grid-cols-2"><article className="p-6 md:border-r md:border-border"><p className="text-xs font-bold text-accent">FEATURE 1</p><h3 className="mt-2 text-xl font-bold">Ashton Winger</h3><div className="mt-4 grid grid-cols-2 gap-4"><div><p className="font-display text-3xl font-black">#1</p><p className="text-xs text-muted">Grid-aware model rank</p></div><div><p className="font-display text-3xl font-black">22.8%</p><p className="text-xs text-muted">Replay win probability</p></div></div><p className="mt-4 text-sm text-muted-strong">Winger started third and won. Before the field split and grid were known, the early registration-pool model had him 14th of 106.</p></article><article className="border-t border-border p-6 md:border-t-0"><p className="text-xs font-bold text-accent">FEATURE 2</p><h3 className="mt-2 text-xl font-bold">Brandon Overton</h3><div className="mt-4 grid grid-cols-2 gap-4"><div><p className="font-display text-3xl font-black">#3</p><p className="text-xs text-muted">Grid-aware model rank</p></div><div><p className="font-display text-3xl font-black">14.1%</p><p className="text-xs text-muted">Replay win probability</p></div></div><p className="mt-4 text-sm text-muted-strong">Overton started second and won. The early registration-pool model had him 15th of 106.</p></article></div>
   <p className="border-t border-border p-5 text-xs text-muted"><b>Honest interpretation:</b> the replay selected one winner first and the other third after seeing their grids. It tests the model pipeline without result leakage; it is not evidence that these exact predictions were published before the green flag.</p>
  </section>

  <section className="grid gap-6 lg:grid-cols-2">
   <article className="panel p-6"><p className="text-xs font-bold uppercase tracking-widest text-accent">Track position</p><h2 className="mt-2 text-2xl font-bold">The recent race is won near the front</h2><div className="mt-5 grid grid-cols-2 gap-4"><div><p className="font-display text-4xl font-black">{topSix} / 11</p><p className="mt-2 text-sm text-muted-strong">Since 2015 started sixth or better.</p></div><div><p className="font-display text-4xl font-black">3 / 11</p><p className="mt-2 text-sm text-muted-strong">Won from seventh or deeper.</p></div></div><p className="mt-5 text-sm text-muted">The deep starters were Davenport from 18th in 2015, Pierce from 22nd in 2016 and Davenport from seventh in 2019. Every winner since then started in the first three rows.</p><details className="mt-5"><summary className="cursor-pointer text-sm font-bold text-accent">Show all 11 verified starting spots</summary><ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">{modernWinnerStarts.map(([year,name,start,url])=><li key={year}><a className="text-muted-strong hover:text-white" href={url}>{year} · {name} · P{start} ↗</a></li>)}</ul></details></article>
   <article className="panel p-6"><p className="text-xs font-bold uppercase tracking-widest text-accent">Baltes signal</p><h2 className="mt-2 text-2xl font-bold">Fresh Eldora speed has converted once</h2><p className="mt-4 text-sm text-muted-strong"><b>Ricky Thornton Jr.</b> won Baltes Feature A in 2025 and the World 100 six days later—the only sweep in DirtIQ’s verified 2021–2025 Baltes sample. In 2021, Baltes runner-up Hudson O’Neal finished fourth in the World; in 2024, Davenport ran third in both.</p><p className="mt-5 text-sm font-bold">2026 registered Baltes top fives</p><ul className="mt-3 space-y-3">{baltes.filter(r=>registeredIds.has(r.driverId)).map(r=><li key={`${r.raceId}-${r.driverId}`} className="flex justify-between gap-4 border-b border-border pb-2 text-sm"><span>{r.driverName}</span><span className="text-muted">P{r.start} → P{r.finish} · {r.raceName.endsWith('A')?'A':'B'}</span></li>)}</ul></article>
  </section>

  <section className="panel p-6"><p className="text-xs font-bold uppercase tracking-widest text-accent">Live weekend signal</p><h2 className="mt-2 text-2xl font-bold">Prelim winners and movers</h2>{prelimWinners.length?<div className="mt-5 grid gap-4 sm:grid-cols-2">{prelimWinners.map(r=><article key={r.raceId} className="rounded border border-border p-4"><p className="text-xs text-muted">{r.raceName}</p><p className="mt-2 text-xl font-bold">{r.driverName}</p><p className="mt-1 text-sm text-muted-strong">Started {r.start??'unknown'}{r.start?` · gained ${r.start-r.finish} positions`:''}</p></article>)}</div>:<p className="mt-4 text-sm text-muted-strong">No verified Twin 25 winner is posted yet. DirtIQ will add the winner, starting spot and positions gained after the official box score arrives.</p>}<div className="mt-5 grid gap-3 text-sm sm:grid-cols-3"><div className="rounded bg-surface-raised p-4"><b>Qualifying</b><p className="mt-1 text-muted">A top-six Saturday start matches every winner since 2020.</p></div><div className="rounded bg-surface-raised p-4"><b>Passing</b><p className="mt-1 text-muted">Forward movement matters most when it repeats across both prelim nights.</p></div><div className="rounded bg-surface-raised p-4"><b>Conversion</b><p className="mt-1 text-muted">Track whether a prelim winner reaches Saturday’s podium or wins the globe.</p></div></div></section>

  <section><p className="text-xs font-bold uppercase tracking-[.2em] text-accent">Equipment snapshot</p><h2 className="mt-2 font-display text-3xl font-black">What is underneath the field?</h2><div className="mt-5 grid gap-5 lg:grid-cols-3"><article className="panel p-6"><h3 className="text-xl font-bold">Chassis</h3><ol className="mt-4 space-y-3">{chassis.slice(0,6).map(([name,count])=><li key={name} className="flex justify-between border-b border-border pb-2 text-sm"><span>{name}</span><b>{count} · {pct(count,entrants.length)}</b></li>)}</ol></article><article className="panel p-6"><h3 className="text-xl font-bold">Engine builders</h3><ol className="mt-4 space-y-3">{engines.slice(0,6).map(([name,count])=><li key={name} className="flex justify-between border-b border-border pb-2 text-sm"><span>{name}</span><b>{count} · {pct(count,entrants.length)}</b></li>)}</ol></article><article className="panel p-6"><h3 className="text-xl font-bold">Davenport watch</h3><p className="mt-4 text-sm text-muted-strong">Official entry: <b>{davenport?.chassis??'unreported'}</b> chassis with <b>{davenport?.engine??'engine unreported'}</b>. Eldora does not publish shock brands, so Bilstein, Öhlins, Penske and Integra claims stay out until verified.</p></article></div><p className="mt-3 text-xs text-muted">Field shares describe registrations, not win rates. Historical equipment correlations require verified year-by-year packages.</p></section>

  <section className="panel overflow-hidden"><div className="p-6"><p className="text-xs font-bold uppercase tracking-widest text-accent">Eleven-year globe room</p><h2 className="mt-2 text-2xl font-bold">Six drivers won the last 11 World 100s</h2><p className="mt-3 text-sm text-muted-strong">{firstTimers} were first-time winners. Davenport won five and Pierce won two, showing both turnover and heavy concentration at the top.</p></div><div className="grid grid-cols-1 border-t border-border sm:grid-cols-2">{recentChampions.map(([year,name,note])=><div key={year} className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 sm:odd:border-r"><span><b>{year}</b> · {name}</span><span className="text-xs text-muted">{note}</span></div>)}</div><a href="https://www.eldoraspeedway.com/world-100-driver-history/" className="block p-5 text-sm font-semibold text-accent">Explore Eldora’s complete history ↗</a></section>
  <p className="text-xs text-muted">Historical counts are scoped to the verified samples shown. Career Eldora totals are omitted because the retained box scores are incomplete.</p>
 </main></>;
}
