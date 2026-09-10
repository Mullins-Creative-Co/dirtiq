import 'server-only';
import {getDb} from '@/lib/db';
import quality from '../../public/data/data-quality.json';
import {type StatResult} from './stats-analysis';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';

export function getStatsHistory(): StatResult[] {
  const rows=getDb().prepare(`SELECT r.id raceId,r.name raceName,r.race_date date,r.track_id trackId,t.name trackName,
    r.division series,r.distance,re.driver_id driverId,d.name driverName,re.finishing_position finish,
    re.starting_position start,re.heat_position heat,re.qualifying_time qualifying,r.results_source source
    FROM races r JOIN race_entries re ON re.race_id=r.id JOIN tracks t ON t.id=r.track_id JOIN drivers d ON d.id=re.driver_id
    WHERE r.status='complete' AND re.finishing_position>0 ORDER BY r.race_date,r.id,re.finishing_position`).all() as StatResult[];
  const excluded=new Set(quality.excludedRaceIds);
  const clean=rows.filter(r=>!excluded.has(r.raceId));
  const races=new Map<number,StatResult[]>();
  for(const r of clean) races.set(r.raceId,[...(races.get(r.raceId)??[]),r]);
  const valid=new Set([...races].filter(([,r])=>r.length>=10&&r.filter(e=>e.finish===1).length===1&&new Set(r.map(e=>e.finish)).size===r.length).map(([id])=>id));
  return clean.filter(r=>valid.has(r.raceId));
}
export function getModelHealth() {
  const slugs=['lucas_oil_lmds','woo_late_models','crown_jewel_combined','dirtcar_summer_nationals'];
  return slugs.flatMap(slug=>['','_race_night'].map(stage=>{
    const p=path.join(process.env.DIRTIQ_MODEL_DIR??path.join(process.cwd(),'data'),`feature_params_${slug}${stage}.json`);
    if(!existsSync(p)) return {name:slug+stage,trainedAt:null,through:null,accuracy:null};
    const r=JSON.parse(readFileSync(p,'utf8'));
    return {name:`${r.series} · ${stage?'race night':'early'}`,trainedAt:r.trained_at??null,through:r.data_through??null,accuracy:r.top1_acc??null};
  }));
}
export function getRefreshHealth() {
  const dir=process.env.DIRTIQ_DATABASE_DIR??path.join(process.cwd(),'data');
  const p=path.join(dir,'automation-status.json');
  if(!existsSync(p)) return null;
  try{return JSON.parse(readFileSync(p,'utf8')) as {lastRun:string;ok:boolean;message:string;nextRun?:string};}catch{return null;}
}
export const excludedRaceCount=quality.excludedRaceIds.length;
