import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildBuiltinSourceLibrary} from '../desktop/build-builtin-source-library.mjs';
const require=createRequire(import.meta.url);
const {createSourceLibraryService}=require('../plugins/craftmine-world/source-library-service.cjs');
const {compositionCatalog,validateCompositionRequest,assessRequirements}=require('../plugins/craftmine-world/world-composition.cjs');
const request=(extra={})=>({recipeId:'collect-unlock-flight',recipeVersion:1,choices:{scenery:'city-street',companion:true,weather:'rain',collectionCount:3},wish:'整座城市需要保留，不能缩成一个地标。',...extra});
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'world-composition-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const catalog=buildBuiltinSourceLibrary({output:path.join(root,'library')}),calls=[],state={revision:7,manifestHash:'a'.repeat(64),tamper:false,files:[]};
  const context={projectId:'p',sessionId:'s',turnId:'t'};
  const call=async(method,args)=>{
    calls.push({method,args});
    if(method==='world.read')return {id:args.id,runtimeKind:'godot'};
    if(method==='godotProject.sourceContext')return {context};
    if(method==='godotProject.index'){assert(args.limit<=32,'Core index accepts at most 32 rows');return {worldId:args.worldId,baseId:'creation-sandbox',engineVersion:'4.7.2-stable',revision:state.revision,manifestHash:state.manifestHash,files:state.files.slice(args.offset,args.offset+2),nextOffset:args.offset+2<state.files.length?args.offset+2:null};}
    const entry=catalog.entries.find(row=>row.assetId===args.assetId&&row.version===args.version);assert(entry,'exact existing entry required');
    const file={path:entry.file,sha256:state.tamper?'f'.repeat(64):entry.sha256,bytes:entry.bytes,mediaType:'application/x-godot-package'};
    if(method==='asset.read')return {version_:{assetId:entry.assetId,version:entry.version,contentHash:'c'.repeat(64),mediaKind:'package',kind:entry.kind,displayName:entry.label,source:entry.source,files:[file]}};
    if(method==='asset.bodyPath')return {...file,blobPath:path.join(root,'library',entry.file)};
    throw Error('Unexpected mutation or call: '+method);
  };
  const service=createSourceLibraryService({call,ensureBuiltin:async()=>{if(state.changeSourceOnBuiltin)state.revision++;},directory:path.join(root,'proposals'),installSource:async()=>{throw Error('Must not install');}});
  return {service,state,calls,catalog,root,context};
}
test('recipes are explicit versioned choices, never keyword classification or mutable catalog references',()=>{
  const catalog=compositionCatalog();assert.equal(catalog.recipes.length,3);assert.equal(catalog.applied,false);
  catalog.recipes[0].version=99;assert.equal(compositionCatalog().recipes[0].version,1);
  assert.throws(()=>validateCompositionRequest({...request(),recipeVersion:2}),/VERSION_REQUIRED/);
  assert.throws(()=>validateCompositionRequest({...request(),worldId:'other'}),/INVALID_PARAMS/);
  assert.throws(()=>validateCompositionRequest({...request(),choices:{...request().choices,collectionCount:0}}),/COUNT_INVALID/);
  assert.throws(()=>validateCompositionRequest({...request(),choices:{...request().choices,fly:true}}),/INVALID_PARAMS/);
  assert.equal(validateCompositionRequest(request()).wish,request().wish);
});
test('real shipped ZIPs resolve exact roots, versions and permissions while custom gameplay stays outstanding',async t=>{
  const f=await fixture(t),plan=await f.service.tool({mode:'compose',request:request()},f.context,'world-test','call-1');
  assert.equal(plan.components.length,4);assert.equal(plan.applied,false);assert.equal(plan.compatibility,'not-runtime-verified');
  assert.equal(plan.components.some(row=>row.archiveRef.assetId.startsWith('cw.model.')),false);
  for(const component of plan.components){const entry=f.catalog.entries.find(row=>row.assetId===component.archiveRef.assetId);assert.equal(component.archiveRef.version,entry.version);assert.equal(component.archiveSha256,entry.sha256);assert.equal(component.rootContentHash,entry.rootContentHash);assert.notEqual(component.archiveRef.contentHash,component.rootContentHash);}
  assert.deepEqual(plan.missingLogic.map(row=>row.id),['collection-objective','flight-unlock']);assert.equal(plan.missingLogic[0].count,3);
  assert(plan.checks.find(row=>row.id==='physical-runway').detail.includes('2400 m'));assert.equal(plan.request.wish,request().wish);
  assert.equal(JSON.stringify(plan).includes(f.root),false);assert.equal(JSON.stringify(plan).includes('archiveBase64'),false);
  assert.equal(plan.components.find(row=>row.archiveRef.assetId==='cw.module.reusable-j20').source.licenseStatus,'unverified');
  assert.equal(f.calls.some(row=>/patch|create|start|install|apply|update|turn/i.test(row.method)),false);
  assert.equal((await f.service.compositionPlan({worldId:'world-test',request:request()})).planHash,plan.planHash);
});
test('preflight compares exact source cohorts and marks modified/missing requirements for adaptation',()=>{
  const entry={sourceRequirements:[{path:'state.gd',sha256:'a'}],sourceRequirementProfiles:[{id:'old',requirements:[{path:'adapter.gd',sha256:'b'}]},{id:'new',requirements:[{path:'adapter.gd',sha256:'c'}]}]};
  const files=new Map([['state.gd',{sha256:'a'}],['adapter.gd',{sha256:'c'}]]);
  assert.equal(assessRequirements(entry,files).status,'source-requirements-matched');files.set('state.gd',{sha256:'z'});
  assert.equal(assessRequirements(entry,files).status,'adaptation-required');files.delete('state.gd');assert.equal(assessRequirements(entry,files).required[0].status,'missing');
});
test('configured omissions persist, existing weather is flagged, and paged source remains bound',async t=>{
  const f=await fixture(t);f.state.files=[{path:'a.gd',sha256:'a'.repeat(64)},{path:'b.gd',sha256:'b'.repeat(64)},{path:'addons/cw.module.rain-control/rain_control.gd',sha256:'c'.repeat(64)}];
  const chosen=request({recipeId:'rain-exploration',choices:{scenery:'keep',companion:false,weather:'rain',collectionCount:0}});
  const plan=await f.service.compositionPlan({worldId:'world-test',request:chosen});assert.equal(plan.components.length,1);assert.equal(plan.missingLogic.length,0);
  assert.equal(plan.checks.find(row=>row.id==='weather-owner').status,'possible-conflict');
  const next=f.calls.find(row=>row.method==='godotProject.index'&&row.args.offset===2);assert.equal(next.args.revision,7);assert.equal(next.args.manifestHash,'a'.repeat(64));
});
test('changed pinned archive and corrupted real body fail closed',async t=>{
  const f=await fixture(t);f.state.tamper=true;await assert.rejects(f.service.compositionPlan({worldId:'world-test',request:request()}),/PIN_CHANGED/);
  f.state.tamper=false;const file=f.catalog.entries.find(row=>row.assetId==='cw.city.ward-street');await fs.writeFile(path.join(f.root,'library',file.file),Buffer.alloc(file.bytes));
  await assert.rejects(f.service.compositionPlan({worldId:'world-test',request:request()}),/BODY_MISMATCH/);
});
test('ended turns cannot continue source or archive reads',async t=>{
  const f=await fixture(t);await assert.rejects(f.service.tool({mode:'compose',request:request()},f.context,'world-test','call',()=>{throw Error('TURN_ENDED');}),/TURN_ENDED/);assert.equal(f.calls.length,0);
});

test('source changes during immutable reads reject stale composition instead of returning mixed revisions',async t=>{const f=await fixture(t);f.state.changeSourceOnBuiltin=true;await assert.rejects(f.service.compositionPlan({worldId:'world-test',request:request()}),/COMPOSITION_SOURCE_CHANGED/);});
