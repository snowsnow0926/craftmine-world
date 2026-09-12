import assert from 'node:assert/strict';
import {assertFormalPackageCheck,assertFormalAdoption} from './formal-package-contract.mjs';
export const BUILDING_ZIP_SHA256='351f4774db7a9c9fb8154bd79b96609267b15f7b3de05f52341b3629278766d5';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(value);
const fields=(value,keys)=>assert.ok(object(value)&&Object.keys(value).every(key=>keys.includes(key)),'BOOTSTRAP_FIELDS_DENIED');
/** Closed controller surface: no player prompt, provider, tool call or raw source write. */
export function validateModuleBootstrapCall(method,input={},worldId=null){
 if(['status','godotObserve','godotSnapshot','godotCaptureView','worldNavigationReady','quit'].includes(method)){fields(input,[]);return;}
 if(method==='primaryMode'){assert.deepEqual(input,{payload:{action:'create'}});return;}
 if(method==='playerCreateSession'){
  fields(input,['payload']);fields(input.payload,['worldId','title']);assert.equal(input.payload.worldId,worldId);
  assert.ok(id(worldId)&&typeof input.payload.title==='string'&&input.payload.title.length>0&&input.payload.title.length<=80);return;
 }
 if(method==='worldNavigation'){
  fields(input,['channel','payload']);
  if(['world.list','world.createOptions'].includes(input.channel)){assert.deepEqual(input.payload,{});return;}
  if(input.channel==='world.create'){
   fields(input.payload,['title','baseId','starterId','operationId']);
   assert.equal(input.payload.baseId,'creation-sandbox');assert.equal(input.payload.starterId,'blank');assert.ok(id(input.payload.operationId));
   assert.ok(typeof input.payload.title==='string'&&input.payload.title.length<=80);return;
  }
  if(input.channel==='godot.historyJob'){fields(input.payload,['worldId','jobId']);assert.equal(input.payload.worldId,worldId);assert.match(input.payload.jobId,/^gjob-[a-f0-9]{64}$/);return;}
  assert.fail('BOOTSTRAP_NAVIGATION_DENIED');
 }
 if(method==='worldPanel'){
  fields(input,['channel','payload']);assert.equal(input.payload?.worldId,worldId);assert.ok(id(worldId));
  if(input.channel==='godot.runtimeSave'){assert.deepEqual(input.payload,{worldId,freeze:true});return;}
  if(['godot.candidatePreview','godot.candidateApply'].includes(input.channel)){fields(input.payload,['worldId','candidateId']);assert.ok(id(input.payload.candidateId));return;}
  assert.equal(input.channel,'package.request','BOOTSTRAP_PANEL_DENIED');
  fields(input.payload,['worldId','method','params']);const args=input.payload.params;assert.equal(args?.worldId,worldId);
  if(input.payload.method==='importSource'){fields(args,['worldId','operationId']);assert.ok(id(args.operationId));return;}
  if(input.payload.method==='sourceList'){assert.deepEqual(args,{worldId});return;}
  if(input.payload.method==='sourceJob'){fields(args,['worldId','jobId']);assert.match(args.jobId,/^gjob-[a-f0-9]{64}$/);return;}
  assert.fail('BOOTSTRAP_PACKAGE_METHOD_DENIED');
 }
 assert.fail('BOOTSTRAP_METHOD_DENIED');
}
export function assertModuleBootstrapPackages(report){
 assert.equal(report.format,'craftmine.module-player-bootstrap/1');
 assert.equal(report.modelRequestsStarted,0);assert.equal(report.directSourceEditsByHarness,0);assert.equal(report.syntheticCaptures,0);
 assert.equal(report.packages.length,2);const seen=new Set(),operations=new Set(),slots=new Set(),jobs=new Set(),builds=new Set();
 for(const entry of report.packages){
  assert.equal(entry.archiveSha256,BUILDING_ZIP_SHA256);assert.equal(entry.kind,'building');
  assert.ok(['A','B'].includes(entry.slot)&&!slots.has(entry.slot));slots.add(entry.slot);assert.equal(entry.imported.instanceIds.length,1);
  assert.ok(!operations.has(entry.imported.operationId));operations.add(entry.imported.operationId);
  const instance=entry.imported.instanceIds[0],entityId=instance+'-e0';assert.ok(id(instance)&&!seen.has(entityId));seen.add(entityId);
  assertFormalPackageCheck(report.worldId,entry.imported,entry.checked);
  assertFormalAdoption(report.worldId,entry.checked,entry.preview,entry.applied,entry.observed);
  assert.ok(!jobs.has(entry.checked.jobId)&&!builds.has(entry.checked.buildId));jobs.add(entry.checked.jobId);builds.add(entry.checked.buildId);
  assert.ok(entry.sources.items.some(item=>item.entityId===entityId));
 }
 assert.ok(report.finalSources.items.every(item=>!item.entityId||id(item.entityId)));
 for(const entityId of seen)assert.equal(report.finalSources.items.filter(item=>item.entityId===entityId).length,1);
 assert.equal(report.session?.format,'craftmine.ordinary-player-session/1');assert.equal(report.session.creation,'ordinary-sessionCreate');
 assert.equal(report.session.modelRequestsStarted,0);assert.equal(report.session.worldId,report.worldId);assert.ok(id(report.sessionId));assert.equal(report.sessionId,report.session.sessionId);
 for(const call of report.calls)validateModuleBootstrapCall(call.method,call.fields,call.worldId);
 return [...seen];
}
