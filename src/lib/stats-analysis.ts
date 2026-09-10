export type StatResult = {
  raceId: number; raceName: string; date: string; trackId: number; trackName: string;
  series: string; distance: number | null; driverId: number; driverName: string;
  finish: number; start: number | null; heat: number | null; qualifying: number | null; source: string | null;
};
export const pct = (n: number, total: number) => total ? `${(100 * n / total).toFixed(1)}%` : '—';
export function interval(success: number, total: number) {
  if (!total) return 'No sample';
  const p = success / total, z = 1.96, d = 1 + z*z/total;
  const center = (p + z*z/(2*total))/d;
  const half = z*Math.sqrt(p*(1-p)/total + z*z/(4*total*total))/d;
  return `${(100*(center-half)).toFixed(0)}–${(100*(center+half)).toFixed(0)}%`;
}
export function gridBands(rows: StatResult[]) {
  return [{label:'1–3', min:1,max:3},{label:'4–6',min:4,max:6},{label:'7–12',min:7,max:12},{label:'13+',min:13,max:999}].map(b => {
    const entries = rows.filter(r => r.start !== null && r.start >= b.min && r.start <= b.max);
    const wins = entries.filter(r => r.finish === 1).length;
    return {...b, starters:entries.length,wins,rate:pct(wins,entries.length), interval:interval(wins,entries.length)};
  });
}
export function driverStats(rows: StatResult[]) {
  const groups = new Map<number,StatResult[]>();
  for (const row of rows) groups.set(row.driverId,[...(groups.get(row.driverId) ?? []),row]);
  return [...groups].map(([id,r]) => {
    r.sort((a,b) => b.date.localeCompare(a.date) || b.raceId-a.raceId);
    const starts=r.filter(e=>e.start!==null);
    return {id,name:r[0].driverName,starts:r.length,wins:r.filter(e=>e.finish===1).length,
      top5:r.filter(e=>e.finish<=5).length,average:r.reduce((s,e)=>s+e.finish,0)/r.length,
      gain:starts.length ? starts.reduce((s,e)=>s+e.start!-e.finish,0)/starts.length : null,
      gainSample:starts.length,last5:r.slice(0,5).map(e=>e.finish),latest:r[0].date};
  }).sort((a,b)=>b.wins-a.wins || b.top5-a.top5 || a.average-b.average);
}
export function discoverPatterns(rows: StatResult[], history: StatResult[]) {
  // Prior means a strictly earlier date: no accidental use of another session
  // whose running order is unknown on the same night.
  const byDriver = new Map<number, StatResult[]>();
  for(const r of history) byDriver.set(r.driverId,[...(byDriver.get(r.driverId)??[]),r]);
  for(const r of byDriver.values()) r.sort((a,b)=>b.date.localeCompare(a.date)||b.raceId-a.raceId);
  const priorCache=new Map<string,StatResult[]>();
  const prior=(r:StatResult)=>{const key=`${r.driverId}:${r.date}`;let result=priorCache.get(key);if(!result){result=(byDriver.get(r.driverId)??[]).filter(p=>p.date<r.date);priorCache.set(key,result);}return result;};
  const specs = [
    {title:'The quiet recovery', detail:'Previous recorded finish outside the top 10, but gained at least five places. Does that speed carry into a top-five finish next time?',match:(r:StatResult)=>{const p=prior(r)[0];return !p || p.start===null ? null : p.finish>10 && p.start-p.finish>=5;}},
    {title:'Track familiarity', detail:'A recorded start at this track in the previous 30 days. Compare next-race top-five rates.',match:(r:StatResult)=>{const p=prior(r);return p.length ? p.some(e=>e.trackId===r.trackId && (Date.parse(r.date)-Date.parse(e.date))/86400000<=30):null;}},
    {title:'Passing form', detail:'Gained places in each of the previous three recorded starts. Does passing form translate into a top five?',match:(r:StatResult)=>{const p=prior(r).slice(0,3);return p.length<3||p.some(e=>e.start===null)?null:p.every(e=>e.start!>e.finish);}},
    {title:'Heat winners from deeper rows', detail:'Won a heat but started the feature seventh or worse. Is the top-five rate different from other heat winners?',match:(r:StatResult)=>r.heat!==1 || r.start===null ? null:r.start>=7},
  ];
  return specs.map(spec=>{
    const eligible=rows.map(r=>({r,flag:spec.match(r)})).filter(x=>x.flag!==null);
    const yes=eligible.filter(x=>x.flag).map(x=>x.r), no=eligible.filter(x=>!x.flag).map(x=>x.r);
    const success=(r:StatResult[])=>r.filter(e=>e.finish<=5).length;
    const rate=(r:StatResult[])=>r.length?success(r)/r.length:null;
    const compare=(from:string,to:string)=>{
      const a=yes.filter(r=>r.date>=from&&r.date<=to), b=no.filter(r=>r.date>=from&&r.date<=to);
      return {n:a.length,controlN:b.length,lift:a.length>=10&&b.length>=10?100*(rate(a)!-rate(b)!):null};
    };
    return {title:spec.title,detail:spec.detail,n:yes.length,controlN:no.length,success:success(yes),controlSuccess:success(no),
      rate:pct(success(yes),yes.length),controlRate:pct(success(no),no.length),interval:interval(success(yes),yes.length),
      lift:yes.length&&no.length?100*(rate(yes)!-rate(no)!):null,
      early:compare('0000','2024-12-31'),recent:compare('2025-01-01','9999'),
      evidence:yes.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5)};
  });
}
