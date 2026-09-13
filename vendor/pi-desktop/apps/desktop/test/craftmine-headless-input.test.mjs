import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
register(pathToFileURL(fileURLToPath(new URL('./helpers/ts-import-hooks.mjs',import.meta.url))));
const {createHeadlessInputControl,validateHeadlessInputEnvelope}=await import('../electron/main/craftmine-headless-input.ts');
const identity={worldId:'world-a',buildId:'build-a',instanceId:'instance-a'};
const envelope=(segment={keys:['KeyW','ArrowDown'],frames:30,settleFrames:0},method='inputSegment')=>({type:'craftmine-headless',id:'request-a',method,payload:{identity,...(method==='inputSegment'?{segment}:{})}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){
  const calls=[];let samples=0;
  const access={enabled:()=>true,owner:()=>({visible:false,focused:false,focusable:false,offscreen:true}),unavailable:()=>false,instance:()=>identity,
    dispatch:async(id,events)=>{calls.push({identity:id,events});return {held:{keys:events.filter(event=>event.down).map(event=>event.code)}};},wait:async frames=>{calls.push({wait:frames});return {physicsFrames:frames};},snapshot:async()=>({sample:++samples}),observe:async()=>({identity}),capture:async()=>({fixture:true,pngBase64:'Zml4dHVyZQ=='}),diagnostics:async()=>({views:[{runtime:{guard:{focus:0,pointerLock:0}}}]}),hold:async()=>()=>calls.push({unhold:true}),...overrides};
  return {calls,control:createHeadlessInputControl(access)};
}
test('private envelope validates whole identity and finite key/frames without arbitrary code or source fields',()=>{
  assert.equal(validateHeadlessInputEnvelope(envelope(),true).segment.frames,30);
  assert.throws(()=>validateHeadlessInputEnvelope(envelope(),false),/PRIVATE_ONLY/);
  for(const request of [{...envelope(),script:'evil()'},{...envelope(),payload:{identity,segment:{frames:1,position:[0,0,0]}}},{...envelope(),payload:{identity:{...identity,token:'x'},segment:{frames:1}}},envelope({keys:['MetaLeft'],frames:1}),envelope({frames:601})])assert.throws(()=>validateHeadlessInputEnvelope(request,true));
});
test('visible/focused/non-offscreen owners and busy authoring cannot dispatch even valid game keys',async()=>{
  for(const owner of [{visible:true,focused:false,focusable:false,offscreen:true},{visible:false,focused:true,focusable:false,offscreen:true},{visible:false,focused:false,focusable:false,offscreen:false}]){const f=fixture({owner:()=>owner});await assert.rejects(f.control.handle(envelope()),/OWNER_UNSAFE/);assert.equal(f.calls.length,0);}
  const busy=fixture({unavailable:()=>true});await assert.rejects(busy.control.handle(envelope()),/WORLD_BUSY/);assert.equal(busy.calls.length,0);
});
test('same existing event controller records before/during/after, releases keys and never declares semantic success',async()=>{
  const f=fixture(),result=await f.control.handle(envelope());assert.equal(result.status,'completed');assert.equal(result.semanticSuccess,null);
  assert(result.before.frame&&result.during.frame&&result.after.frame);assert(result.before.snapshot.sample<result.during.snapshot.sample&&result.during.snapshot.sample<result.after.snapshot.sample);
  assert.equal(f.calls[0].events[0].down,true);assert.equal(f.calls[1].wait,30);assert.equal(f.calls[2].events[0].down,false);assert.equal(result.release.released,true);assert.equal(f.control.busy,false);
});
test('runtime/check failure preserves partial evidence and performs key releases before reporting failure',async()=>{
  const f=fixture({wait:async()=>{throw Error('ENGINE_CHECK_FAILED');}}),result=await f.control.handle(envelope());
  assert.equal(result.status,'failed');assert.match(result.error,/ENGINE_CHECK_FAILED/);assert(result.partialEvidence.before.frame);assert.equal(result.partialEvidence.release.released,true);assert.equal(result.partialEvidence.heldUnreleased,false);assert.equal(f.calls.at(-2).events[0].down,false);
});
test('cancellation dispatches releases outside the outstanding wait; drain finishes before departure',async()=>{
  let finish;const f=fixture({wait:()=>new Promise(resolve=>finish=resolve)});const running=f.control.handle(envelope());await tick();
  const cancelled=await f.control.handle(envelope(undefined,'cancelInputs'));assert.equal(cancelled.released,true);assert.equal(f.calls.at(-1).events[0].down,false);
  finish({physicsFrames:30});assert.equal((await running).status,'cancelled');await f.control.drain();assert.equal(f.control.busy,false);
});
test('lost release remains a blocking failure until an explicit successful drain',async()=>{
  let refuse=true;const f=fixture({dispatch:async(_id,events)=>{if(!events[0].down&&refuse)throw Error('RELEASE_FAILED');return {};}});
  const result=await f.control.handle(envelope());assert.equal(result.status,'failed');assert.equal(result.partialEvidence.heldUnreleased,true);assert.equal(f.control.busy,true);
  await assert.rejects(f.control.handle(envelope()),/GAMEPLAY_BUSY/);refuse=false;await f.control.drain();assert.equal(f.control.busy,false);
});
