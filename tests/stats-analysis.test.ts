import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gridBands,discoverPatterns,interval,type StatResult} from '../src/lib/stats-analysis.ts';
const row=(r:Partial<StatResult>={}):StatResult=>({raceId:1,raceName:'Test',date:'2026-09-01',trackId:1,trackName:'Track',series:'Test',distance:25,driverId:1,driverName:'Driver',finish:1,start:6,heat:1,qualifying:15,source:null,...r});
test('grid rates use all starters and exclude unknown starts',()=>{
 const bands=gridBands([row(),row({driverId:2,finish:8,start:5}),row({driverId:3,finish:1,start:null}),row({driverId:4,finish:2,start:7})]);
 assert.equal(bands[1].starters,2);assert.equal(bands[1].wins,1);assert.equal(bands[1].rate,'50.0%');assert.equal(bands[2].wins,0);
});
test('prior-form signals exclude same-day and future races',()=>{
 const target=row({date:'2026-09-10',finish:3});
 const history=[row({date:'2026-09-01',finish:15,start:22}),row({date:'2026-09-10',finish:1}),row({date:'2026-09-11',finish:1})];
 const signals=discoverPatterns([target],history);
 assert.equal(signals[0].n,1);assert.equal(signals[0].success,1);assert.equal(signals[2].n,0);
});
test('missing previous grid is unknown, not a failed signal',()=>{
 const patterns=discoverPatterns([row({date:'2026-09-10'})],[row({date:'2026-09-01',start:null})]);
 assert.equal(patterns[0].n,0);assert.equal(patterns[0].controlN,0);assert.equal(patterns[0].lift,null);
});
test('uncertainty handles empty samples and is wide for tiny samples',()=>{
 assert.equal(interval(0,0),'No sample');assert.equal(interval(1,1),'21–100%');
});
