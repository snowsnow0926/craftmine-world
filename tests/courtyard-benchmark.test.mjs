import test from 'node:test';import assert from 'node:assert/strict';
import {OBJECTIVE,MODES,summarizeEvents} from '../scripts/courtyard-benchmark.mjs';
test('matched modes share one playable goal and cumulative counters are differenced once per turn',()=>{
 assert.match(OBJECTIVE,/两栋/);assert.match(OBJECTIVE,/碰撞/);assert.match(OBJECTIVE,/保存后重开/);assert.deepEqual(Object.keys(MODES),['fresh','library','reference']);
 const total=(input,cache,output,reasoning)=>({totalTokens:input+output,inputTokens:input,cachedInputTokens:cache,outputTokens:output,reasoningOutputTokens:reasoning});
 const result=summarizeEvents([
  {type:'user',hostTurnId:'one',text:OBJECTIVE,at:'start'},
  {type:'tool-start',name:'blender_generate'},
  {type:'usage',tokenUsage:{total:total(100,60,10,3)}},
  {type:'usage',tokenUsage:{total:total(250,180,20,8)}},
  {type:'turn-end',status:'completed',elapsedMs:1000},
  {type:'user',hostTurnId:'two',text:'Repair',at:'next'},
  {type:'tool-error',name:'godot_view_capture',error:'UNAVAILABLE'},
  {type:'usage',tokenUsage:{total:total(400,300,30,12)}},
  {type:'turn-end',status:'completed',elapsedMs:2000},
 ]);
 assert.equal(result.turns[0].usage.totalTokens,270);assert.equal(result.turns[1].usage.totalTokens,160);
 assert.equal(result.totals.tokens.totalTokens,430);assert.equal(result.totals.tokens.outputTokens,30);assert.equal(result.totals.tokens.reasoningOutputTokens,12);assert.equal(result.totals.elapsedMs,3000);
 assert.deepEqual(result.turns[1].errors,[{name:'godot_view_capture',error:'UNAVAILABLE'}]);assert.deepEqual(result.missingUsage,[]);
});
test('a turn lacking actual usage remains unavailable instead of being fabricated as zero',()=>{
 const result=summarizeEvents([{type:'user',hostTurnId:'missing',text:OBJECTIVE},{type:'turn-end',status:'error',elapsedMs:50}]);assert.deepEqual(result.missingUsage,['missing']);assert.equal(result.turns[0].usage,undefined);
});
