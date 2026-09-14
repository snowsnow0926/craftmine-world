import test from 'node:test';
import assert from 'node:assert/strict';
import {createGodotPresentationQueue} from '../plugins/craftmine-world/godot-presentation-queue.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  let owner={worldId:'world',key:'page-1'},busy=true,failure=null,gate=null,id=0;
  const timers=new Map(),calls=[],errors=[],success=[];
  const queue=createGodotPresentationQueue({scope:()=>owner,invoke:async(channel,payload)=>{
    calls.push({channel,...payload});if(gate)await gate;
    if(failure)throw Error(failure);if(busy)throw Error("Error invoking remote method 'pi-plugin-panel-invoke': Error: GODOT_CANDIDATE_ACTIVE");return {ok:true};
  },onError:(error,request)=>errors.push({error:error.message,...request}),onSuccess:request=>success.push(request),
  setTimer:(callback,delay)=>{const key=++id;timers.set(key,{callback,delay});return key;},clearTimer:key=>timers.delete(key)});
  const tick=async()=>{const next=timers.entries().next().value;if(next){timers.delete(next[0]);next[1].callback();await flush();}};
  return {queue,timers,calls,errors,success,tick,setOwner:value=>owner=value,setBusy:value=>busy=value,setFailure:value=>failure=value,setGate:value=>gate=value};
}

test('candidate refusal remains real until the original host gate accepts a retry',async()=>{
  const f=fixture();f.queue.request('godot.runtimeSurface',{worldId:'world',visible:true});await f.tick();
  assert.equal(f.errors.length,1);assert.equal(f.errors[0].retrying,true);assert.equal(f.success.length,0);
  await f.tick();assert.equal(f.errors.length,1);assert.equal(f.success.length,0);assert.equal(f.timers.size,1);
  f.setBusy(false);await f.tick();assert.equal(f.success.length,1);assert.equal(f.timers.size,0);
  assert(f.calls.every(call=>call.channel==='godot.runtimeSurface'));
});

test('latest surface intent supersedes old retries and any standalone resume',async()=>{
  const f=fixture();f.queue.request('godot.runtimeResume',{worldId:'world'});await f.tick();
  f.queue.request('godot.runtimeSurface',{worldId:'world',visible:true});
  f.queue.request('godot.runtimeSurface',{worldId:'world',visible:false});
  f.queue.request('godot.runtimeResume',{worldId:'world'});f.setBusy(false);await f.tick();
  assert.deepEqual(f.calls.map(call=>[call.channel,call.visible]),[['godot.runtimeResume',undefined],['godot.runtimeSurface',false]]);
  assert.equal(f.success.at(-1).payload.visible,false);assert.equal(f.timers.size,0);
});

test('unknown errors and lookalike codes are surfaced without automatic retry',async()=>{
  for(const error of ['DISK_WRITE_FAILED','WORLD_BUSY','prefix GODOT_CANDIDATE_ACTIVE','GODOT_CANDIDATE_ACTIVE: untrusted extra']){
    const f=fixture();f.setFailure(error);f.queue.request('godot.runtimeSurface',{worldId:'world',visible:true});await f.tick();
    assert.equal(f.errors[0].error,error);assert.equal(f.errors[0].retrying,false);assert.equal(f.timers.size,0);assert.equal(f.success.length,0);
  }
});

test('an unconfirmed host reply never clears the error or retries as candidate busy',async()=>{
  for(const result of [undefined,{}, {ok:false}]){
    let fire;const errors=[],success=[];
    const queue=createGodotPresentationQueue({scope:()=>({worldId:'world',key:'page'}),invoke:async()=>result,
      onError:error=>errors.push(error.message),onSuccess:request=>success.push(request),
      setTimer:callback=>{fire=callback;return 1;},clearTimer:()=>{}});
    queue.request('godot.runtimeSurface',{worldId:'world',visible:true});fire();await flush();
    assert.deepEqual(errors,['GODOT_PRESENTATION_UNCONFIRMED']);assert.equal(success.length,0);queue.dispose();
  }
});

test('world/page/close/preview invalidation drops retries and stale in-flight replies',async()=>{
  for(const next of [null,{worldId:'other',key:'page-1'},{worldId:'world',key:'page-2'}]){
    const f=fixture();f.queue.request('godot.runtimeSurface',{worldId:'world',visible:true});await f.tick();f.setOwner(next);await f.tick();
    assert.equal(f.calls.length,1);assert.equal(f.success.length,0);assert.equal(f.timers.size,0);
  }
  const f=fixture();let release;f.setBusy(false);f.setGate(new Promise(resolve=>release=resolve));f.queue.request('godot.runtimeSurface',{worldId:'world',visible:true});await f.tick();
  f.setOwner({worldId:'other',key:'page-2'});release();await flush();assert.equal(f.success.length,0);assert.equal(f.errors.length,0);
});

test('one physical request and one timer stay bounded, and disposal never closes a candidate',async()=>{
  const f=fixture();let release;f.setGate(new Promise(resolve=>release=resolve));f.queue.request('godot.runtimeSurface',{worldId:'world',visible:true});await f.tick();
  for(let i=0;i<100;i++)f.queue.request('godot.runtimeSurface',{worldId:'world',visible:i%2===0});
  assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);f.queue.dispose();release();await flush();
  assert.equal(f.success.length,0);assert.equal(f.errors.length,0);assert.equal(f.timers.size,0);
  assert.throws(()=>fixture().queue.request('godot.candidateClose',{worldId:'world'}),/INVALID_GODOT_PRESENTATION_REQUEST/);
});
