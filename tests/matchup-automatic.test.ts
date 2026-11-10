import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAutomaticForecasts, automaticBaselineIsCurrent } from '../src/lib/matchups/automatic.ts';
import { parseScoreboard } from '../src/lib/matchups/schedule.ts';
import { forecastPregameTeamEpa, type Game } from '../src/lib/football/model.ts';
import history from '../public/football/history.json' with { type: 'json' };
const now = '2026-11-10T13:00:00Z';
const game = parseScoreboard({events:[{id:'1',date:'2026-11-12T20:00:00Z',competitions:[{competitors:[{homeAway:'home',team:{displayName:'H'}},{homeAway:'away',team:{displayName:'A'}}]}]}]},'nfl')[0];
const forecast = {id:game.id, startsAt:'2026-11-12T20:00:00Z', featureAsOf:'2026-11-10T12:00:00Z', generatedAt:now, predicted:4, modelVersion:'nfl-team-epa-development-v1',trainCount:500};
const artifact = {version:1,generatedAt:now,expiresAt:'2026-11-10T18:00:00Z',forecasts:[forecast]};
test('fresh pregame model populates margin, never price or probability',()=>{
 const [result]=attachAutomaticForecasts([game],artifact,now);
 assert.equal(result.baselineHomeMargin,4);assert.equal(result.baselineKind,'automatic');
 for(const key of ['homeSpread','homeOdds','awayOdds','homeCoverProbability'] as const)assert.equal(result[key],null);
});
test('stale, future, duplicate, malformed, missing and post-start forecasts fail closed',()=>{
 for(const bad of [null,{}, {...artifact,expiresAt:now},{...artifact,generatedAt:'2026-11-11T13:00:00Z'}, {...artifact,forecasts:[forecast,forecast]}, {...artifact,forecasts:[{...forecast,predicted:NaN}]}, {...artifact,forecasts:[{...forecast,featureAsOf:'2026-11-11T13:00:00Z'}]}, {...artifact,forecasts:[{...forecast,startsAt:now}]}])assert.equal(attachAutomaticForecasts([game],bad,now)[0].baselineHomeMargin,null);
 assert.equal(attachAutomaticForecasts([game],artifact,'2026-11-12T20:00:00Z')[0].baselineHomeMargin,null);
});
test('NFL forecasts are not reused for basketball',()=>assert.equal(attachAutomaticForecasts([{...game,sport:'nba'}],artifact,now)[0].baselineHomeMargin,null));
test('regression ignores reserved outcomes and needs finite features',()=>{
 const target={off_epa_diff:.05,def_epa_allowed_diff:-.02,home_field:1}, games=history.games as Game[];
 const first=forecastPregameTeamEpa(games,target);
 assert.deepEqual(forecastPregameTeamEpa(games.map(g=>g.season===2025 && g.week!>=10?{...g,home_margin:9999}:g),target),first);
 assert.ok(Number.isFinite(first.predicted));assert.ok(first.trainCount>=80);
 assert.throws(()=>forecastPregameTeamEpa([],target));assert.throws(()=>forecastPregameTeamEpa(games,{...target,home_field:NaN}));
});
test('saved/selected snapshots expire and cannot run after kickoff',()=>{
 const [selected]=attachAutomaticForecasts([game],artifact,now);
 assert.equal(automaticBaselineIsCurrent(selected,now),true);assert.equal(automaticBaselineIsCurrent(selected,artifact.expiresAt),false);
 assert.equal(automaticBaselineIsCurrent({...selected,automaticExpiresAt:undefined},now),false);assert.equal(automaticBaselineIsCurrent({...selected,startsAt:now},now),false);
});
