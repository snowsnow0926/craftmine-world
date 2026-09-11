import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCreationTargetService} from '../electron/main/creation-target-service.ts';
import {recentCreationResults} from '../electron/main/creation-recent-results.ts';

const session={projectId:'project-a',sessionId:'session-a'};
const entity=id=>({id,kind:'tree',position:[2,0,-3],scale:[1,1,1],color:'#84a866',visible:true,solid:true});
const operation=(operationId,ids,worldId='world-a')=>({operationId,receipt:{operationId,worldId,createdIds:ids,affectedIds:ids},inverse:{before:[],after:ids.map(entity)}});
function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'creation-recent-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const state={worldId:'world-a',buildId:'build-a',instanceId:'instance-a',sourceRevision:3,manifestHash:'a'.repeat(64),entities:[entity('tree-a'),{...entity('tree-b'),position:[5,0,-3]}],target:{surface:'none',entityId:null,position:null,normal:null,revision:2},journal:{format:'craftmine.creation-operations/1',operations:[operation('place-a',['tree-a']),operation('place-b',['tree-b'])]}};
  const deps={directory,selection:async()=>state.worldId,instance:()=>({worldId:state.worldId,buildId:state.buildId,instanceId:state.instanceId}),descriptor:async()=>({...state,baseId:'creation-sandbox'}),sample:async()=>({...state,baseId:'creation-sandbox',sampledAt:new Date().toISOString(),payload:{player:{position:[0,1,0]},creation:{target:structuredClone(state.target),entities:structuredClone(state.entities)}}}),journal:async()=>structuredClone(state.journal)};
  return {state,deps,service:createCreationTargetService(deps)};
}

test('formal adopted results remain selectable without a ray hit; the chosen ID and source bind to the turn',async t=>{
  const {service}=fixture(t),initial=await service.capture(11,session);
  assert.equal(initial.target,null);assert.equal(initial.worldId,'world-a');assert.equal(initial.recent.length,2);
  const selected=await service.capture(11,session,{worldId:'world-a',entityId:'tree-a'});
  assert.equal(selected.target.entityId,'tree-a');assert.equal(selected.source,'recent');
  const capture=await service.validate(11,{creationTarget:{captureId:selected.captureId}},session);
  assert.equal(capture.target.entityId,'tree-a');assert.equal(capture.source,'recent');
  await service.bind(11,capture,{...session,turnId:'turn-a'},'world-a','把这个对象放大到2倍');
  assert.equal(service.bound({...session,turnId:'turn-a'},'world-a').source,'recent');
});
test('explicit selection survives host restart and moving aim, but switching back to ray clears it',async t=>{
  const {service,state,deps}=fixture(t);await service.capture(11,session,{worldId:'world-a',entityId:'tree-a'});
  state.target={surface:'entity',entityId:'tree-b',position:[5,0,-3],normal:[0,1,0],revision:2};
  const reopened=createCreationTargetService(deps);assert.equal((await reopened.capture(12,session)).target.entityId,'tree-a');
  const ray=await reopened.capture(12,session,null);assert.equal(ray.target.entityId,'tree-b');assert.equal(ray.source,'ray');
  assert.equal((await createCreationTargetService(deps).capture(13,session)).source,'ray');
});
test('session and world changes cannot transfer the selected ID, including a copied journal',async t=>{
  const {service,state}=fixture(t);await service.capture(11,session,{worldId:'world-a',entityId:'tree-a'});
  assert.equal((await service.capture(11,{...session,sessionId:'session-b'})).source,'ray');
  state.worldId='world-b';assert.equal((await service.capture(11,session)).source,'ray');
  assert.deepEqual((await service.capture(11,session)).recent,[]);
  await assert.rejects(service.capture(11,session,{worldId:'world-a',entityId:'tree-a'}),/WORLD_CHANGED/);
  await assert.rejects(service.capture(11,session,{worldId:'world-b',entityId:'tree-a'}),/RECENT_UNAVAILABLE/);
});
test('the first materialized conversation inherits only its own explicitly chosen draft result',async t=>{
  const {service,deps}=fixture(t),draft={...session,sessionId:null};
  const display=await service.capture(11,draft,{worldId:'world-a',entityId:'tree-a'});
  await service.validate(11,{creationTarget:{captureId:display.captureId}},session);
  assert.equal((await createCreationTargetService(deps).capture(12,session)).target.entityId,'tree-a');
  assert.equal((await createCreationTargetService(deps).capture(13,{...session,sessionId:'another'})).source,'ray');
});
test('deleted, hidden, duplicate-ID and non-adopted objects cannot silently replace the chosen result',async t=>{
  const {service,state}=fixture(t);await service.capture(11,session,{worldId:'world-a',entityId:'tree-a'});
  state.entities[0].visible=false;
  let display=await service.capture(11,session);assert.equal(display.source,'recent');assert.equal(display.target,null);assert.equal(display.reason,'CREATION_RECENT_HIDDEN');
  await assert.rejects(service.capture(11,session,{worldId:'world-a',entityId:'tree-a'}),/RECENT_HIDDEN/);
  state.entities.shift();display=await service.capture(11,session);assert.equal(display.reason,'CREATION_RECENT_REMOVED');
  state.entities.push(entity('draft-only'));await assert.rejects(service.capture(11,session,{worldId:'world-a',entityId:'draft-only'}),/RECENT_UNAVAILABLE/);
  state.entities.push(entity('tree-a'),entity('tree-a'));assert.equal((await service.capture(11,session)).target,null);
});
test('formal changes during journal read and superseded captures cannot commit a stale selection',async t=>{
  const {state,deps,service}=fixture(t),read=deps.journal;
  deps.journal=async()=>{state.sourceRevision++;return read();};
  await assert.rejects(service.capture(11,session,{worldId:'world-a',entityId:'tree-a'}),/TARGET_STALE/);
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});let first=true;
  deps.journal=async()=>{if(first){first=false;entered();await new Promise(resolve=>{release=resolve;});}return read();};
  const old=service.capture(11,session,{worldId:'world-a',entityId:'tree-a'});await waiting;
  await service.capture(11,session,{worldId:'world-a',entityId:'tree-b'});release();await assert.rejects(old,/CAPTURE_SUPERSEDED/);
  assert.equal((await createCreationTargetService(deps).capture(12,session)).target.entityId,'tree-b');
});
test('recent history deduplicates by identity, bounds results, and rejects malformed formal IDs',()=>{
  const entities=Array.from({length:40},(_,i)=>entity('tree-'+i)),journal={format:'craftmine.creation-operations/1',operations:entities.map((item,i)=>operation('op-'+i,[item.id]))};
  journal.operations.push(operation('modify-39',['tree-39']));const result=recentCreationResults('world-a',journal,entities);
  assert.equal(result.length,32);assert.equal(result[0].operationId,'modify-39');assert.equal(new Set(result.map(item=>item.entityId)).size,32);
  journal.operations.push(operation('invalid',['../escape']));assert.throws(()=>recentCreationResults('world-a',journal,entities),/JOURNAL_INVALID/);
});
