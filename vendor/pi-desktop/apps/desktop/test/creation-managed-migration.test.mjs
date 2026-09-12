import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {createCreationSourceMigration,CREATION_MIGRATION_FILES} from '../electron/main/creation-source-migration.ts';
import {CREATION_MANAGED_MIGRATIONS} from '../electron/main/creation-managed-migrations.ts';
const sha=text=>createHash('sha256').update(text).digest('hex');
const metadata=(name,text)=>({path:name,sha256:sha(text),bytes:Buffer.byteLength(text)});
const ctx={projectId:'project-a',sessionId:'session-a',turnId:'turn-a'};
const helper='craftmine_shared/headless_play_action.gd',helperText='extends RefCounted\n# Trusted migration mechanism fixture, not the future product helper.\n';
const stock=(rev,file)=>execFileSync('git',['show',`${rev}:desktop/godot/${file}`],{encoding:'utf8',windowsHide:true}).replace(/\r\n/g,'\n');
// Freeze this mechanism fixture independently of later production helper releases.
const baselinePolicy={id:'fixture-observer-940-to-141',files:[{source:'craftmine_shared/base_adapter.gd',resource:'shared/adapters/creation-sandbox.gd',from:['edf0f6efe5ed9381f7fca2b7365cbba6062463a4ebb489191086e734af3765ee','b381b17a4c26176fa257a843fcd5d11e48ce0ea16252961c7d8f619ba14962c5'],to:['8b941793dd989decb5c4c7e8339e92d896db4783f414fbff47183852a485b95d','7e32ebfed318b423ec01585154d4de55ef04bfe5c1097640f20a2d055fda01c0']}]};
function fixture(t,{helperState,loss=false,crlf=false,unknownAdapter=false,helperAllowsAbsent=true,production=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'managed-migration-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const resourcesRoot=path.join(directory,'resources'),records=path.join(directory,'records'),formalTexts=new Map();
 for(const file of CREATION_MIGRATION_FILES){
  const current=production?fs.readFileSync(path.resolve(import.meta.dirname,'../../../../../desktop/godot',file.resource),'utf8').replace(/\r\n/g,'\n'):stock('141642e9',file.resource),dest=path.join(resourcesRoot,file.resource);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,current);
  let initial=production||file.source==='craftmine_shared/base_adapter.gd'?stock('940c5a84',file.resource):current;
  if(file.source==='craftmine_shared/base_adapter.gd'&&unknownAdapter)initial+='\n# unknown changed observer\n';
  if(file.source.startsWith('scripts/'))initial+='\n# AI-authored gameplay extension: preserve these bytes\n';
  formalTexts.set(file.source,crlf?initial.replace(/\n/g,'\r\n'):initial);
 }
 formalTexts.set('project.godot','[autoload]\nCraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"\n[craftmine]\nruntime/adapter="res://craftmine_shared/base_adapter.gd"\n');
 formalTexts.set('scripts/pet_dog.gd','extends Node3D\n# Clearly marked authored gameplay fixture, not claimed model output.\nvar name_tag = "团子"\n');
 formalTexts.set('craftmine_shared/user_invention.gd','extends Node\n# unrelated user file must remain byte-identical\n');
 formalTexts.set('world/creation.json','{"format":"craftmine.creation-scene/1","entities":[]}');
 const policies=production?structuredClone(CREATION_MANAGED_MIGRATIONS):[structuredClone(baselinePolicy)];
 if(production)for(const file of policies.flatMap(policy=>policy.files)){
  const dest=path.join(resourcesRoot,file.resource);fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.copyFileSync(path.resolve(import.meta.dirname,'../../../../../desktop/godot',file.resource),dest);
 }
 if(helperState!==undefined){
  fs.writeFileSync(path.join(resourcesRoot,'shared/headless_play_action.gd'),helperText);
  policies[0].files.push({source:helper,resource:'shared/headless_play_action.gd',from:helperAllowsAbsent?[null]:['f'.repeat(64)],to:[sha(helperText)]});
  if(helperState==='current')formalTexts.set(helper,helperText);
  if(helperState==='conflict')formalTexts.set(helper,'extends Node\n# user-authored same-name file\n');
 }
 let live=new Map(formalTexts),revision=10,receipt=null,patches=0,loseBind=false;
 const files=texts=>[...texts].map(([name,text])=>metadata(name,text));
 const capture={worldId:'world-a',buildId:'build-a',sourceRevision:1,manifestHash:'a'.repeat(64)};
 const formal={...capture,baseId:'creation-sandbox',contentOid:'b'.repeat(40),files:files(formalTexts)};
 const index=()=>({worldId:'world-a',baseId:'creation-sandbox',revision,manifestHash:sha(JSON.stringify(files(live))),files:files(live),currentTaskId:'task-a',nextOffset:null});
 const calls=[],advances=[];
 const deps={directory:records,resourcesRoot,managedMigrations:policies,assertActive:async()=>{},recordAdvance:(_,__,advance)=>{if(loseBind){loseBind=false;throw Error('LOST_BIND');}advances.push(advance);},domain:async(method,args)=>{
  calls.push({method,args});
  if(method==='godotRuntime.exportSource')return structuredClone(formal);
  if(method==='content.readFile')return {worldId:'world-a',rev:formal.contentOid,...metadata(args.path,formalTexts.get(args.path)),text:formalTexts.get(args.path)};
  if(method==='godotProject.index')return index();
  if(method==='task.context')return {binding:{...ctx,taskId:'task-a'}};
  if(method==='godotProject.receipt')return receipt;
  if(method==='godotProject.patch'){
   assert.equal(args.revision,revision);assert.equal(args.manifestHash,index().manifestHash);
   for(const op of args.operations)assert.equal(op.expectedHash,live.has(op.path)?sha(live.get(op.path)):null);
   for(const op of args.operations)live.set(op.path,op.text);
   patches++;revision++;receipt={revision,manifestHash:index().manifestHash};if(loss)throw Error('LOST_REPLY');return receipt;
  }
  throw Error(method);
 }};
 return {deps,capture,formalTexts,calls,advances,records,live:()=>live,patches:()=>patches,execute:()=>createCreationSourceMigration(deps),dirty:()=>live.set('scripts/draft.gd','new draft'),loseBind:()=>{loseBind=true;},
  replaceFormalFile:(name,text)=>{formalTexts.set(name,text);live.set(name,text);formal.files=files(formalTexts);}};
}
function assertGameplayPreserved(f){for(const [name,bytes] of f.formalTexts)if(name!=='craftmine_shared/base_adapter.gd')assert.equal(f.live().get(name),bytes,name);}
test('reviewed observer-only upgrade preserves customized world, contract, dog and unrelated helpers byte for byte',async t=>{
 for(const crlf of [false,true]){
  const f=fixture(t,{crlf}),advance=await f.execute()(ctx,f.capture);
  assert.equal(f.patches(),1);assert.equal(advance.revision,11);assertGameplayPreserved(f);
  const operations=f.calls.find(c=>c.method==='godotProject.patch').args.operations;
  assert.deepEqual(operations.map(op=>op.path),['craftmine_shared/base_adapter.gd']);
  const record=JSON.parse(fs.readFileSync(path.join(f.records,advance.migrationId+'.json'),'utf8'));
  assert.equal(record.migrationMode,'managed-compatible');assert.equal(record.compatibilityId,baselinePolicy.id);
 }
});
test('at least one production compatibility destination matches the actual shipped resource bytes',()=>{
 const root=path.resolve(import.meta.dirname,'../../../../..');
 assert.ok(CREATION_MANAGED_MIGRATIONS.some(policy=>policy.files.every(file=>{
  const resource=path.join(root,'desktop/godot',file.resource);
  return fs.existsSync(resource)&&file.to.includes(sha(fs.readFileSync(resource,'utf8').replace(/\r\n/g,'\n')));
 })));
});

test('current production upgrade installs both fixed helpers and preserves existing authored content',async t=>{
 const f=fixture(t,{production:true});await f.execute()(ctx,f.capture);
 const managed=new Set(CREATION_MANAGED_MIGRATIONS.flatMap(policy=>policy.files.map(file=>file.source)));
 assert.equal(f.patches(),1);
 for(const [name,text] of f.formalTexts)if(!managed.has(name))assert.equal(f.live().get(name),text,name);
 for(const file of CREATION_MANAGED_MIGRATIONS[0].files){
  assert.equal(f.live().get(file.source),fs.readFileSync(path.join(f.deps.resourcesRoot,file.resource),'utf8').replace(/\r\n/g,'\n'));
 }
 const additions=f.calls.find(call=>call.method==='godotProject.patch').args.operations.filter(op=>!f.formalTexts.has(op.path));
 assert.ok(additions.some(op=>op.path==='craftmine_shared/headless_play_action.gd'&&op.expectedHash===null));
 assert.ok(additions.some(op=>op.path==='craftmine_shared/scene_mesh_picker.gd'&&op.expectedHash===null));
});

test('released 32cd and 594f cohorts upgrade the complete current observer and required component helper while retaining authored sources',async t=>{
 for(const rev of ['32cd879d','594f698b5206'])for(const crlf of [false,true]){
  const f=fixture(t,{production:true});
  for(const file of CREATION_MANAGED_MIGRATIONS[0].files){if(file.from.length===1&&file.from[0]===null)continue;let text=stock(rev,file.resource);if(crlf)text=text.replace(/\n/g,'\r\n');f.replaceFormalFile(file.source,text);}
  const advance=await f.execute()(ctx,f.capture);assert.equal(f.patches(),1);assert.ok(advance.migrationId);
  const patch=f.calls.find(c=>c.method==='godotProject.patch');assert.deepEqual(patch.args.operations.map(op=>op.path),['craftmine_shared/base_adapter.gd','craftmine_shared/runtime_bridge.gd','craftmine_shared/scene_mesh_picker.gd','craftmine_shared/component_state.gd']);
  assert.equal(patch.args.operations.find(op=>op.path==='craftmine_shared/component_state.gd').expectedHash,null);
  for(const [name,text] of f.formalTexts)if(!patch.args.operations.some(op=>op.path===name))assert.equal(f.live().get(name),text,name);
 }
});

test('the new complete-cohort policy does not hide legacy destinations that permit absent helpers',async t=>{
 const f=fixture(t,{production:true});for(const file of CREATION_MIGRATION_FILES)f.replaceFormalFile(file.source,stock('c1660f12',file.resource));
 await f.execute()(ctx,f.capture);assert.equal(f.patches(),1);
 const added=f.calls.find(c=>c.method==='godotProject.patch').args.operations.filter(op=>op.expectedHash===null).map(op=>op.path);
 assert.ok(added.includes('craftmine_shared/headless_play_action.gd'));assert.ok(added.includes('craftmine_shared/scene_mesh_picker.gd'));
 assert.equal(f.live().get('scripts/pet_dog.gd'),f.formalTexts.get('scripts/pet_dog.gd'));
});
test('new fixed helper uses expected absence and existing matching bytes are not replaced',async t=>{
 for(const helperState of ['missing','current']){
  const f=fixture(t,{helperState});await f.execute()(ctx,f.capture);assertGameplayPreserved(f);
  const operations=f.calls.find(c=>c.method==='godotProject.patch').args.operations;
  assert.equal(f.live().get(helper),helperText);
  const addition=operations.find(op=>op.path===helper);
  if(helperState==='missing')assert.equal(addition.expectedHash,null);else assert.equal(addition,undefined);
 }
});
test('unknown managed bytes, helper collision and undeclared absence cannot be overwritten',async t=>{
 for(const options of [{unknownAdapter:true},{helperState:'conflict'},{helperState:'missing',helperAllowsAbsent:false}]){
  const f=fixture(t,options),before=new Map(f.live());
  await assert.rejects(f.execute()(ctx,f.capture),/MIGRATION_NEEDED/);assert.equal(f.patches(),0);assert.deepEqual(f.live(),before);
 }
});
test('only exact reviewed destination bytes enable compatibility',async t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.deps.resourcesRoot,'shared/adapters/creation-sandbox.gd'),'\n# unreviewed next version\n');
 await assert.rejects(f.execute()(ctx,f.capture),/MIGRATION_NEEDED/);assert.equal(f.patches(),0);
});
test('unlisted protected observer changes cannot piggyback on a valid adapter migration',async t=>{
 const f=fixture(t,{helperState:'missing'});f.replaceFormalFile('craftmine_shared/state_guard.gd','extends RefCounted\n# unknown guard\n');
 const before=new Map(f.live());await assert.rejects(f.execute()(ctx,f.capture),/MIGRATION_NEEDED/);
 assert.equal(f.patches(),0);assert.deepEqual(f.live(),before);
});
test('compatible migration with added helper recovers lost reply and subsequent turn without patching twice',async t=>{
 const f=fixture(t,{helperState:'missing',loss:true});f.loseBind();
 await assert.rejects(f.execute()(ctx,f.capture),/LOST_BIND/);
 const advance=await f.execute()({...ctx,turnId:'turn-b'},f.capture);
 assert.equal(f.patches(),1);assert.equal(advance.revision,11);assertGameplayPreserved(f);
 f.dirty();const before=new Map(f.live());await f.execute()({...ctx,turnId:'turn-c'},f.capture);assert.deepEqual(f.live(),before);assert.equal(f.patches(),1);
});
test('unrelated unapplied changes remain intact when exact managed files are migrated',async t=>{
 const f=fixture(t,{helperState:'missing'});f.dirty();const before=new Map(f.live());
 await f.execute()(ctx,f.capture);assert.equal(f.patches(),1);for(const [name,text]of before)if(name!=='craftmine_shared/base_adapter.gd')assert.equal(f.live().get(name),text);
});
if(process.env.CRAFTMINE_REAL_MIGRATION_SOURCE)test('actual adopted PET source preserves authored bytes while updating only reviewed managed files',async t=>{
 const source=process.env.CRAFTMINE_REAL_MIGRATION_SOURCE;assert.ok(path.isAbsolute(source));
 const f=fixture(t,{production:true}),sampled=[];
 for(const name of ['project.godot','craftmine_shared/base_adapter.gd','craftmine_shared/runtime_bridge.gd','craftmine_shared/state_guard.gd','scripts/creation_world.gd','scripts/scene_contract.gd','scripts/pet_dog.gd']){
  const bytes=fs.readFileSync(path.join(source,name));assert.ok(bytes.length<=120000);const text=bytes.toString('utf8');assert.deepEqual(Buffer.from(text),bytes);
  f.replaceFormalFile(name,text);sampled.push({path:name,beforeSha256:sha(bytes),bytes:bytes.length});
 }
 const advance=await f.execute()(ctx,f.capture);assert.equal(f.patches(),1);
 const managed=new Set(CREATION_MANAGED_MIGRATIONS.flatMap(policy=>policy.files.map(file=>file.source)));
 for(const [name,text] of f.formalTexts)if(!managed.has(name))assert.equal(f.live().get(name),text,name);
 const rows=sampled.map(item=>({...item,afterSha256:sha(f.live().get(item.path)),preserved:item.beforeSha256===sha(f.live().get(item.path))}));
 assert.ok(rows.filter(item=>!managed.has(item.path)).every(item=>item.preserved));
 fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/managed-pet-source-'));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({format:'craftmine.managed-pet-source-preservation/1',source,scope:'Actual source bytes; mocked CAS and receipt, no product launch or engine acceptance',passed:true,advance,files:rows},null,2));
 console.log(JSON.stringify({realPetSourceReport:out,passed:true,files:rows}));
});
