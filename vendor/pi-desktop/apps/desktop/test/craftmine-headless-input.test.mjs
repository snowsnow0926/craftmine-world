import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
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

function worldBusyPolicy(){
  const source=fs.readFileSync(new URL('../electron/main/index.ts',import.meta.url),'utf8');
  const idle=source.match(/function assertDirectLibraryIdle\(\) \{[\s\S]*?\n\}/)?.[0];
  const gameplay=source.match(/function isHeadlessGameplayWorldBusy\(\) \{[\s\S]*?\n\}/)?.[0];
  assert(idle&&gameplay);assert(source.includes('unavailable:isHeadlessGameplayWorldBusy'));
  const state={quitting:false,craftmineQuitPreparation:null,craftmineQuitPrepared:false,profileRestore:null,
    godotCopies:{busy:false},godotExportBusy:false,creationEditStarting:false,godotInitializer:{busy:false},
    godotRestores:{busy:false},worldRemoval:{busy:false},groundMaintenance:{busy:false},collisionMaintenance:{busy:false},
    directLibrary:{isBusy:()=>false},godotCandidates:{blocking:false},godotWorld:{candidateInstance:null},
    activeTurns:new Map(),turnFinalizations:new Map()};
  const functions=vm.runInNewContext(idle+'\n'+gameplay+'\n({idle:assertDirectLibraryIdle,busy:isHeadlessGameplayWorldBusy})',state);
  return {state,...functions};
}

test('actual Main policy permits private gameplay during a model turn while edit ownership remains blocked',async()=>{
  const policy=worldBusyPolicy();policy.state.activeTurns.set('session','thinking-turn');policy.state.turnFinalizations.set('session',Promise.resolve());
  assert.throws(policy.idle,/WORLD_BUSY/);assert.equal(policy.busy(),false);
  const f=fixture({unavailable:policy.busy});const result=await f.control.handle(envelope({keys:['KeyW'],frames:15,settleFrames:0}));
  assert.equal(result.status,'completed');assert.equal(result.release.released,true);
  assert.equal(f.calls.filter(call=>call.events?.[0]?.down===true).length,1);
});

test('actual Main policy rejects every world replacement, candidate and maintenance conflict before dispatch',async()=>{
  const transitions=[s=>s.quitting=true,s=>s.craftmineQuitPreparation={},s=>s.craftmineQuitPrepared=true,s=>s.profileRestore={},
    s=>s.godotCopies.busy=true,s=>s.godotExportBusy=true,s=>s.creationEditStarting=true,s=>s.godotInitializer.busy=true,
    s=>s.godotRestores.busy=true,s=>s.worldRemoval.busy=true,s=>s.groundMaintenance.busy=true,s=>s.collisionMaintenance.busy=true,
    s=>s.directLibrary.isBusy=()=>true,s=>s.godotCandidates.blocking=true,s=>s.godotWorld.candidateInstance={worldId:'candidate'}];
  for(const transition of transitions){
    const policy=worldBusyPolicy();transition(policy.state);const f=fixture({unavailable:policy.busy});
    await assert.rejects(f.control.handle(envelope()),/HEADLESS_INPUT_WORLD_BUSY/);assert.equal(f.calls.length,0);
  }
});

test('candidate application racing a held segment fails with partial evidence and releases original keys',async()=>{
  const policy=worldBusyPolicy();let released=0;
  const f=fixture({unavailable:policy.busy,
    wait:async()=>{policy.state.godotCandidates.blocking=true;return{physicsFrames:15};},
    dispatch:async(id,events)=>{assert.deepEqual(id,identity);if(events.every(event=>event.down===false))released++;return{};}});
  const result=await f.control.handle(envelope({keys:['KeyW'],frames:15,settleFrames:0}));
  assert.equal(result.status,'failed');assert.match(result.error,/HEADLESS_INPUT_WORLD_BUSY/);
  assert(result.partialEvidence.before);assert.equal(result.partialEvidence.release.released,true);
  assert.equal(result.partialEvidence.heldUnreleased,false);assert.equal(released,1);assert.equal(f.control.busy,false);
});

test('world transition or owner change during observation rejects before key-down',async()=>{
  for(const kind of ['busy','owner']){
    let busy=false,visible=false,downs=0;
    const f=fixture({unavailable:()=>busy,owner:()=>({visible,focused:false,focusable:false,offscreen:true}),
      snapshot:async()=>{if(kind==='busy')busy=true;else visible=true;return{};},
      dispatch:async(_id,events)=>{downs+=events.filter(event=>event.down).length;return{};}});
    const result=await f.control.handle(envelope());assert.equal(result.status,'failed');assert.equal(downs,0);
    assert.match(result.error,kind==='busy'?/WORLD_BUSY/:/OWNER_UNSAFE/);assert.equal(f.control.busy,false);
  }
});

test('explicit cancel and drain still release held keys after a world conflict begins',async()=>{
  let finish,busy=false;const f=fixture({unavailable:()=>busy,wait:()=>new Promise(resolve=>finish=resolve)});
  const running=f.control.handle(envelope());await tick();busy=true;
  const cancelled=await f.control.handle(envelope(undefined,'cancelInputs'));assert.equal(cancelled.released,true);
  finish({physicsFrames:30});const result=await running;assert.equal(result.status,'failed');
  assert.equal(result.partialEvidence.heldUnreleased,false);await f.control.drain();assert.equal(f.control.busy,false);
});
