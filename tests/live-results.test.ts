import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nflCandidate,nflFinalResults} from '../src/lib/live-results/core.ts';
const now=Date.parse('2026-11-15T22:00:00Z');
const candidate=nflCandidate({eventId:'nfl:2026_10_JAX_TEN',eventStart:'2026-11-15T18:00:00Z'},now)!;
function event(id='1',status='STATUS_FINAL',completed=true){return{id,date:candidate.startsAt,status:{type:{name:status,completed}},competitions:[{date:candidate.startsAt,competitors:[{homeAway:'home',team:{abbreviation:'TEN'},score:'23'},{homeAway:'away',team:{abbreviation:'JAX'},score:'40'}]}]};}
test('NFL final preserves the canonical id and excludes partial scores',()=>{
 const rows=nflFinalResults({events:[event()]},[candidate]);
 assert.deepEqual(rows,[{...candidate,homeScore:23,awayScore:40}]);
 assert.deepEqual(nflFinalResults({events:[event('1','STATUS_IN_PROGRESS',false)]},[candidate]),[]);
 assert.deepEqual(nflFinalResults({events:[event('1','STATUS_POSTPONED',false)]},[candidate]),[]);
});
test('ambiguous fixtures, wrong kickoff and invalid candidates remain ungraded',()=>{
 assert.deepEqual(nflFinalResults({events:[event(),event('2')]},[candidate]),[]);
 assert.deepEqual(nflFinalResults({events:[event()]},[{...candidate,startsAt:'2026-11-15T21:00:00Z'}]),[]);
 assert.deepEqual(nflFinalResults({events:[null]},[candidate]),[]);
 assert.equal(nflCandidate({eventId:null,eventStart:candidate.startsAt},now),null);
 assert.equal(nflCandidate({eventId:'other:manual',eventStart:candidate.startsAt},now),null);
 assert.equal(nflCandidate({eventId:candidate.eventId,eventStart:'2026-11-16T18:00:00Z'},now),null);
});
