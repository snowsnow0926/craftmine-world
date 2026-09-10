import test from 'node:test';
import assert from 'node:assert/strict';
import {isExpectedRuntime,waitForInitialRuntime} from './legacy-runtime-ready.mjs';
const ready=()=>({format:'craftmine.godot-observation/1',protocol:'craftmine.godot-runtime/2',worldId:'owned',buildId:'build',instanceId:'instance'});
test('waits for actual target identity after either exact absence reply',async()=>{
  for(const message of ['No world runtime is running','Error: No world runtime is running']){
    let time=0,calls=0;const result=await waitForInitialRuntime({worldId:'owned',observe:async()=>{if(++calls===1)throw Error(message);return ready();},now:()=>time,pause:async()=>{time++;},deadlineMs:3});
    assert.deepEqual(result,ready());assert.equal(calls,2);
  }
});
test('foreign, missing or malformed runtime cannot satisfy the finite readiness deadline',async()=>{
  for(const change of [x=>x.worldId='other',x=>x.instanceId='',x=>delete x.buildId,x=>x.protocol='unknown',x=>x.format='unknown']){
    const value=ready();change(value);assert.equal(isExpectedRuntime(value,'owned'),false);
    let time=0,calls=0;await assert.rejects(waitForInitialRuntime({worldId:'owned',observe:async()=>{calls++;return value;},now:()=>time,pause:async()=>{time++;},deadlineMs:3}),/INITIAL_RUNTIME_READY_TIMEOUT/);assert.equal(calls,3);
  }
});
test('other errors immediately fail; perpetual exact absence remains bounded',async()=>{
  for(const message of ['WORLD_BUSY','Runtime request timed out: load','World view is not ready','Error: No world runtime is running; crash']){
    let paused=false;await assert.rejects(waitForInitialRuntime({worldId:'owned',observe:async()=>{throw Error(message);},pause:async()=>{paused=true;}}),error=>error.message===message);assert.equal(paused,false);
  }
  let time=0;await assert.rejects(waitForInitialRuntime({worldId:'owned',observe:async()=>{throw Error('No world runtime is running');},now:()=>time,pause:async()=>{time++;},deadlineMs:2}),/INITIAL_RUNTIME_READY_TIMEOUT/);
});
