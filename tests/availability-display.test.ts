import test from "node:test";
import assert from "node:assert/strict";
import { availabilitySummary, injuryNewsHref, injuryProjectionView } from "../src/lib/availability-display.ts";
import type { AvailabilityGame } from "../src/lib/model-reports.ts";
const now=Date.parse("2026-11-18T15:00:00Z");
const team={team:"BOS",name:"Boston",coverage:"scenario",reason:null,qbFlag:false,outMinutes:20,uncertainMinutes:0,points:null,players:[]};
const game:AvailabilityGame={id:"nba:1",sport:"nba",gameId:"1",home:"BOS",away:"NY",startsAt:"2026-11-19T01:00:00Z",asOf:"2026-11-18T14:30:00Z",baselineHomeMargin:4,appliedToForecast:false,sourceUrl:"https://example.test",homeMarginChange:{min:-2,max:0,listedOut:-2},contexts:{home:team,away:team}};
test("missing or stale injury data never looks healthy or gets a point value",()=>{
 assert.match(availabilitySummary(null,now).detail,/does not mean healthy/);
 assert.equal(availabilitySummary({...game,asOf:"2026-11-18T10:00:00Z"},now).stale,true);
 assert.doesNotMatch(availabilitySummary({...game,asOf:"2026-11-18T10:00:00Z"},now).detail,/-2.0/);
 assert.equal(availabilitySummary({...game,asOf:"2026-11-19T10:00:00Z"},now).stale,true);
});
test("point values are labeled experimental and separate from the forecast",()=>{
 const before=JSON.stringify(game);const result=availabilitySummary(game,now);
 assert.match(result.detail,/-2.0 to 0.0 pts/);assert.match(result.detail,/Separate from the forecast/);
 assert.equal(JSON.stringify(game),before);
 assert.match(availabilitySummary({...game,homeMarginChange:null},now).detail,/unvalued/);
});

test("injury source searches preserve matchup names and use the Eastern game date",()=>{
 const url=new URL(injuryNewsHref("St. John's at Texas A&M", "ncaab", "2026-11-20T01:00:00Z"));
 assert.equal(url.origin,"https://www.google.com");
 assert.match(url.searchParams.get("q")??"",/St\. John's at Texas A&M NCAAB injury report confirmed starters 2026-11-19/);
 assert.doesNotMatch(injuryNewsHref("A at B","nfl","invalid"),/Invalid Date/);
});

test("injury-adjusted numeric predictions expire and never change the baseline",()=>{
 const p={status:"applied" as const,experimental:true as const,asOf:game.asOf,reason:"test",homeMargin:2,homeSpread:-2,total:216,marginChange:-2,totalChange:-4,baselineHomeMargin:4,baselineHomeSpread:-4,baselineTotal:220,homeMarginRange:[1,4] as [number,number],totalRange:[215,220] as [number,number],method:"nba-minute-ridge-v1",totalMethod:"nba-total-minute-ridge-v1"};
 const g={...game,injuryAdjustedProjection:p};const before=JSON.stringify(g);
 assert.equal(injuryProjectionView(g,now)?.homeSpread,-2);
 assert.equal(injuryProjectionView(g,now)?.total,216);
 assert.equal(JSON.stringify(g),before);
 assert.equal(injuryProjectionView(g,Date.parse(game.startsAt)),null);
 assert.equal(injuryProjectionView({...g,asOf:"2026-11-18T10:00:00Z"},now),null);
 assert.equal(injuryProjectionView({...g,injuryAdjustedProjection:{...p,status:"unavailable"}},now),null);
 assert.match(availabilitySummary(g,now).detail,/Used in the experimental injury-adjusted spread/);
});
