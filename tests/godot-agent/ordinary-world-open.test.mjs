import test from 'node:test';import assert from 'node:assert/strict';
import {openWorldAfterNavigationReady} from '../helpers/ordinary-world-open.mjs';

test('ordinary open waits for the world selector and tolerates only explicit busy preflight',async()=>{
 let reads=0,opens=0,waits=0;const trace=[];
 const result=await openWorldAfterNavigationReady({worldId:'same-world',readReady:async()=>({ready:++reads>1}),open:async id=>{assert.equal(id,'same-world');if(++opens===1)throw Error('Error: WORLD_BUSY');return {worldId:id};},wait:async()=>{waits++;},record:value=>trace.push(value)});
 assert.deepEqual(result,{worldId:'same-world'});assert.equal(reads,3);assert.equal(opens,2);assert.equal(waits,2);assert.equal(trace.length,1);
});

test('lost replies and non-busy failures never cause a second world-open dispatch',async()=>{
 for(const message of ['TIMEOUT worldNavigation','GODOT_CANDIDATE_ACTIVE','WORLD_BUSY: unknown suffix','WORLD_OPEN_FAILED']){
  let calls=0;await assert.rejects(openWorldAfterNavigationReady({worldId:'same-world',readReady:async()=>({ready:true}),open:async()=>{calls++;throw Error(message);},wait:async()=>{throw Error('must not retry');}}));assert.equal(calls,1);
 }
});

test('a not-yet-mounted world view is a pending read, not another world-open request',async()=>{
 let reads=0,opens=0;const records=[];
 await openWorldAfterNavigationReady({worldId:'world',readReady:async()=>{if(++reads===1)throw Error('World view is not ready');return {ready:true};},open:async()=>{opens++;return {};},wait:async()=>{},record:value=>records.push(value)});
 assert.equal(reads,2);assert.equal(opens,1);assert.equal(records[0].kind,'world-navigation-observation-pending');
});

test('cancellation or an exhausted startup deadline cannot issue another open',async()=>{
 let cancelled=false,calls=0;
 await assert.rejects(openWorldAfterNavigationReady({worldId:'world',readReady:async()=>({ready:false}),open:async()=>{calls++;},wait:async()=>{cancelled=true;},assertActive:()=>{if(cancelled)throw Error('CANCELLED');}}),/CANCELLED/);assert.equal(calls,0);
 let clock=0;await assert.rejects(openWorldAfterNavigationReady({worldId:'world',readReady:async()=>({ready:false}),open:async()=>{calls++;},wait:async()=>{clock+=5;},now:()=>clock,timeoutMs:10}),/WORLD_NAVIGATION_OPEN_TIMEOUT/);assert.equal(calls,0);
});
