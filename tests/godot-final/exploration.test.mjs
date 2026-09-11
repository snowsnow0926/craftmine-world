import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createGodotExploration} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-godot-exploration.ts';

// Callback contracts only. PNG header fixtures are not visual/gameplay evidence.
const identity={worldId:'world',buildId:'build',instanceId:'instance'};
const step=(op,args={},capture=false)=>({op,args,...(capture?{capture}: {})});
const request=(steps)=>({...identity,steps});
function fixture(baseId='creation-sandbox'){
 let current={...identity},size=[1280,720];const calls=[];
 const observation=()=>({format:'craftmine.godot-observation/1',...current,baseId,payload:{logicalViewportSize:size}});
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(1280,16);png.writeUInt32BE(720,20);
 const access={observe:async()=>{calls.push(['observe']);return observation();},
  action:async(op,args)=>{calls.push(['action',op,args]);return {result:{source:'adapter'}};},
  capture:async(width,height)=>{calls.push(['capture',width,height]);return {width,height,pngBase64:png.toString('base64'),viewportObservation:observation()};}};
 return {access,calls,png,observation,setIdentity:value=>{current={...current,...value};},setSize:value=>{size=value;}};
}

test('both bases execute the exact limited adapter parameters and bind capture identity',async()=>{
 for(const base of ['creation-sandbox','first-person']){
  const f=fixture(base),run=createGodotExploration(f.access);
  const result=await run(request([step('look',{yaw:0.4,pitch:-0.2},true),step('walk',{forward:1,right:0,frames:30}),step('wait',{frames:2}),step('interact')]));
  assert.deepEqual(f.calls.filter(call=>call[0]==='action').map(call=>call.slice(1)),[
   ['look',{yaw:0.4,pitch:-0.2}],['walk',{forward:1,right:0,frames:30}],['wait',{frames:2}],['interact',{}]]);
  assert.equal(result.actionPhysicsTicks,35);assert.equal(result.actions.length,4);
  for(const action of result.actions){assert.equal(action.before.instanceId,'instance');assert.equal(action.observation.buildId,'build');}
  assert.deepEqual(result.captures[0].identity,identity);
  assert.equal(result.captures[0].image.sha256,createHash('sha256').update(f.png).digest('hex'));
  assert.equal(result.captures[0].source,'godot-headless-capture');
 }
});

test('the entire request is validated before any runtime access',async()=>{
 const bad=[request([]),request(Array.from({length:17},()=>step('interact'))),
  request([step('wait',{frames:121})]),request([step('wait',{frames:0})]),request([step('wait',{frames:1.5})]),
  request([step('look',{yaw:NaN,pitch:0})]),request([step('look',{yaw:0,pitch:1.56})]),request([step('look',{yaw:4,pitch:0})]),
  request([step('walk',{forward:Infinity,right:0,frames:1})]),request([step('walk',{forward:2,right:0,frames:1})]),
  request([step('walk',{forward:1,right:0,frames:1,position:[1,2,3]})]),
  request([step('interact',{health:100})]),request([step('resume')]),request([step('restore-state')]),request([step('set-time',{hours:12})]),
  request([step('wait',{frames:1}),step('script',{code:'anything'})]),
  request(Array.from({length:5},()=>step('walk',{forward:1,right:0,frames:120}))),
  request(Array.from({length:5},()=>step('interact',{},true))),
  {...request([step('interact')]),worldId:''},{...request([step('interact')]),arbitrary:'extra'},
  request([{op:'interact',args:{},capture:'yes'}])];
 for(const input of bad){const f=fixture();await assert.rejects(createGodotExploration(f.access)(input),/GODOT_EXPLORATION_/);assert.deepEqual(f.calls,[]);}
});

test('binds caller world/build/instance before action and checks after every action',async()=>{
 for(const field of Object.keys(identity)){
  const f=fixture();f.setIdentity({[field]:'different'});
  await assert.rejects(createGodotExploration(f.access)(request([step('interact')])),/IDENTITY_CHANGED/);
  assert.equal(f.calls.filter(call=>call[0]==='action').length,0);
  const g=fixture();g.access.action=async(op,args)=>{g.calls.push(['action',op,args]);g.setIdentity({[field]:'different'});return {};};
  await assert.rejects(createGodotExploration(g.access)(request([step('interact'),step('interact')])),/IDENTITY_CHANGED/);
  assert.equal(g.calls.filter(call=>call[0]==='action').length,1);
 }
 const f=fixture('top-down');await assert.rejects(createGodotExploration(f.access)(request([step('interact')])),/UNSUPPORTED_OBSERVATION/);
});

test('detects a switch between actions before dispatching the next action',async()=>{
 const f=fixture();let reads=0;f.access.observe=async()=>{if(++reads===4)f.setIdentity({buildId:'new-build'});return f.observation();};
 await assert.rejects(createGodotExploration(f.access)(request([step('interact'),step('interact')])),/IDENTITY_CHANGED/);
 assert.equal(f.calls.filter(call=>call[0]==='action').length,1);
});

test('capture requires its own matching observation, actual dimensions and PNG header',async()=>{
 for(const mutate of [image=>({...image,viewportObservation:undefined}),image=>({...image,viewportObservation:{...image.viewportObservation,instanceId:'other'}}),
  image=>({...image,width:800}),image=>({...image,pngBase64:'not-png'}),
  image=>({...image,viewportObservation:{...image.viewportObservation,payload:{viewportSize:[800,600]}}})]){
  const f=fixture(),capture=f.access.capture;f.access.capture=async(w,h)=>mutate(await capture(w,h));
  await assert.rejects(createGodotExploration(f.access)(request([step('interact',{},true)])),/GODOT_EXPLORATION_/);
 }
 const f=fixture(),capture=f.access.capture;f.access.capture=async(w,h)=>{const image=await capture(w,h);f.setIdentity({instanceId:'new-instance'});return image;};
 await assert.rejects(createGodotExploration(f.access)(request([step('interact',{},true)])),/IDENTITY_CHANGED/);
});

test('busy lock rejects overlapping control and releases on failed action',async()=>{
 const f=fixture();let finish;f.access.action=()=>new Promise(resolve=>{finish=resolve;});
 const run=createGodotExploration(f.access),pending=run(request([step('interact')]));
 while(!finish)await Promise.resolve();
 await assert.rejects(run(request([step('interact')])),/BUSY/);
 finish({error:'adapter refused'});await assert.rejects(pending,/ACTION_FAILED/);
 f.access.action=async()=>({result:{}});assert.equal((await run(request([step('interact')]))).actions.length,1);
});

test('caller mutation cannot change a validated sequence while observations await',async()=>{
 const f=fixture(),input=request([step('walk',{forward:1,right:0,frames:1})]);let finish;
 f.access.observe=()=>new Promise(resolve=>{finish=()=>resolve(f.observation());});
 const pending=createGodotExploration(f.access)(input);
 input.steps[0].args.frames=9999;input.steps[0].op='restore-state';
 f.access.observe=async()=>f.observation();finish();
 const result=await pending;assert.equal(result.actions[0].op,'walk');assert.equal(result.actions[0].args.frames,1);
});

test('exploration is installed only after existing protected profile validation',()=>{
 const source=readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless.ts',import.meta.url),'utf8');
 assert.ok(source.indexOf('if (!profile) return;')<source.indexOf('const godotExplore ='));
 assert.match(source,/case "godotExplore"[\s\S]*"id,method,payload,type"[\s\S]*godotExplore\(request.payload\)/);
 const manifest=JSON.parse(readFileSync(new URL('../../plugins/craftmine-world/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.contributes.agentTools.some(tool=>tool.name.includes('explor')),false);
});
