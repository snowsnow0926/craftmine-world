// Offline lifecycle/validation tests. These are not native gameplay evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {validateGameplayPlan} from '../scripts/codex-gameplay.mjs';
const root=path.resolve('test-results');await fs.mkdir(root,{recursive:true});
const out=await fs.mkdtemp(path.join(root,'gameplay-unit-'));
const require=createRequire(path.resolve('vendor/pi-desktop/packages/agent-runtime/package.json'));
await require('esbuild').build({entryPoints:['scripts/lib/codex-gameplay-controller.ts'],outfile:path.join(out,'controller.mjs'),bundle:true,platform:'node',format:'esm',target:'node22'});
const {createGameplayController,validateInputSegment}=await import(pathToFileURL(path.join(out,'controller.mjs')));
test.after(async()=>{assert(out.startsWith(root+path.sep));await fs.rm(out,{recursive:true,force:true});});
const id={worldId:'world',buildId:'build',instanceId:'instance'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){
  const calls=[];
  const access={instance:()=>id,dispatch:async(identity,events)=>{calls.push({identity,events});return {held:{keys:events.filter(e=>e.down).map(e=>e.code)}};},
    wait:async frames=>{calls.push({wait:frames});return {fixture:true};},snapshot:async()=>({fixture:true}),observe:async()=>({fixture:true}),
    capture:async()=>({fixture:true}),diagnostics:async()=>({views:[{runtime:{guard:{pointerLock:0,focus:0}}}]}),hold:async()=>()=>calls.push({unhold:true}),...overrides};
  return {calls,access,controller:createGameplayController(access)};
}
test('finite segment schema refuses code, unknown keys, state mutation and invalid timings',()=>{
  validateInputSegment({keys:['KeyF','Enter','ArrowUp','ControlLeft','F1','F4','F12'],frames:600,settleFrames:600});
  for(const code of ['F0','F13','AltF4','MetaLeft'])assert.throws(()=>validateInputSegment({keys:[code],frames:1}));
  for(const input of [{frames:0},{frames:601},{frames:1,js:'alert(1)'},{frames:1,position:[0,0,0]},{frames:1,keys:['KeyW','KeyW']},{frames:1,keys:['bad_code']},{frames:1,buttons:['fire']},{frames:1,motion:{x:NaN,y:0}}])assert.throws(()=>validateInputSegment(input));
  assert.throws(()=>validateGameplayPlan({format:'craftmine.gameplay-plan/1',segments:[{frames:1}],worldId:'other'}));
});
test('normal event down/up surrounds the native wait and never asserts semantic gameplay success',async()=>{
  const f=fixture();const result=await f.controller.segment(id,{keys:['KeyW','KeyF'],frames:30,settleFrames:2,capture:false});
  assert.equal(result.status,'completed');assert.equal(result.semanticSuccess,null);
  assert.equal(f.calls[0].events[0].down,true);assert.equal(f.calls[1].wait,30);assert.equal(f.calls[2].events[0].down,false);
  assert.deepEqual(f.calls[2].identity,id);assert.equal(result.release.released,true);
});
test('foreign/stale identity and concurrent segments never dispatch inputs',async()=>{
  let done;const f=fixture({wait:()=>new Promise(resolve=>{done=resolve;})});
  await assert.rejects(f.controller.segment({...id,instanceId:'old'},{keys:['KeyW'],frames:1}),/IDENTITY/);assert.equal(f.calls.length,0);
  const pending=f.controller.segment(id,{keys:['KeyW'],frames:1,settleFrames:0,capture:false});await tick();
  await assert.rejects(f.controller.segment(id,{keys:['KeyF'],frames:1}),/BUSY/);
  await assert.rejects(f.controller.cancel({...id,worldId:'other'}),/IDENTITY/);assert.equal(f.calls.length,1);
  await f.controller.cancel(id);assert.equal(f.calls.at(-1).events[0].down,false);done({});assert.equal((await pending).status,'cancelled');
});
test('cancel before the first down prevents all later downs',async()=>{
  let before;let first=true;
  const f=fixture({snapshot:()=>first?(first=false,new Promise(resolve=>{before=resolve;})):Promise.resolve({})});
  const pending=f.controller.segment(id,{keys:['KeyW'],frames:1,settleFrames:0,capture:false});await tick();await f.controller.cancel(id);before({});
  assert.equal((await pending).status,'cancelled');assert(!f.calls.some(call=>call.events?.some(e=>e.down)));
});
test('lost down reply still releases; failed release remains recoverable and blocks another segment',async()=>{
  let failUp=true;const events=[];
  const f=fixture({dispatch:async(_id,values)=>{events.push(values);if(values[0].down)throw Error('LOST_DOWN_REPLY');if(failUp)throw Error('RELEASE_UNCONFIRMED');return {};}});
  await assert.rejects(f.controller.segment(id,{keys:['KeyW'],frames:1}),/RELEASE_UNCONFIRMED/);
  assert.equal(events.length,2);assert.equal(events[1][0].down,false);assert.equal(f.controller.busy,true);
  await assert.rejects(f.controller.segment(id,{keys:['KeyF'],frames:1}),/BUSY/);
  failUp=false;await f.controller.drain();assert.equal(f.controller.busy,false);assert.equal(events.at(-1)[0].down,false);
});
test('a guarded focus/pointer-lock attempt is reported as blocked, never semantic success',async()=>{
  let samples=0;const f=fixture({diagnostics:async()=>({views:[{runtime:{guard:{focus:0,pointerLock:samples++}}}]})});
  const result=await f.controller.segment(id,{frames:1,capture:false});assert.equal(result.status,'policy-blocked');assert.equal(result.semanticSuccess,null);
});
