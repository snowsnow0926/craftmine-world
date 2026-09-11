import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {buildAssetLock,canonicalLockBytes,assetLockHash,mediaTypeForPath} from '../../plugins/craftmine-world/asset-lock.mjs';
import {requiredModuleParameterPaths,captureModuleParameters,previewModuleParameters} from '../../plugins/craftmine-world/godot-module-parameters.mjs';
import {planSceneInsertion,applySceneInsertion} from '../../desktop/godot/shared/scene_materializer.mjs';
const root=path.resolve(import.meta.dirname,'../..'),hash=b=>createHash('sha256').update(b).digest('hex'),now=Date.parse('2026-09-12T12:00:00Z');
function fixture(kind='building'){
 const resource=unpackStaticPackage(fs.readFileSync(path.join(root,'docs/evidence/gu6-kenney-modules-20260912',kind+'.zip'))).resources[0],id=resource.manifest.content.assetId,installPath='addons/'+id;
 const ref={assetId:id,version:1,contentHash:resource.contentHash},files=new Map([...resource.files].map(([name,bytes])=>[installPath+'/'+name,Buffer.from(bytes)]));
 const lock=buildAssetLock([{asset:{...ref,version:'1'},installPath,files:resource.manifest.content.files.map(file=>({...file,mediaType:mediaTypeForPath(file.path)})),dependencies:[],overrides:[]}]);
 const registry={format:'craftmine.godot-draft-instances/1',worldId:'world-audit',operationId:'installed',assetLockHash:assetLockHash(lock),instances:['a','b'].map(name=>({instanceId:'ins-'+name,...ref,installPath,entityMap:{[kind]:'ins-'+name+'-e0'},localOverrides:[]}))};
 const scene='[gd_scene load_steps=2 format=3]\n\n[ext_resource type="PackedScene" path="res://'+installPath+'/module.tscn" id="1_module"]\n\n[node name="World" type="Node3D"]\n\n[node name="ins-a-e0" parent="." instance=ExtResource("1_module")]\nentity_id = "ins-a-e0"\nposition = Vector3(-4, 0, -4)\nmodel_scale_percent = 150\nquarter_turns = 1\nsolid = true\nlabel = "A"\n\n[node name="ins-b-e0" parent="." instance=ExtResource("1_module")]\nentity_id = "ins-b-e0"\nposition = Vector3(4, 0, -4)\nmodel_scale_percent = 100\nquarter_turns = 0\nsolid = true\nlabel = "B"\n';
 files.set('project.godot',Buffer.from('config_version=5\n[application]\nrun/main_scene="res://scenes/world.tscn"\n'));
 files.set('scenes/world.tscn',Buffer.from(scene));files.set('craftmine.instances.json',Buffer.from(JSON.stringify(registry,null,2)+'\n'));files.set('craftmine.assets.lock.json',canonicalLockBytes(lock));
 const manifestFiles=new Map([...files].map(([name,bytes])=>[name,{path:name,bytes:bytes.length,sha256:hash(bytes)}]));
 // Deliberately omit all binary payload buffers; only Core descriptors remain.
 const texts=new Map([...files].filter(([name])=>['project.godot','scenes/world.tscn','craftmine.instances.json','craftmine.assets.lock.json',installPath+'/module.gd',installPath+'/module.tscn'].includes(name)));
 const source={worldId:'world-audit',revision:3,manifestHash:'f'.repeat(64),manifestFiles,files:texts};
 const target={objectId:'123',nodePath:'ins-a-e0',nodeClass:'StaticBody3D',scriptPath:'res://'+installPath+'/module.gd',scenePath:'res://'+installPath+'/module.tscn',ancestors:[],identityScope:'runtime-instance',sourceUse:'context-only',position:[-4,.5,-4],normal:[0,0,1]};
 const capture={format:'craftmine.creation-target/1',snapshotId:'capture',worldId:source.worldId,buildId:'build-a',instanceId:'runtime-a',sourceRevision:source.revision,manifestHash:source.manifestHash,sceneObjectTarget:target};
 const live={worldId:source.worldId,buildId:capture.buildId,instanceId:capture.instanceId,sampledAt:new Date(now).toISOString(),sceneObjectRefs:[structuredClone(target)]};
 const input={source,capture,live,now};
 const put=(name,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);source.files.set(name,bytes);source.manifestFiles.set(name,{path:name,bytes:bytes.length,sha256:hash(bytes)});};
 return{input,put,scene,registry,lock,ref,installPath,resource};
}
test('actual Kenney package fixtures capture exactly six text dependencies without loading binaries',()=>{
 for(const kind of ['building','road']){
  const f=fixture(kind),plan=requiredModuleParameterPaths({source:{...f.input.source,files:new Map([['project.godot',f.input.source.files.get('project.godot')]])},capture:f.input.capture});
  assert.equal(plan.length,6);assert.ok(plan.every(name=>f.input.source.files.has(name)));
  const result=captureModuleParameters(f.input);
  assert.equal(result.status,'supported');assert.deepEqual(result.binding.resourceRef,f.ref);assert.equal(result.binding.entityId,'ins-a-e0');
  assert.deepEqual(result.values,{model_scale_percent:150,quarter_turns:1,solid:true,label:'A'});
  assert.equal(result.binding.parsedFiles.length,6);assert.ok(result.binding.sharedFiles.some(file=>file.path.endsWith('.glb')));
  assert.equal(result.sharedBinaryEvidence,'core-source-index');assert.equal(result.runtimeValuesVerified,false);assert.equal(result.descriptors.label.visibleRename,false);
  assert.equal(result.saveImpact.progressStateWritten,false);
 }
});
test('the real scene installer output in the stock creation scene is accepted without modifying shared source',()=>{
 const f=fixture(),scenePath='scenes/world.tscn';
 let installed=fs.readFileSync(path.join(root,'desktop/godot/bases/creation-sandbox/scenes/creation.tscn'),'utf8');
 const spec={...f.resource.manifest.content.entry.sceneInstall,sceneFile:f.installPath+'/module.tscn'};
 for(const name of ['a','b']){
  const planned=planSceneInsertion({sceneText:installed,scenePath,spec,entityId:'ins-'+name+'-e0'});
  assert.equal(planned.ok,true);installed=applySceneInsertion(installed,planned.edit);
 }
 f.put(scenePath,installed);
 const result=captureModuleParameters(f.input);assert.equal(result.values.model_scale_percent,100);
 const preview=previewModuleParameters({...f.input,binding:result.binding,changes:{solid:false}});
 assert.equal(preview.operations.length,1);assert.equal(preview.operations[0].path,scenePath);
 assert.equal((preview.operations[0].text.match(/solid = false/g)??[]).length,1);
 assert.equal((preview.operations[0].text.match(/solid = true/g)??[]).length,1);
});
test('preview alters only one parent instance, preserves peer/transform/shared bytes and never mutates input',()=>{
 const f=fixture(),before=new Map([...f.input.source.files].map(([name,b])=>[name,Buffer.from(b)]));
 const captured=captureModuleParameters(f.input),result=previewModuleParameters({...f.input,binding:captured.binding,changes:{model_scale_percent:250,quarter_turns:2,solid:false,label:'A "quoted" 建筑'}});
 assert.equal(result.operations.length,1);const operation=result.operations[0];
 assert.equal(operation.path,'scenes/world.tscn');assert.equal(operation.expectedHash,hash(Buffer.from(f.scene)));
 assert.ok(operation.text.includes('position = Vector3(-4, 0, -4)'));
 const peer=f.scene.slice(f.scene.indexOf('[node name="ins-b-e0"'));assert.equal(operation.text.slice(operation.text.indexOf('[node name="ins-b-e0"')),peer);
 assert.equal(result.changeSummary.sharedResourcesModified,false);assert.equal(result.applied,false);assert.equal(result.checkRequired,true);
 assert.deepEqual(result.proposedValues,{model_scale_percent:250,quarter_turns:2,solid:false,label:'A "quoted" 建筑'});
 for(const [name,bytes]of before)assert.deepEqual(f.input.source.files.get(name),bytes);
 assert.deepEqual(previewModuleParameters({...f.input,binding:captured.binding,changes:{model_scale_percent:150}}).operations,[]);
});
test('known script defaults are explicit provenance and missing override can be inserted with original CRLF',()=>{
 const f=fixture('road');f.put('scenes/world.tscn',f.scene.replace('label = "A"\n','').replace('model_scale_percent = 150\n','').replaceAll('\n','\r\n'));
 const result=captureModuleParameters(f.input);
 assert.equal(result.values.label,'road');assert.equal(result.values.model_scale_percent,100);
 assert.equal(result.valueSources.label.kind,'audited-script-default');
 const preview=previewModuleParameters({...f.input,binding:result.binding,changes:{label:'local'}});
 assert.ok(preview.operations[0].text.includes('label = "local"\r\n'));
 assert.ok(!/(?<!\r)\n/.test(preview.operations[0].text));
});
test('mesh child selection resolves only through its exact live owning module ancestor',()=>{
 const f=fixture(),owner={...f.input.capture.sceneObjectTarget};delete owner.ancestors;
 const target={...owner,objectId:'321',nodePath:'ins-a-e0/Visual/building-small-a',nodeClass:'MeshInstance3D',scriptPath:null,scenePath:null,ancestors:[owner]};
 f.input.capture.sceneObjectTarget=target;f.input.live.sceneObjectRefs=[structuredClone(target)];
 f.input.live.sceneObjectRefs[0].scriptPath='';f.input.live.sceneObjectRefs[0].scenePath='';
 assert.equal(captureModuleParameters(f.input).binding.ownerObjectId,'123');
 f.input.live.sceneObjectRefs[0].ancestors[0].objectId='999';
 assert.throws(()=>captureModuleParameters(f.input),/LIVE_REFERENCE_CHANGED/);
});
test('stale runtime/source/reference/binding and changed actual text refuse before producing edits',()=>{
 for(const mutate of [
  f=>{f.input.live.instanceId='other';},f=>{f.input.live.sampledAt=new Date(now-30001).toISOString();},
  f=>{f.input.source.revision++;},f=>{f.input.live.sceneObjectRefs[0].nodePath='other';},
  f=>{f.input.live.sceneObjectRefs=[];},f=>{f.input.live.sceneObjectRefs.push(structuredClone(f.input.live.sceneObjectRefs[0]));},
  f=>{f.input.source.files.set('scenes/world.tscn',Buffer.from(f.scene+'\n'));},
 ]){
  const f=fixture();mutate(f);assert.throws(()=>captureModuleParameters(f.input),/MODULE_PARAMETERS_/);
 }
 const f=fixture(),captured=captureModuleParameters(f.input);f.put('scenes/world.tscn',f.scene.replace('label = "B"','label = "changed peer"'));
 assert.throws(()=>previewModuleParameters({...f.input,binding:captured.binding,changes:{solid:false}}),/BINDING_CHANGED/);
});
test('duplicate identities, wrong package/path/lock, shared overrides and complex scenes refuse',()=>{
 for(const mutate of [
  f=>f.put('scenes/world.tscn',f.scene.replace('entity_id = "ins-b-e0"','entity_id = "ins-a-e0"')),
  f=>f.put('scenes/world.tscn',f.scene.replace('label = "A"','label = "A"\nlabel = "duplicate"')),
  f=>f.put('scenes/world.tscn',f.scene.replace('label = "A"','\tlabel = "hidden"')),
  f=>f.put('scenes/world.tscn',f.scene.replace('model_scale_percent = 150','model_scale_percent = int(150)')),
  f=>f.put('scenes/world.tscn',f.scene.replace('model_scale_percent = 150','model_scale_percent = 1.5e2')),
  f=>f.put('scenes/world.tscn',f.scene.replace('label = "A"\n','label = "A"\r\n')),
  f=>f.put('scenes/world.tscn',f.scene.replace('[node name="World" type="Node3D"]','[node name="World" instance=ExtResource("1_module")]')),
  f=>f.put('scenes/world.tscn',f.scene+'\n[node name="Visual" parent="ins-a-e0"]\nscale = Vector3(2, 2, 2)\n'),
  f=>{f.registry.instances[0].installPath='addons/other';f.put('craftmine.instances.json',JSON.stringify(f.registry));},
  f=>{f.registry.instances[1].entityMap.building='ins-a-e0';f.put('craftmine.instances.json',JSON.stringify(f.registry));},
  f=>{f.registry.instances[0].localOverrides=['shared'];f.put('craftmine.instances.json',JSON.stringify(f.registry));},
  f=>f.put(f.installPath+'/module.gd',f.input.source.files.get(f.installPath+'/module.gd').toString()+'\n# changed'),
  f=>{const file=[...f.input.source.manifestFiles.values()].find(file=>file.path.endsWith('.glb'));file.sha256='0'.repeat(64);},
 ]){
  const f=fixture();mutate(f);assert.throws(()=>captureModuleParameters(f.input),/MODULE_PARAMETERS_/);
 }
});
test('only four bounded scalar changes are accepted, identity/shared paths/configure/transform cannot be requested',()=>{
 const f=fixture(),binding=captureModuleParameters(f.input).binding;
 for(const changes of [{entity_id:'forged'},{position:[0,0,0]},{script:'evil.gd'},{material_override:{}},{configure:{}},{model_scale_percent:801},{quarter_turns:0.5},{solid:1},{label:'x'.repeat(81)},{label:'a\nb'},{}])
  assert.throws(()=>previewModuleParameters({...f.input,binding,changes}),/CHANGE_FIELDS_REFUSED|VALUE_INVALID/);
 const missing=fixture();missing.input.source.files.delete(missing.installPath+'/module.gd');
 assert.throws(()=>captureModuleParameters(missing.input),error=>error.code==='MODULE_PARAMETERS_SOURCE_TEXT_REQUIRED'&&error.requiredPaths[0]===missing.installPath+'/module.gd');
});
test('capture and preview use only supplied bytes and deterministic bindings, with no filesystem calls',()=>{
 const f=fixture(),oldRead=fs.readFileSync,oldWrite=fs.writeFileSync;
 try{
  fs.readFileSync=()=>assert.fail('no reads');fs.writeFileSync=()=>assert.fail('no writes');
  const a=captureModuleParameters(f.input),b=captureModuleParameters({...f.input,source:{...f.input.source,manifestFiles:[...f.input.source.manifestFiles.values()].reverse()}});
  assert.deepEqual(a.binding,b.binding);
  const preview=previewModuleParameters({...f.input,binding:a.binding,changes:{label:'scope-only'}});
  assert.equal(preview.applied,false);assert.equal(preview.operations.length,1);
 }finally{fs.readFileSync=oldRead;fs.writeFileSync=oldWrite;}
});
