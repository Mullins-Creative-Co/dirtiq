import "server-only";
import type { EventOption } from "@/components/bets/log-bet-form";
import type { TonightBoard } from "@/lib/tonight";
import { getAllResultsIndex, getLedgerIndex, getTeamNames } from "@/lib/model-reports";
import { teamName, eventName } from "@/lib/team-names";
/** Include recent linked games as well as future ones; free text remains available for older bets. */
export function getBetEvents(board: TonightBoard): EventOption[] {
  const names=getTeamNames(),events=new Map<string,EventOption>(),cutoff=Date.now()-120*86400000;
  for(const [id,result] of getAllResultsIndex()){
    if(!result.startsAt||Date.parse(result.startsAt)<cutoff)continue;
    const sport=id.split(":")[0];
    events.set(id,{eventId:id,sport,label:`${teamName(names,sport,result.away)} at ${teamName(names,sport,result.home)}`,startsAt:result.startsAt,
      home:result.home,away:result.away,homeLabel:teamName(names,sport,result.home),awayLabel:teamName(names,sport,result.away),completed:true});
  }
  for(const [id,summary] of getLedgerIndex()){
    if(events.has(id))continue;
    const row=summary.rows.find(r=>r.event_start&&Date.parse(r.event_start)>=cutoff);
    if(!row?.event_start)continue;
    const sport=id.startsWith('race:')?'racing':id.split(':')[0],match=/^([A-Z0-9_]+) at ([A-Z0-9_]+)$/.exec(row.event_label);
    const home=match?.[2]??null,away=match?.[1]??null;
    events.set(id,{eventId:id,sport,label:eventName(names,sport,row.event_label),startsAt:row.event_start,home,away,
      homeLabel:home?teamName(names,sport,home):undefined,awayLabel:away?teamName(names,sport,away):undefined});
  }
  for(const item of board.items){
    const home=item.homeTeam??null,away=item.awayTeam??null;
    if(events.get(item.key)?.completed)continue;
    events.set(item.key,{eventId:item.key,sport:item.sport,label:item.title,startsAt:item.startsAt,home,away,
      homeLabel:home?teamName(names,item.sport,home):undefined,awayLabel:away?teamName(names,item.sport,away):undefined});
  }
  return [...events.values()].sort((a,b)=>b.startsAt.localeCompare(a.startsAt));
}
