import {readFileSync} from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import {StatsNav} from '@/components/stats-nav';
import {WorldOddsBoard,type WorldOddsRow} from '@/components/world-odds-board';
import {getCachedMlPredictions} from '@/lib/ml-predictions';
export const dynamic='force-dynamic';
export const metadata={title:'World 100 odds | dirtIQ'};
type Entry={driverId:number;name:string;car:string;chassis:string;engine:string};
function american(p:number){if(p>=.5)return `${Math.round(-100*p/(1-p))}`;return `+${Math.round(100*(1-p)/p/10)*10}`}
export default function WorldOddsPage(){
 const source=JSON.parse(readFileSync(path.join(process.cwd(),'public/data/world100.json'),'utf8')) as {entryListAsOf:string;poolRaceId:number;entries:Entry[]};
 const predictions=getCachedMlPredictions(source.poolRaceId);
 const rows:WorldOddsRow[]=source.entries.map(e=>{const p=predictions.get(e.driverId)?.probability??0;return {...e,rank:0,probability:p,fairAmerican:p?american(p):'—',decimal:p?1/p:0}}).sort((a,b)=>b.probability-a.probability).map((r,i)=>({...r,rank:i+1}));
 return <><StatsNav/><main className="mx-auto max-w-7xl space-y-7 px-5 py-10"><div><Link href="/" className="text-sm text-accent">← World 100 preview</Link><p className="mt-6 text-xs font-bold uppercase tracking-[.2em] text-accent">DirtIQ odds lab · pre-prelim</p><h1 className="mt-3 font-display text-4xl font-black sm:text-6xl">Price the chase for the globe.</h1><p className="mt-4 max-w-3xl text-lg text-muted-strong">Opening World 100 probabilities from the retrained crown-jewel model. The board will reprice when verified qualifying, heat and prelim evidence reaches the race-night model.</p></div><section className="grid gap-4 sm:grid-cols-3"><article className="panel p-5"><b>106-driver pool</b><p className="mt-2 text-sm text-muted">Registration list dated {source.entryListAsOf}; Saturday starters are not yet known.</p></article><article className="panel p-5"><b>No house hold</b><p className="mt-2 text-sm text-muted">Fair probabilities total 100%. Offered odds may include bookmaker margin.</p></article><article className="panel p-5"><b>Opening stage</b><p className="mt-2 text-sm text-muted">No qualifying groups, feature grids or prelim finishes are included yet.</p></article></section><WorldOddsBoard rows={rows}/><p className="text-xs text-muted">Positive edge means DirtIQ's estimated probability exceeds the probability implied by the entered price. Small edges are noise in a field this large. Model prices are analytical estimates, not sportsbook lines or betting advice.</p></main></>;
}
