import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseBetInput,prepareBetEdit} from '../src/lib/my-bets/input.ts';
import type {MyBet} from '../src/lib/my-bets/grade.ts';
function form(extra:Record<string,string>={}){const f=new FormData();for(const[k,v]of Object.entries({sport:'nfl',eventLabel:'Jacksonville Jaguars at Tennessee Titans',market:'spread',selection:'JAX',line:'-10.5',price:'-115',stake:'1',...extra}))f.set(k,v);return f;}
test('historical manual bets accept real dates and explicit outcomes',()=>{
 const r=parseBetInput(form({placedAt:'2024-11-03T19:00:00Z',status:'won'}));
 assert.ok(!('error'in r));assert.equal(r.bet.placedAt,'2024-11-03T19:00:00.000Z');
 assert.equal(r.grading.status,'won');assert.equal(r.grading.manual,true);assert.equal(r.bet.eventId,null);
});
test('edited labels follow actual terms; a price is not a spread',()=>{
 const r=parseBetInput(form({selectionLabel:'JAX -3.5',line:'-6.5'}));
 assert.ok(!('error'in r));assert.equal(r.bet.selectionLabel,'JAX -6.5');
 assert.ok('error'in parseBetInput(form({line:'-105'})));
 assert.ok('error'in parseBetInput(form({placedAt:'not a date'})));
 assert.ok('error'in parseBetInput(form({status:'guessed'})));
});
test('annotation edits preserve old automatic grades; changed terms clear probabilities',()=>{
 const input=parseBetInput(form({placedAt:'2024-11-03T19:00:00Z'}));assert.ok(!('error'in input));
 const old:MyBet={...input.bet,id:1,status:'won',manual:false,resultValue:-17,settledAt:'2024-11-04T00:00:00Z',modelProb:.6,marketProb:.52};
 const edit=prepareBetEdit(old,input);
 assert.equal(edit.grading.status,'won');assert.equal(edit.grading.settledAt,old.settledAt);assert.equal(edit.bet.modelProb,.6);
 const change=prepareBetEdit(old,{...input,bet:{...input.bet,line:-20.5}});
 assert.equal(change.grading.status,'open');assert.equal(change.bet.modelProb,null);assert.equal(change.bet.marketProb,null);
});
test('manual historical outcomes survive metadata edits without becoming model-verified',()=>{
 const input=parseBetInput(form({status:'won'}));assert.ok(!('error'in input));
 const old:MyBet={...input.bet,id:2,status:'won',manual:true,resultValue:null,settledAt:'2024-11-04T00:00:00Z'};
 const edit=prepareBetEdit(old,input);assert.equal(edit.grading.manual,true);assert.equal(edit.grading.status,'won');assert.equal(edit.grading.settledAt,old.settledAt);
});
