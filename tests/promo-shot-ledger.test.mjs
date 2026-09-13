import test from 'node:test';
import assert from 'node:assert/strict';
import {ledgerFromEvents,usageDelta} from '../scripts/promo-shot-ledger.mjs';
const counts=n=>({totalTokens:n,inputTokens:n-10,cachedInputTokens:n-20,cacheWriteInputTokens:0,outputTokens:10,reasoningOutputTokens:5});
const event=(type,extra={})=>({format:'craftmine.codex-event/1',type,threadId:'thread',hostTurnId:'turn',...extra});
test('repeated cumulative usage events count each turn once and retain subset counters',()=>{
  const result=ledgerFromEvents([event('session',{resumed:false,model:'gpt-6-astra',effort:'xhigh'}),event('user',{text:'trees'}),event('usage',{tokenUsage:{total:counts(100)}}),event('usage',{tokenUsage:{total:counts(100)}}),event('turn-end',{status:'completed',elapsedMs:1000}),event('session',{resumed:true}),event('user',{hostTurnId:'turn2',text:'flowers'}),event('usage',{hostTurnId:'turn2',tokenUsage:{total:counts(180)}})]);
  assert.equal(result.turns[0].usage.totalTokens,100);assert.equal(result.turns[1].usage.totalTokens,80);
  assert.equal(result.turns[1].usage.cachedInputTokens,80);assert.equal(result.turns[1].status,'incomplete');assert.equal(result.cost,null);
});
test('truncated resumed history and decreasing counters cannot invent a token delta',()=>{
  assert.equal(usageDelta(counts(180),counts(100)),null);
  const r=ledgerFromEvents([event('session',{resumed:true}),event('user'),event('usage',{tokenUsage:{total:counts(180)}})]);
  assert.equal(r.turns[0].usage,null);assert.equal(r.turns[0].usageCumulative.totalTokens,180);
});
test('passed check remains a check and repeated job reads update one record',()=>{
  const r=ledgerFromEvents([event('user'),...['running','passed'].map(status=>event('tool-result',{name:'godot_build_read',result:{jobId:'job',status,buildId:'build',candidateId:status==='passed'?'candidate':null}}))]);
  assert.equal(r.turns[0].checks.length,1);assert.equal(r.turns[0].checks[0].status,'passed');assert.equal(r.turns[0].applied,undefined);
});
