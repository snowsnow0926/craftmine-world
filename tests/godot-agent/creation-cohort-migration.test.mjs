import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {register} from 'node:module';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createCreationSourceMigration}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/creation-source-migration.ts');
const {currentSceneObserverProfile,loadSceneObserverPins,canUpgradeSceneObserver}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/creation-observer-pins.ts');
const root=path.resolve(import.meta.dirname,'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),context={projectId:'migration-fixture',sessionId:'migration-session',turnId:'migration-turn'};
function fixture(profile){
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 const out=fs.mkdtempSync(path.join(root,'test-results/creation-cohort-migration-')),project=path.join(out,'project');
 materializeBase({baseId:'creation-sandbox',worldId:'world-audit',out:project,controllerProfile:profile});
 const texts=new Map(fs.readdirSync(project,{recursive:true}).map(name=>name.split(path.sep).join('/')).filter(name=>name!=='managed-base.json'&&fs.statSync(path.join(project,name)).isFile()).map(name=>[name,fs.readFileSync(path.join(project,name))]));
 const files=()=>[...texts].map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)}));
 const capture={worldId:'world-audit',buildId:'formal-audit',sourceRevision:3,manifestHash:'a'.repeat(64)};
 const formal={...capture,baseId:'creation-sandbox',contentOid:'b'.repeat(40),files:files()};
 const calls=[],draft=structuredClone(formal.files),deps={directory:path.join(out,'records'),resourcesRoot:path.join(root,'desktop/godot'),assertActive:async()=>{},recordAdvance:()=>assert.fail('No migration advance'),domain:async(method,args)=>{
  calls.push({method,args});
  if(method==='godotRuntime.exportSource')return structuredClone(formal);
  if(method==='content.readFile'){const bytes=texts.get(args.path);return{worldId:capture.worldId,rev:formal.contentOid,path:args.path,text:bytes.toString('utf8'),bytes:bytes.length,sha256:sha(bytes)};}
  if(method==='godotProject.index')return{worldId:capture.worldId,baseId:'creation-sandbox',revision:4,manifestHash:'d'.repeat(64),files:draft.slice(args.offset,args.offset+args.limit),nextOffset:args.offset+args.limit<draft.length?args.offset+args.limit:null};
  assert.fail('Unexpected migration write or lifecycle call: '+method);
 }};
 return{out,texts,formal,capture,calls,deps,files,draft};
}
function assertReadOnly(f){
 assert.ok(f.calls.every(call=>['godotRuntime.exportSource','content.readFile'].includes(call.method)),JSON.stringify(f.calls));
 assert.equal(fs.existsSync(f.deps.directory),false,'no durable migration record');
}

test('released oversized-mesh picker upgrades only pinned sampler bytes through durable source CAS',async()=>{
 const f=fixture('creation-player-collision/1'),name='craftmine_shared/scene_mesh_picker_v2.gd';
 f.texts.set(name,fs.readFileSync(path.join(root,'desktop/godot/shared/repairs/scene_mesh_picker_v2-global-budget.gd')));
 f.texts.set('scenes/authored-companion.tscn',Buffer.from('authored companion retained'));
 f.formal.files=f.files();f.draft.splice(0,f.draft.length,...structuredClone(f.formal.files));
 const pins=loadSceneObserverPins(f.deps.resourcesRoot);assert.equal(currentSceneObserverProfile(f.formal.files,pins),'creation-player-collision/1');assert.equal(canUpgradeSceneObserver(f.formal.files,pins),true);
 const original=f.deps.domain,originalFiles=structuredClone(f.draft);let receipt=null,revision=4,hash='d'.repeat(64),patches=0,advance;
 f.deps.recordAdvance=(_context,_capture,value)=>{advance=value;};
 f.deps.domain=async(method,args)=>{
  if(method==='task.context')return{binding:{taskId:'task-fixture'}};
  if(method==='godotProject.receipt')return receipt;
  if(method==='godotProject.patch'){
   patches++;assert.equal(args.operations.length,1);const op=args.operations[0];assert.equal(op.path,name);assert.equal(op.expectedHash,originalFiles.find(f=>f.path===name).sha256);
   const at=f.draft.findIndex(f=>f.path===name);f.draft[at]={path:name,bytes:Buffer.byteLength(op.text),sha256:sha(op.text)};
   revision++;hash='e'.repeat(64);return receipt={revision,manifestHash:hash};
  }
  const value=await original(method,args);return method==='godotProject.index'?{...value,currentTaskId:'task-fixture',revision,manifestHash:hash}:value;
 };
 const migrate=createCreationSourceMigration(f.deps);const result=await migrate(context,f.capture);assert.equal(result.format,'craftmine.creation-migration-advance/1');assert.deepEqual(result,advance);assert.equal(patches,1);
 assert.deepEqual(f.draft.filter(f=>f.path!==name),originalFiles.filter(f=>f.path!==name));assert.equal(canUpgradeSceneObserver(f.draft,pins),false);
 assert.deepEqual(await migrate(context,f.capture),result);assert.equal(patches,1,'retry resolves original receipt without replay');
 const conflict=fixture('creation-player-collision/1');conflict.texts.set(name,f.texts.get(name));conflict.formal.files=conflict.files();conflict.draft.splice(0,conflict.draft.length,...structuredClone(conflict.formal.files));conflict.draft.find(f=>f.path===name).sha256='9'.repeat(64);
 await assert.rejects(createCreationSourceMigration(conflict.deps)(context,conflict.capture),{errorCode:'CREATION_MIGRATION_DRAFT_CONFLICT'});
});
const profiles=['creation-fixed-controller/1','creation-player-collision/1'];
for(const profile of profiles)test('real materialized '+profile+' is already current and must not be rewritten',async()=>{
 const f=fixture(profile);let result,error;
 const before=structuredClone(f.formal.files);
 try{result=await createCreationSourceMigration(f.deps)(context,f.capture);}catch(value){error={message:value.message,errorCode:value.errorCode};}
 fs.writeFileSync(path.join(f.out,'result.json'),JSON.stringify({profile,result,error,calls:f.calls,files:f.formal.files},null,2));
 assert.equal(error,undefined,JSON.stringify(error));assert.equal(result,null);assertReadOnly(f);assert.deepEqual(f.files(),before);
});

test('both complete cohorts preserve authored source and an ordinary unadopted draft, including CRLF',async()=>{
 for(const profile of profiles){
  const f=fixture(profile);
  for(const [name,bytes] of f.texts)if(/\.(gd|godot|tscn)$/.test(name))f.texts.set(name,Buffer.from(bytes.toString().replace(/\r\n/g,'\n').replace(/\n/g,'\r\n')));
  f.texts.set('scripts/creation_world.gd',Buffer.from('extends Node3D\r\n# authored world preserved\r\n'));
  f.texts.set('scripts/scene_contract.gd',Buffer.from('extends RefCounted\r\n# authored contract preserved\r\n'));
  f.texts.set('scenes/user_house.tscn',Buffer.from('[gd_scene format=3]\n[node name="House" type="Node3D"]\n'));
  f.formal.files=f.files();f.draft.push({path:'scripts/unadopted.gd',bytes:5,sha256:sha('draft')});
  const before=structuredClone(f.formal.files),draft=structuredClone(f.draft);
  assert.equal(currentSceneObserverProfile(f.formal.files,loadSceneObserverPins(f.deps.resourcesRoot)),profile);
  assert.equal(await createCreationSourceMigration(f.deps)(context,f.capture),null);
  assert.deepEqual(f.files(),before);assert.deepEqual(f.draft,draft);assertReadOnly(f);
 }
});

test('every protected cohort member must be present, unique and pinned; no partial legacy migration',async()=>{
 for(const profile of profiles){
  const f=fixture(profile),original=structuredClone(f.formal.files);
  const names=original.filter(file=>file.path.startsWith('craftmine_shared/')||(profile===profiles[1]&&['scripts/reused/player_controller.gd','scripts/reused/camera_rig.gd'].includes(file.path))).map(file=>file.path);
  for(const name of names)for(const mode of ['missing','tampered','duplicate']){
   f.formal.files=mode==='missing'?original.filter(file=>file.path!==name):mode==='tampered'?original.map(file=>file.path===name?{...file,sha256:'f'.repeat(64)}:file):[...original,original.find(file=>file.path===name)];
   await assert.rejects(createCreationSourceMigration(f.deps)(context,f.capture),{errorCode:'CREATION_MIGRATION_NEEDED'},profile+' '+name+' '+mode);
  }
  assertReadOnly(f);
 }
});

test('mixed v1/v2/legacy groups and a modern adapter without all versioned helpers are refused',async()=>{
 const v1=fixture(profiles[0]),v2=fixture(profiles[1]),legacy=fixture('legacy');
 const adapter=files=>files.find(file=>file.path==='craftmine_shared/base_adapter.gd');
 const cases=[
  {...v2,formal:{...v2.formal,files:v2.formal.files.map(file=>file.path===adapter(v2.formal.files).path?adapter(v1.formal.files):file)}},
  {...v1,formal:{...v1.formal,files:v1.formal.files.map(file=>file.path===adapter(v1.formal.files).path?adapter(legacy.formal.files):file)}},
  {...v1,formal:{...v1.formal,files:legacy.formal.files.map(file=>file.path===adapter(legacy.formal.files).path?adapter(v1.formal.files):file)}},
 ];
 for(const item of cases){
  const original=item.deps.domain;
  const deps={...item.deps,domain:async(method,args)=>method==='godotRuntime.exportSource'?structuredClone(item.formal):original(method,args)};
  await assert.rejects(createCreationSourceMigration(deps)(context,item.capture),{errorCode:'CREATION_MIGRATION_NEEDED'});assertReadOnly(item);
 }
 assert.equal(await createCreationSourceMigration(legacy.deps)(context,legacy.capture),null);assertReadOnly(legacy);
});

test('installed trusted pin changes cannot turn the old formal cohort into a current one',async()=>{
 const f=fixture(profiles[1]),resources=path.join(f.out,'resources');
 fs.cpSync(f.deps.resourcesRoot,resources,{recursive:true});f.deps.resourcesRoot=resources;
 fs.appendFileSync(path.join(resources,'shared/progress_collision.gd'),'\n# different installed trusted version\n');
 await assert.rejects(createCreationSourceMigration(f.deps)(context,f.capture),{errorCode:'CREATION_MIGRATION_NEEDED'});assertReadOnly(f);
});

test('modern no-op still validates formal identity, exact selectors, content bytes and active capture',async()=>{
 for(const field of ['worldId','buildId','baseId','sourceRevision']){
  const f=fixture(profiles[1]);f.formal[field]=field==='sourceRevision'?99:'different';
  await assert.rejects(createCreationSourceMigration(f.deps)(context,f.capture),{errorCode:'CREATION_MIGRATION_FORMAL_CHANGED'});assertReadOnly(f);
 }
 for(const change of [text=>text.replace('runtime/adapter="res://craftmine_shared/base_adapter.gd"','runtime/adapter="res://scripts/authored.gd"'),text=>text+'\n[craftmine]\nruntime/adapter="res://craftmine_shared/base_adapter.gd"\n',text=>text.replace('CraftmineRuntime="*res://','CraftmineRuntime="res://')]){
  const f=fixture(profiles[1]);f.texts.set('project.godot',Buffer.from(change(f.texts.get('project.godot').toString())));f.formal.files=f.files();
  await assert.rejects(createCreationSourceMigration(f.deps)(context,f.capture),{errorCode:'CREATION_MIGRATION_NEEDED'});assertReadOnly(f);
 }
 const corrupt=fixture(profiles[1]);corrupt.texts.set('project.godot',Buffer.from('different content than indexed bytes'));
 await assert.rejects(createCreationSourceMigration(corrupt.deps)(context,corrupt.capture),{errorCode:'CREATION_MIGRATION_SOURCE_MISMATCH'});assertReadOnly(corrupt);
 for(const rejectAt of [1,2]){
  const f=fixture(profiles[1]);let calls=0;f.deps.assertActive=async()=>{if(++calls===rejectAt)throw Object.assign(Error('capture changed'),{errorCode:'CAPTURE_STALE'});};
  await assert.rejects(createCreationSourceMigration(f.deps)(context,f.capture),{errorCode:'CAPTURE_STALE'});assertReadOnly(f);
 }
});
