import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createModuleParameterQuery,validateModuleParameterQuery}=require('../../plugins/craftmine-world/godot-module-parameter-query.cjs');
const {buildInventory}=require('../../plugins/craftmine-world/godot-capability.cjs');
const {LOCAL_TOOLS}=require('../../plugins/craftmine-world/godot-routing.cjs');
const manifest=require('../../plugins/craftmine-world/manifest.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),pin={worldId:'module-world',revision:1,manifestHash:'a'.repeat(64)},bindingHash='b'.repeat(64);
const names=['project.godot','main.tscn','craftmine.instances.json','craftmine.assets.lock.json','module.tscn','module.gd'];
function fixture(fault){
 const files=new Map(names.map(name=>[name,Buffer.from(name==='project.godot'?'run/main_scene="res://main.tscn"':'source-'+name)]));
 const entries=[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}));entries.push({path:'large.glb',bytes:20*1024*1024,sha256:'c'.repeat(64)});
 const calls=[];let indexes=0,previews=0;
 const core={call:async(method,args)=>{calls.push({method,args});
  if(method==='task.context')return {world:{id:pin.worldId}};
  if(method==='godotProject.index'){indexes++;return {...pin,...(fault==='head-moved'&&indexes>2?{revision:2}:{}),baseId:'creation-sandbox',totalFiles:entries.length,files:args.limit===1?entries.slice(0,1):fault==='short-page'?entries.slice(0,-1):entries,nextOffset:args.limit===1?1:null};}
  if(method==='godotProject.read'){assert.ok(files.has(args.path),'binary or unknown file must not be read');const bytes=files.get(args.path);return {...pin,path:args.path,sha256:fault==='bad-hash'?'f'.repeat(64):hash(bytes),text:bytes.toString(),nextOffset:null};}
  throw Error('UNEXPECTED_WRITE_OR_METHOD:'+method);
 }};
 const capture={format:'craftmine.creation-target/1',worldId:pin.worldId,sourceRevision:1,manifestHash:pin.manifestHash,buildId:'build',instanceId:'instance',snapshotId:'capture',sceneObjectTarget:{objectId:'123'}};
 const helper={requiredModuleParameterPaths:({source})=>{assert.equal(source.files.size,1);return names;},captureModuleParameters:({source,live})=>{assert.equal(source.files.size,6);assert.equal(source.manifestFiles.size,7);assert.deepEqual(live.sceneObjectRefs,[{objectId:'123'}]);return {binding:{bindingHash},values:{label:'old'}};},previewModuleParameters:()=>{previews++;return {operations:[{op:'put',path:'main.tscn',text:'new',expectedHash:hash(files.get('main.tscn'))}]};}};
 const execute=createModuleParameterQuery({core,capture:async()=>capture,sample:async()=>({worldId:pin.worldId,buildId:'build',instanceId:'instance',sampledAt:new Date().toISOString(),creation:{sceneObjectRefs:[{objectId:'123'}]}}),loadHelper:async()=>helper});
 return {execute,calls,get previews(){return previews;}};
}

test('module loader reads only required text and fresh identities, never binaries or source writes',async()=>{
 const f=fixture();const result=await f.execute({context:{},args:{mode:'module-parameters'}});
 assert.equal(result.applied,false);assert.equal(result.runtimeSafety.status,'not-assessed');
 assert.equal(f.calls.filter(c=>c.method==='godotProject.read').length,6);
 assert.ok(f.calls.every(c=>['task.context','godotProject.index','godotProject.read'].includes(c.method)));
 const preview=await f.execute({context:{},args:{mode:'module-parameter-preview',bindingHash,changes:{solid:false}}});
 assert.equal(f.previews,1);assert.equal(preview.operations.length,1);assert.equal(preview.applied,false);
});

test('missing index entries, changed bytes and a moved head cannot produce a parameter capture',async()=>{
 for(const fault of ['short-page','bad-hash','head-moved'])await assert.rejects(fixture(fault).execute({context:{},args:{mode:'module-parameters'}}));
});

test('a stale binding and caller authority fields cannot produce a patch proposal',async()=>{
 const f=fixture();await assert.rejects(f.execute({context:{},args:{mode:'module-parameter-preview',bindingHash:'f'.repeat(64),changes:{label:'new'}}}),/MODULE_PARAMETER_BINDING_CHANGED/);assert.equal(f.previews,0);
 for(const args of [{mode:'module-parameters',worldId:'forged'},{mode:'module-parameters',revision:3},{mode:'module-parameter-preview',bindingHash,changes:{entity_id:'changed'}},{mode:'module-parameter-preview',bindingHash,changes:{model_scale_percent:801}}])assert.throws(()=>validateModuleParameterQuery(args));
 assert.doesNotThrow(()=>validateModuleParameterQuery({mode:'module-parameter-preview',bindingHash,changes:{label:'🌳'.repeat(80)}}));
 for(const label of ['🌳'.repeat(81),'bad\nlabel','bad\u0000label'])assert.throws(()=>validateModuleParameterQuery({mode:'module-parameter-preview',bindingHash,changes:{label}}));
});

test('module modes expose missing capture wiring and leave per-target readiness unverified',()=>{
 const inspect=(services,sessionDrafts=true)=>buildInventory({manifest,localTools:LOCAL_TOOLS,handshake:{godotProjects:true,sessionDrafts},executionContext:{worldId:pin.worldId},services}).tools.find(t=>t.name==='godot_project_query');
 const missing=inspect({wired:[]});assert.equal(missing.modes.find(m=>m.mode==='summary').reachable,true);
 assert.equal(missing.modes.find(m=>m.mode==='module-parameters').reachable,false);
 const wired=inspect({wired:[{key:'creationTarget'},{key:'sampleLiveState'}]}).modes.find(m=>m.mode==='module-parameter-preview');
 assert.equal(wired.reachable,true);assert.equal(wired.executionReadiness.available,null);assert.equal(wired.requiresValidatedCapture,true);
 const services={wired:[{key:'creationTarget'},{key:'sampleLiveState'}]};
 for(const enabled of [false,null]){
  const result=inspect(services,enabled),module=result.modes.find(m=>m.mode==='module-parameters');
  assert.equal(module.reachable,false);assert.equal(result.modes.find(m=>m.mode==='summary').reachable,true);
  assert.equal(module.executionReadiness.available,false);assert.equal(module.executionReadiness.reason,'CAPABILITY_DISABLED');
 }
 const unknown=buildInventory({manifest,localTools:LOCAL_TOOLS,handshake:{godotProjects:true},executionContext:{worldId:pin.worldId},services}).tools.find(t=>t.name==='godot_project_query');
 assert.equal(unknown.modes.find(m=>m.mode==='module-parameters').reachable,null);
});
