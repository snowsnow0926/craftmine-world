// Real materialized source and production broker; domain/capture are test doubles.
// Optional packaged root runs the same checks against the actual built plugin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url),hash=text=>createHash('sha256').update(text).digest('hex');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'guidance-current-'));
const plugin=process.env.CRAFTMINE_GUIDANCE_PLUGIN_ROOT?path.resolve(process.env.CRAFTMINE_GUIDANCE_PLUGIN_ROOT):path.join(temporary,'plugin');
if(!process.env.CRAFTMINE_GUIDANCE_PLUGIN_ROOT){
 fs.mkdirSync(plugin,{recursive:true});
 for(const name of fs.readdirSync(path.join(root,'plugins/craftmine-world')).filter(name=>name.endsWith('.cjs')||name==='manifest.json'))fs.copyFileSync(path.join(root,'plugins/craftmine-world',name),path.join(plugin,name));
 fs.cpSync(path.join(root,'plugins/craftmine-world/guidance'),path.join(plugin,'guidance'),{recursive:true});
 fs.writeFileSync(path.join(plugin,'domain.cjs'),`module.exports={fields(args,required,optional){for(const k of required)if(!Object.hasOwn(args,k))throw Error('MISSING_FIELD');for(const k of Object.keys(args))if(![...required,...optional].includes(k))throw Error('UNKNOWN_FIELD');},createLibraryService:()=>({}),createMemoryService:()=>({})};`);
}
const {createWorldTools}=require(path.join(plugin,'world-tools.cjs'));
const corpus=require(path.join(plugin,'guidance/catalog.json')),skill=corpus.skills.find(s=>s.id==='creation-sandbox.authoring');
const context={projectId:'project',sessionId:'session',turnId:'turn',executionId:'execution',toolCallId:'call'};
function fixture(profile){
 const out=path.join(fs.mkdtempSync(path.join(temporary,'source-')),'project');
 const manifest=materializeBase({baseId:'creation-sandbox',worldId:'world-guidance',out,controllerProfile:profile});
 const texts=new Map(manifest.files.map(file=>[file.path,fs.readFileSync(path.join(out,file.path),'utf8')]));
 let change=()=>{};const calls=[];
 const core={start:async()=>({godotProjects:true}),call:async(method,args)=>{
  calls.push({method,args});
  if(method==='workspace.open')return{worldId:'world-guidance'};
  const identity={worldId:'world-guidance',revision:4,manifestHash:'a'.repeat(64)};let response;
  if(method==='godotProject.index'){
   const files=[...texts].map(([path,text])=>({path,sha256:hash(text),bytes:Buffer.byteLength(text)}));
   const offset=args.offset??0,limit=args.limit??32;
   response={...identity,baseId:'creation-sandbox',baseBuild:'gbd-'+'b'.repeat(64),engineVersion:'4.7.2-stable',totalFiles:files.length,files:files.slice(offset,offset+limit),nextOffset:offset+limit<files.length?offset+limit:null};
  }else if(method==='godotProject.read'){
   if(!texts.has(args.path))throw Object.assign(Error('PROJECT_FILE_NOT_FOUND'),{errorCode:'PROJECT_FILE_NOT_FOUND'});
   const full=texts.get(args.path),chars=Array.from(full),offset=args.offset??0,text=chars.slice(offset,offset+args.limit).join(''),end=offset+Array.from(text).length;
   response={...identity,path:args.path,sha256:hash(full),bytes:Buffer.byteLength(full),text,offset,totalCharacters:chars.length,nextOffset:end<chars.length?end:null};
  }else throw Error('Unexpected write or execution '+method);
  change(method,args,response);return response;
 }};
 const tools=createWorldTools(core,async()=>({activeWorldId:'world-guidance'}));
 return {texts,calls,alter:fn=>change=fn,run:(name,args)=>tools.find(tool=>tool.name===name).execute(args,context)};
}
const query=(f,args)=>f.run('godot_project_query',args),guide=(f,args={mode:'catalog'})=>f.run('godot_guidance',args);
function readOnly(f){assert.ok(f.calls.every(call=>['workspace.open','godotProject.index','godotProject.read'].includes(call.method)));}
test.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));

test('cohort corpus deterministically matches the current real materializer and shared observer authority',()=>{
 execFileSync(process.execPath,[path.join(root,'scripts/refresh-guidance-cohorts.mjs'),'--check'],{cwd:root,windowsHide:true,stdio:'pipe'});
 assert.deepEqual(skill.interfaceCohorts.variants.map(v=>v.files.length),[10,12]);
});

for(const profile of ['legacy','creation-fixed-controller/1','creation-player-collision/1'])test('real '+profile+' catalog and pinned recipe/reference work through '+(process.env.CRAFTMINE_GUIDANCE_PLUGIN_ROOT?'packaged':'source')+' broker',async()=>{
 const f=fixture(profile),before=new Map(f.texts),catalog=await guide(f);
 assert.equal(catalog.available,true);assert.equal(catalog.skills[0].id,skill.id);
 assert.equal(catalog.interfaceMatches[0].profile,profile==='legacy'?'legacy-reference-hashes':profile);
 const pin={revision:catalog.source.revision,manifestHash:catalog.source.manifestHash};
 let offset=0,text='';do{
  const page=await guide(f,{mode:'read',id:skill.id,version:skill.version,sha256:skill.sha256,...pin,offset,limit:8000});text+=page.text;offset=page.nextOffset;
 }while(offset!==null);assert.equal(text,skill.text);
 const ref=skill.references.find(ref=>ref.projectPath==='craftmine_shared/base_adapter.gd');
 const page=await guide(f,{mode:'read',id:skill.id,version:skill.version,sha256:ref.sha256,path:ref.path,...pin,limit:8000});
 assert.equal(page.text,Array.from(ref.text).slice(0,8000).join(''));
 if(profile!=='legacy')assert.equal(page.interfaceMatches[0].referencePaths[ref.projectPath],'craftmine_shared/base_adapter_legacy.gd');
 await assert.rejects(guide(f,{mode:'read',id:skill.id,version:'1.6.1',sha256:skill.sha256,...pin}),/GUIDANCE_VERSION_UNSUPPORTED/);
 await assert.rejects(guide(f,{mode:'read',id:skill.id,version:skill.version,sha256:'f'.repeat(64),...pin}),/GUIDANCE_HASH_MISMATCH/);
 assert.deepEqual(f.texts,before);readOnly(f);
});

test('each modern cohort dependency and inherited recipe contract rejects missing or changed bytes; mixed groups reject',async()=>{
 for(const variant of skill.interfaceCohorts.variants){
  const f=fixture(variant.profile),original=new Map(f.texts);
  for(const name of [...variant.files.map(file=>file.path),'scripts/creation_world.gd','scripts/scene_contract.gd'])for(const mode of ['missing','modified']){
   f.texts.clear();for(const entry of original)f.texts.set(...entry);
   if(mode==='missing')f.texts.delete(name);else f.texts.set(name,original.get(name)+'\n# unknown modified interface\n');
   await assert.rejects(guide(f),/GUIDANCE_INTERFACE_(UNSUPPORTED|MISSING)/,variant.profile+' '+name+' '+mode);
  }
  readOnly(f);
 }
 const f=fixture('creation-player-collision/1'),legacy=fixture('legacy'),v1=fixture('creation-fixed-controller/1');
 for(const replacement of [legacy.texts.get('craftmine_shared/base_adapter.gd'),v1.texts.get('craftmine_shared/base_adapter.gd')]){
  f.texts.set('craftmine_shared/base_adapter.gd',replacement);await assert.rejects(guide(f),/GUIDANCE_INTERFACE_UNSUPPORTED/);
 }
});

test('CRLF source keeps compatibility, while duplicate/paged/foreign identity data cannot certify a cohort',async()=>{
 const f=fixture('creation-player-collision/1');for(const [name,text]of f.texts)f.texts.set(name,text.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'));
 for(let i=0;i<40;i++)f.texts.set('scripts/authored-'+i+'.gd','extends Node\n');
 assert.equal((await guide(f)).available,true);assert.ok(f.calls.some(c=>c.method==='godotProject.index'&&c.args.offset===32));
 for(const alteration of [
  (method,args,result)=>{if(method==='godotProject.index'&&args.limit===32){result.files.push(result.files[0]);result.totalFiles++;}},
  (method,args,result)=>{if(method==='godotProject.index'&&args.offset===32)result.manifestHash='b'.repeat(64);},
  (method,args,result)=>{if(method==='godotProject.read')result.worldId='foreign';},
 ]){f.alter(alteration);await assert.rejects(guide(f),/INVALID_PROJECT_PAGE|PROJECT_QUERY_IDENTITY_MISMATCH|GUIDANCE_SOURCE_IDENTITY_INVALID/);}
 readOnly(f);
});

test('summary mainScene can be passed unchanged to scene; all query read selectors use canonical source aliases',async()=>{
 const f=fixture('creation-player-collision/1'),summary=await query(f,{mode:'summary'});
 assert.equal(summary.mainScene,'res://scenes/creation.tscn');assert.equal(summary.mainSceneSourcePath,'scenes/creation.tscn');
 const scene=await query(f,{mode:'scene',path:summary.mainScene});
 const relative=await query(f,{mode:'scene',path:summary.mainSceneSourcePath});assert.deepEqual(scene,relative);
 assert.equal(scene.path,summary.mainSceneSourcePath);
 const scripts=await query(f,{mode:'scripts',path:'res://scripts/reused/camera_rig.gd'});assert.equal(scripts.scripts[0].path,'scripts/reused/camera_rig.gd');
 f.texts.set('resources/test.tres','[gd_resource type="Resource" format=3]\n[resource]\n');
 assert.equal((await query(f,{mode:'resources',path:'res://resources/test.tres'})).resources[0].path,'resources/test.tres');
 for(const invalid of ['res://../project.godot','res://scenes/../creation.tscn','res:///scenes/creation.tscn','res://scenes\\creation.tscn','C:/secret.tscn','user://scene.tscn','https://site/scene.tscn','res://scenes/./creation.tscn']){
  const before=f.calls.filter(c=>c.method==='godotProject.read').length;
  await assert.rejects(query(f,{mode:'scene',path:invalid}),/PROJECT_QUERY_PATH_INVALID/);
  assert.equal(f.calls.filter(c=>c.method==='godotProject.read').length,before);
 }
 await assert.rejects(query(f,{mode:'scene',path:'res://scenes/%2e%2e/creation.tscn'}),/PROJECT_FILE_NOT_FOUND/,'URI escape sequences are never decoded');
 f.texts.set('scenes/中文 sample.tscn','[gd_scene format=3]\n[node name="Example" type="Node3D"]\n');
 assert.equal((await query(f,{mode:'scene',path:'res://scenes/中文 sample.tscn'})).path,'scenes/中文 sample.tscn');
 for(const setting of ['uid://unknown','res://missing.tscn','res://scripts/reused/camera_rig.gd']){
  f.texts.set('project.godot','[application]\nrun/main_scene="'+setting+'"\n');
  const unknown=await query(f,{mode:'summary'});assert.equal(unknown.mainScene,setting);assert.equal(unknown.mainSceneSourcePath,null);
 }
 readOnly(f);
});
