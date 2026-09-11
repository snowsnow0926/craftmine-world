import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createManagedPackageInstaller,createManagedPackageSourceService} from '../../plugins/craftmine-world/reuse-service.mjs';
import {packStaticPackage,unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../plugins/craftmine-world/package-format.mjs';
import {resolveInstanceParameterDeclaration} from '../../plugins/craftmine-world/godot-instance-declaration.mjs';
import {parseScene} from '../../desktop/godot/shared/scene_materializer.mjs';
const root=path.resolve(import.meta.dirname,'../..'),hash=value=>createHash('sha256').update(value).digest('hex');
const script='extends Node3D\n@export var entity_id: String = ""\n@export var percent: int = 100\n@export var label: String = "default"\n';
const payload={'module.gd':Buffer.from(script),'module.gd.uid':Buffer.from('uid://b01234567890\n'),'module.tscn':Buffer.from('[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://addons/declared-module/module.gd" id="1"]\n[node name="Module" type="Node3D"]\nscript = ExtResource("1")\n')};
const parameters={percent:{type:'integer',minimum:25,maximum:800,description:'Scale percentage declared by source'},label:{type:'string',maxLength:80,description:'State label; not a visible name guarantee'}};
const content={assetId:'declared-module',version:1,kind:'module',files:Object.entries(payload).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),dependencies:[],entry:{entities:['module'],sceneInstall:{mode:'instance',sceneFile:'module.tscn',identityField:'entity_id',identityType:'string',exports:{percent:100,label:'default'}}},interfaces:{parameters},compatibility:{},state:{},licenses:{}};
const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)};
const archive=packStaticPackage({root:{id:content.assetId,version:1},resources:[{manifest,files:payload}]}).toString('base64');
const project='config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n';
const blank='[gd_scene format=3]\n[node name="World" type="Node3D"]\n';
function fakeWorld(name,directory){
 const files=new Map([['project.godot',Buffer.from(project)],['world.tscn',Buffer.from(blank)]]);let revision=0,sequence=0;const calls=[];
 const context={projectId:name,sessionId:name,turnId:name};
 const pin=()=>hash(JSON.stringify([...files].map(([p,b])=>[p,hash(b)])));
 const call=async(method,args)=>{
  calls.push(method);
  if(method==='godotProject.index')return {worldId:name,revision,manifestHash:pin(),baseId:'first-person',engineVersion:'4.7.2-stable',files:[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),nextOffset:null};
  if(method==='godotProject.read'){const bytes=files.get(args.path);return {sha256:hash(bytes),encoding:'base64',bytesBase64:bytes.toString('base64'),nextOffset:null};}
  if(method==='package.planInstall'){
   const resource=args.resources[0],c=resource.content,id='ins-'+name+'-'+(++sequence),entityMap=Object.fromEntries(c.entry.entities.map(key=>[key,id+'-e0']));
   return {ok:true,applied:false,operationId:args.operationId,worldId:name,instances:[{instanceId:id,assetId:c.assetId,version:c.version,contentHash:resource.contentHash,installPath:'addons/'+c.assetId,entityMap,localOverrides:[]}],lock:{format:'craftmine.assets-lock/1',assets:[{asset:{assetId:c.assetId,version:String(c.version),contentHash:resource.contentHash},installPath:'addons/'+c.assetId,files:c.files.map(f=>({...f,mediaType:'application/octet-stream'})),dependencies:[],overrides:[]}]}};
  }
  if(method==='godotProject.applyFiles'){for(const file of args.files)files.set(file.path,Buffer.from(file.bytesBase64,'base64'));revision++;return {revision,manifestHash:pin()};}
  if(method==='godotBuild.start')return {jobId:'gjob-'+hash(name+revision),worldId:name,status:'blocked'};
  throw Error('UNEXPECTED '+method);
 };
 const bind=async(worldId,operationId)=>({context,worldRecord:{id:name,world:{snapshot:{baseVersion:'1.0.0'}}},operation:{worldId,operationId}});
 const installer=createManagedPackageInstaller({call,bind,enqueue:async()=>{throw Error('No engine');},stagingRoot:path.join(directory,name)});
 const source=createManagedPackageSourceService({call,bind});
 const selected=()=>parseScene(files.get('world.tscn').toString()).nodes.find(n=>n.parent!==null);
 const exportOne=()=>source.exportSource({worldId:name,revision,manifestHash:pin(),nodePath:selected().name,assetId:'exported-'+name,version:1});
 const declaration=()=>resolveInstanceParameterDeclaration({worldId:name,files,mainScene:'world.tscn',nodePath:selected().name});
 return {files,calls,installer,source,exportOne,declaration,selected};
}
test('install -> local source override -> export -> second world preserves original declarations and values',async()=>{
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const directory=fs.mkdtempSync(path.join(root,'test-results/parameter-roundtrip-'));
 const a=fakeWorld('a',directory),b=fakeWorld('b',directory);
 await a.installer({worldId:'a',operationId:'install-one',archiveBase64:archive});
 const map=JSON.parse(a.files.get('craftmine.instances.json'));assert.deepEqual(map.instances[0].sourceDeclaration.resource,manifest);
 a.files.set('world.tscn',Buffer.from(a.files.get('world.tscn').toString().replace('percent = 100','percent = 250').replace('label = "default"','label = "local A"')));
 const exported=await a.exportOne();assert.equal(exported.parameterDeclaration.status,'source-declared');assert.deepEqual(exported.parameterDeclaration.parameters,parameters);assert.equal(exported.parameterDeclaration.resourceRef.contentHash,manifest.contentHash);
 const unpacked=unpackStaticPackage(Buffer.from(exported.archiveBase64,'base64')).resources[0];assert.deepEqual(unpacked.manifest.content.interfaces.parameters,parameters);
 const exportedNode=parseScene(unpacked.files.get('_craftmine_component.tscn').toString()).nodes[0];assert.equal(exportedNode.properties.percent,'250');assert.equal(exportedNode.properties.label,'"local A"');
 await b.installer({worldId:'b',operationId:'install-two',archiveBase64:exported.archiveBase64});
 assert.deepEqual(b.declaration().parameters,parameters);assert.notEqual(a.selected().properties.entity_id,b.selected().properties.entity_id);
 const again=await b.exportOne();assert.deepEqual(unpackStaticPackage(Buffer.from(again.archiveBase64,'base64')).resources[0].manifest.content.interfaces.parameters,parameters);
 assert.ok([...b.files.values()].some(value=>value.toString().includes('percent = 250')));
 map.futureMetadata={retained:true};map.instances[0].futureField={retained:true};a.files.set('craftmine.instances.json',Buffer.from(JSON.stringify(map)));
 await a.installer({worldId:'a',operationId:'install-peer',archiveBase64:archive});
 const appended=JSON.parse(a.files.get('craftmine.instances.json'));assert.deepEqual(appended.futureMetadata,{retained:true});assert.deepEqual(appended.instances[0].futureField,{retained:true});assert.deepEqual(appended.instances[0].sourceDeclaration.resource,manifest);
});
test('legacy absence stays unknown; wrong world/ref/hash, wrapper and managed source never reuse declarations',async()=>{
 const directory=fs.mkdtempSync(path.join(root,'test-results/parameter-negative-'));const a=fakeWorld('neg',directory);await a.installer({worldId:'neg',operationId:'install',archiveBase64:archive});
 const baseline=new Map([...a.files].map(([key,value])=>[key,Buffer.from(value)]));const reset=()=>{a.files.clear();for(const [key,value]of baseline)a.files.set(key,Buffer.from(value));};
 a.files.delete('craftmine.instances.json');assert.equal(a.declaration().status,'unknown');assert.deepEqual(unpackStaticPackage(Buffer.from((await a.exportOne()).archiveBase64,'base64')).resources[0].manifest.content.interfaces,{});
 reset();let map=JSON.parse(a.files.get('craftmine.instances.json'));delete map.instances[0].sourceDeclaration;a.files.set('craftmine.instances.json',Buffer.from(JSON.stringify(map)));assert.equal(a.declaration().status,'unknown');
 for(const mutate of [m=>m.worldId='foreign',m=>m.instances[0].contentHash='f'.repeat(64),m=>m.instances[0].sourceDeclaration.resource.content.interfaces.parameters.percent.maximum=999,m=>m.instances[0].sourceDeclaration.managedFiles[0].sha256='f'.repeat(64),m=>m.instances[0].installPath='addons/foreign']){
  reset();map=JSON.parse(a.files.get('craftmine.instances.json'));mutate(map);a.files.set('craftmine.instances.json',Buffer.from(JSON.stringify(map)));await assert.rejects(a.exportOne(),/PACKAGE_(DECLARATION|INSTANCE)_/);
 }
 reset();a.files.set('addons/declared-module/module.gd',Buffer.from(script+'# changed wrapper\n'));await assert.rejects(a.exportOne(),/PACKAGE_DECLARATION_INSTALLED_SOURCE_CHANGED/);
 reset();a.files.set('world.tscn',Buffer.from(a.files.get('world.tscn').toString().replace('res://addons/declared-module/module.tscn','res://other.tscn')));await assert.rejects(a.exportOne(),/PACKAGE_DECLARATION_WRAPPER_CHANGED/);
});

const binary=process.env.CRAFTMINE_CORE_BIN;
test('real Core source transactions preserve declaration and local override into a second world',{skip:binary?false:'CRAFTMINE_CORE_BIN required'},async t=>{
 const require=createRequire(import.meta.url),{CoreClient}=require('../../plugins/craftmine-world/core-client.cjs');
 const directory=fs.mkdtempSync(path.join(root,'test-results/parameter-core-')),core=new CoreClient(binary,path.join(directory,'data'));t.after(()=>core.stop());await core.start();
 const contexts=Object.fromEntries(['a','b'].map(id=>[id,{projectId:'decl-'+id,sessionId:'decl-'+id,turnId:'one'}]));const call=(method,args)=>core.call(method,args);
 for(const id of ['a','b']){await call('world.create',{id,title:id,world:{build:{id:'base-'+id,scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});await call('workspace.open',{context:contexts[id],selectedWorld:id});await call('godotProject.create',{worldId:id,context:contexts[id],toolCallId:'create',baseBuild:'base-'+id,baseId:'first-person',files:[{path:'project.godot',text:project},{path:'world.tscn',text:blank}]});await call('content.migrate.apply',{worldId:id});}
 const bind=async(worldId,operationId)=>{const status=await call('content.status',{worldId}),worldRecord=await call('world.read',{id:worldId});return {context:contexts[worldId],worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:'main',expectedHeadOid:status.headOid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};};
 const install=createManagedPackageInstaller({call,bind,enqueue:async()=>{throw Error('No engine requested');},stagingRoot:path.join(directory,'staging')}),source=createManagedPackageSourceService({call,bind});
 const first=await install({worldId:'a',operationId:'install-a',archiveBase64:archive});assert.equal(first.status,'source-saved-check-blocked');
 const read=await call('godotProject.read',{context:contexts.a,worldId:'a',revision:first.source.revision,manifestHash:first.source.manifestHash,path:'world.tscn',offset:0,limit:16000});
 const modified=await call('godotProject.patch',{context:contexts.a,worldId:'a',toolCallId:'local-override',operation:(await bind('a','modify-a')).operation,revision:first.source.revision,manifestHash:first.source.manifestHash,operations:[{op:'put',path:'world.tscn',expectedHash:read.sha256,text:read.text.replace('percent = 100','percent = 250').replace('label = "default"','label = "local A"')}]});
 const listed=await source.listSource({worldId:'a'});const exported=await source.exportSource({worldId:'a',revision:listed.revision,manifestHash:listed.manifestHash,nodePath:listed.items[0].nodePath,assetId:'core-exported',version:1});assert.deepEqual(exported.parameterDeclaration.parameters,parameters);
 const second=await install({worldId:'b',operationId:'install-b',archiveBase64:exported.archiveBase64});assert.equal(second.status,'source-saved-check-blocked');
 const bList=await source.listSource({worldId:'b'}),bExport=await source.exportSource({worldId:'b',revision:bList.revision,manifestHash:bList.manifestHash,nodePath:bList.items[0].nodePath,assetId:'core-exported-again',version:1});assert.deepEqual(bExport.parameterDeclaration.parameters,parameters);
 const importedMap=await call('godotProject.read',{context:contexts.b,worldId:'b',revision:bList.revision,manifestHash:bList.manifestHash,path:'craftmine.instances.json',offset:0,limit:16000});const saved=JSON.parse(importedMap.text);assert.deepEqual(saved.instances[0].sourceDeclaration.resource.content.interfaces.parameters,parameters);
 const bArchive=unpackStaticPackage(Buffer.from(bExport.archiveBase64,'base64'));assert.ok([...bArchive.resources[0].files.values()].some(bytes=>bytes.toString().includes('percent = 250')));
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({passed:true,binary,coreSha256:hash(fs.readFileSync(binary)),originalResourceHash:manifest.contentHash,first,modified,exported:{archiveSha256:exported.archiveSha256,parameterDeclaration:exported.parameterDeclaration},second,secondDeclaration:bExport.parameterDeclaration,scope:'Real Core source transactions; checks blocked without executor; no engine, model, runtime or player acceptance'},null,2));console.log('parameter_core_evidence='+path.join(directory,'report.json'));
});
