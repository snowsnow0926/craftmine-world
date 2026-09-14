// Execute the actual retained page functions with deterministic host replies.
// No DOM input, browser, model or native-rendering acceptance is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../plugins/craftmine-world/view.mjs',import.meta.url),'utf8');
const initialize=source.slice(source.indexOf('async function initializeWorld(){'),source.indexOf('void action(initializeWorld);'));
const showSurface=source.slice(source.indexOf('async function showSurface(request) {'),source.indexOf('// The asset panel lives',source.indexOf('async function showSurface(request) {')));

function boot({candidate='preview',active='world-one',failure=null}={}){
 const events=[];let blocking=!!candidate,build=candidate==='applied'?'committed-build':'old-build';
 const context={
  renderWorldLoading:state=>events.push(['loading',state.state]),
  bridge:{invoke:async(channel,payload)=>{
   events.push([channel,payload]);
   if(channel==='world.list')return {activeWorldId:active,worlds:[{id:'world-one'}]};
   if(channel==='godot.candidateClose'){
    assert.equal(payload.worldId,active);
    if(failure)throw Error(failure);
    blocking=false;
    return candidate==='applied'?{status:'applied',record:{id:active,world:{build:{id:build}}}}:{status:'aborted'};
   }
   throw Error('Unexpected route '+channel);
  }},
  openWorldWithLoading:async id=>{
   events.push(['open',id]);
   if(blocking)throw Error('GODOT_CANDIDATE_ACTIVE');
   events.push(['mounted-build',build]);
  },refreshList:async()=>events.push(['refresh-list']),
 };
 vm.runInNewContext(initialize+'\nglobalThis.initializeWorld=initializeWorld;',context);
 return {events,run:()=>context.initializeWorld(),get blocking(){return blocking;}};
}
for(const candidate of ['preview','applied'])test('panel reload reconciles '+candidate+' before guarded world open',async()=>{
 const f=boot({candidate});await f.run();
 assert.equal(f.blocking,false);
 assert.ok(f.events.findIndex(([op])=>op==='godot.candidateClose')<f.events.findIndex(([op])=>op==='open'));
 assert.equal(f.events.find(([op])=>op==='mounted-build')[1],candidate==='applied'?'committed-build':'old-build');
 assert.equal(f.events.filter(([op])=>op==='open').length,1);
});
test('unknown application retains ownership and surfaces its causal failure without opening or re-committing',async()=>{
 const f=boot({candidate:'applied',failure:'GODOT_APPLICATION_COMMIT_UNCERTAIN'});
 await assert.rejects(f.run(),/GODOT_APPLICATION_COMMIT_UNCERTAIN/);
 assert.equal(f.blocking,true);assert.ok(!f.events.some(([op])=>op==='open'||op==='refresh-list'));
});
test('list fallback cannot close a candidate for an unselected world',async()=>{
 const f=boot({candidate:null,active:null});await f.run();
 assert.ok(!f.events.some(([op])=>op==='godot.candidateClose'));assert.equal(f.events.find(([op])=>op==='open')[1],'world-one');
});
for(const lock of ['busy','closing','preview','applicationAttempt'])test('sidebar surface requests preserve tabs and native visibility while '+lock,async()=>{
 const events=[],context={busy:false,closing:false,preview:null,applicationAttempt:null,
  setMode:value=>events.push(['mode',value]),openWorkbench:async()=>events.push(['workbench']),
  document:{querySelector:()=>({})},workbench:{tab:'library'}};
 context[lock]=true;vm.runInNewContext(showSurface+'\nglobalThis.showSurface=showSurface;',context);
 for(const surface of [{kind:'checks'},{kind:'world'},{kind:'workbench',tab:'library'}])await assert.rejects(context.showSurface({surface}),/WORLD_BUSY/);
 assert.deepEqual(events,[]);
 context[lock]=false;assert.equal((await context.showSurface({surface:{kind:'world'}})).shown,'world');assert.deepEqual(events,[['mode',false]]);
});
