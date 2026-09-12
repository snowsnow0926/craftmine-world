import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/godot-generic-read-'));
// Use the actual bundled legacy domain implementation, not a stub that masks the original crash.
execFileSync(process.execPath,[path.join(root,'desktop/build-world-plugin.mjs'),'--output',out],{cwd:root,windowsHide:true,stdio:'pipe'});
const require=createRequire(import.meta.url),{createWorldTools}=require(path.join(out,'world-tools.cjs'));
const {inspectDraft,draftPackages}=require(path.join(out,'domain.cjs'));
const context={projectId:'project-a',sessionId:'session-a',turnId:'turn-a'};
const bytes=Buffer.from('extends Node3D\n'),sha256=createHash('sha256').update(bytes).digest('hex');
const legacy={format:'craftmine.scene/3',title:'Legacy',night:false,objects:[],systems:[],behaviors:[]};
function fixture({baseId='creation-sandbox',legacyWorld=false,missing=false,indexError,worldMismatch=false,sourceMismatch=false,discussionOnly=false,sceneObjectTarget,captureFields={}}={}){
 const scene=legacyWorld?structuredClone(legacy):{format:'craftmine.godot-scene/1',baseId};
 const workspace={worldId:'world-a',task:{binding:{...context,taskId:'task-a',baseBuild:'build-a'},revision:9,status:'active',draft:{scene}}};
 const record={id:worldMismatch?'other-world':'world-a',runtimeKind:legacyWorld?'legacy':'godot',baseId,world:{build:{id:'build-a',scene},extensions:[]}};
 const calls=[],hello={godotProjects:true,sessionDrafts:true,godotBuildJobs:true,godotExecutorGate:true,godotExecution:false};
 const core={start:async()=>hello,call:async(method,input)=>{
  calls.push({method,input});if(method==='workspace.open')return workspace;if(method==='world.read')return record;
  if(method==='godotProject.index'){
   if(missing||indexError)throw Object.assign(Error(indexError??'GODOT_PROJECT_NOT_FOUND'),{errorCode:indexError??'GODOT_PROJECT_NOT_FOUND'});
   return {worldId:sourceMismatch?'other-world':'world-a',baseId,revision:7,manifestHash:'a'.repeat(64),engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web',files:input.offset===0?[{path:'scripts/world.gd',bytes:bytes.length,sha256}]:[],totalFiles:1,nextOffset:null};
  }
  throw Error('Unexpected method '+method);
 }};
 const toolset=createWorldTools(core,async()=>({activeWorldId:'world-a',discussionOnly}),()=>false,undefined,undefined,{creationTarget:async()=>({format:'craftmine.creation-target/1',worldId:'world-a',snapshotId:'capture-a',...(sceneObjectTarget?{sceneObjectTarget}:{}),...captureFields})});
 return {workspace,record,calls,invoke:(name,args={})=>toolset.find(tool=>tool.name===name).execute(args,{...context,toolCallId:'read-a',executionId:'execution-a'})};
}
test('the actual old domain reproduces both Godot wrong-format failures',()=>{const f=fixture();assert.throws(()=>inspectDraft(f.workspace,{}),/map|undefined/);assert.throws(()=>draftPackages(f.workspace.task.draft,f.record.world),/objects|iterable/);});
test('default project_inspect routes five real Godot scene shapes to host source identity',async()=>{
 for(const baseId of ['creation-sandbox','first-person','top-down','side-view','mining-sandbox']){
  const f=fixture({baseId}),result=await f.invoke('project_inspect');assert.equal(result.runtimeKind,'godot');assert.equal(result.baseId,baseId);assert.equal(result.project.revision,7);assert.equal(result.sourceRevision,7);assert.equal(result.manifestHash,'a'.repeat(64));assert.equal(result.project.manifestHash,'a'.repeat(64));assert.deepEqual(result.project.files,[{path:'scripts/world.gd',bytes:bytes.length,sha256}]);assert.ok(!Object.hasOwn(result,'resources'));assert.ok(!Object.hasOwn(result,'objects'));assert.equal(result.creationTarget.snapshotId,'capture-a');assert.equal(result.publishingAvailable,false);
  assert.deepEqual(f.calls.map(c=>c.method),['workspace.open','world.read','godotProject.index']);assert.deepEqual(f.calls[2].input,{context,worldId:'world-a',offset:0,limit:24});
 }
});
test('generic capability sections return actual Godot tools and never voxel/JavaScript schemas',async()=>{
 for(const section of ['objects','systems','behaviors','catalog']){
  const f=fixture(),result=await f.invoke('capabilities_read',{section});const body=JSON.parse(result.text);assert.equal(body.runtimeKind,'godot');assert.equal(body.project.revision,7);assert.ok(body.tools.some(t=>t.name==='godot_project_patch'));assert.ok(body.tools.some(t=>t.name==='creation_operation'));assert.ok(!body.tools.some(t=>t.name==='workspace_patch'));assert.ok(!Object.hasOwn(body,'groundY'));assert.ok(!Object.hasOwn(body,'schema'));assert.match(body.guidance.join(' '),/GDScript/);assert.equal(result.next,null);
 }
});
test('generic source inspection exposes frozen scene context without widening creation operations',async()=>{
 const sceneObjectTarget={objectId:'42',nodePath:'Actor/Body',identityScope:'runtime-instance',sourceUse:'context-only'};
 const read=await fixture({sceneObjectTarget}).invoke('project_inspect');
 assert.deepEqual(read.sceneObjectTarget,sceneObjectTarget);
 assert.equal(read.sceneObjectContext.use,'ordinary-source-editing-only');
 assert.equal(read.creationTarget.snapshotId,'capture-a');
 assert.equal(read.sceneObjectContext.current,null);
});

test('actual project_inspect exposes current automatic handoff context before paginated source guidance',async()=>{
 const automatic=await fixture({captureFields:{autoApply:true,authorization:'full-auto'}}).invoke('project_inspect');
 assert.equal(automatic.applicationGuidance.mode,'full-auto');assert.equal(automatic.applicationGuidance.owner.sessionId,context.sessionId);
 assert.equal(automatic.applicationGuidance.nextAction,'complete-edit-check-then-finish-turn');assert.equal(automatic.applicationGuidance.adoptionConfirmed,false);
 const ask=await fixture({captureFields:{autoApply:false,authorization:'full-auto'}}).invoke('project_inspect');assert.equal(ask.applicationGuidance.mode,'manual-or-unavailable');
});
test('capability text pagination preserves exact complete Unicode data',async()=>{const f=fixture(),whole=await f.invoke('capabilities_read',{section:'behaviors'});let text='',start=0;do{const part=await f.invoke('capabilities_read',{section:'behaviors',start,limit:97});text+=part.text;start=part.next;}while(start!==null);assert.equal(text,whole.text);});
test('missing Godot project is explicit and never manufactures an empty valid world',async()=>{const f=fixture({missing:true});const read=await f.invoke('project_inspect');assert.equal(read.project.available,false);assert.equal(read.project.reason,'GODOT_PROJECT_NOT_FOUND');assert.ok(read.nextTools.includes('godot_project_create'));assert.ok(!Object.hasOwn(read.project,'files'));const caps=JSON.parse((await f.invoke('capabilities_read')).text);assert.equal(caps.project.available,false);});
test('permissions and crossed world/source identity still reject',async()=>{for(const settings of [{indexError:'PERMISSION_DENIED'},{worldMismatch:true},{sourceMismatch:true}])await assert.rejects(fixture(settings).invoke('project_inspect'),/PERMISSION_DENIED|IDENTITY_MISMATCH/);});
test('read-only discussion can inspect Godot while legacy contracts retain their actual old shape',async()=>{
 assert.equal((await fixture({discussionOnly:true}).invoke('project_inspect')).runtimeKind,'godot');
 const f=fixture({legacyWorld:true}),read=await f.invoke('project_inspect');assert.deepEqual(read.resources,[]);assert.equal(read.workspaceRevision,9);assert.equal(read.title,'Legacy');
 const caps=JSON.parse((await f.invoke('capabilities_read')).text);assert.equal(caps.format,'craftmine.scene/3');assert.equal(caps.groundY,6);assert.ok(caps.schema);assert.ok(!f.calls.some(c=>c.method==='godotProject.index'));
});
