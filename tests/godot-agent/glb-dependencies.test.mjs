import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {glbDependencies,createManagedPackageSourceService} from '../../plugins/craftmine-world/godot-package-source.mjs';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
function glb(json){const text=Buffer.from(JSON.stringify({asset:{version:'2.0'},...json}));const padding=(4-text.length%4)%4,body=Buffer.concat([text,Buffer.alloc(padding,32)]),head=Buffer.alloc(20);head.writeUInt32LE(0x46546c67);head.writeUInt32LE(2,4);head.writeUInt32LE(20+body.length,8);head.writeUInt32LE(body.length,12);head.writeUInt32LE(0x4e4f534a,16);return Buffer.concat([head,body]);}
test('GLB image paths resolve relative to the model and deduplicate',()=>{
  assert.deepEqual(glbDependencies('models/a.glb',glb({images:[{uri:'Textures/palette.png'},{uri:'Textures/palette.png'},{bufferView:0}]})),['models/Textures/palette.png']);
  assert.deepEqual(glbDependencies('models/a.glb',glb({images:[{uri:'../palette.png'}]})),['palette.png']);
});
test('network, absolute, escaped, encoded and data URIs never become package paths',()=>{
  for(const uri of ['https://evil/p.png','//host/p.png','C:/p.png','../../p.png','%2e%2e/p.png','Textures\\p.png','a.png?query','data:image/png;base64,YQ=='])assert.throws(()=>glbDependencies('models/a.glb',glb({images:[{uri}]})),/PACKAGE_GLB_/);
});
test('external buffers and unsupported texture formats are explicit unsupported gaps',()=>{
  assert.throws(()=>glbDependencies('models/a.glb',glb({buffers:[{uri:'a.bin'}]})),/PACKAGE_GLB_EXTERNAL_BUFFER_UNSUPPORTED/);
  assert.throws(()=>glbDependencies('models/a.glb',glb({images:[{uri:'texture.ktx2'}]})),/PACKAGE_GLB_IMAGE_FORMAT_UNSUPPORTED/);
});
test('malformed container lengths, versions and excessive URI lists are rejected',()=>{
  const short=glb({});short.writeUInt32LE(9999,8);assert.throws(()=>glbDependencies('a.glb',short),/PACKAGE_GLB_INVALID/);
  const version=glb({});version.writeUInt32LE(1,4);assert.throws(()=>glbDependencies('a.glb',version),/PACKAGE_GLB_INVALID/);
  assert.throws(()=>glbDependencies('a.glb',Buffer.from('bad')),/PACKAGE_GLB_INVALID/);
  assert.throws(()=>glbDependencies('a.glb',glb({images:Array.from({length:257},()=>({uri:'a.png'}))})),/PACKAGE_GLB_INVALID/);
});
test('shared base-class GLB dependencies bind external textures in sourceRequirements',async()=>{
 for(const dual of [false,true]){
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const files=new Map(Object.entries({
    'project.godot':Buffer.from('[application]\nrun/main_scene="res://world.tscn"\n'),
    'world.tscn':Buffer.from('[gd_scene load_steps=3 format=3]\n[ext_resource type="Script" path="res://module.gd" id="1"]\n'+(dual?'[ext_resource type="PackedScene" path="res://models/a.glb" id="2"]\n':'')+'[node name="World" type="Node3D"]\n[node name="Module" type="Node3D" parent="."]\nscript = ExtResource("1")\nentity_id = "shared"\n'+(dual?'[node name="Visual" parent="Module" instance=ExtResource("2")]\n':'')),
    'module.gd':Buffer.from('extends SharedBase\n@export var entity_id: String = ""\n'),
    'scripts/core/base.gd':Buffer.from('class_name SharedBase\nextends Node3D\nconst MODEL = preload("res://models/a.glb")\n'),
    'models/a.glb':glb({images:[{uri:'Textures/palette.png'}]}),
    'models/Textures/palette.png':Buffer.from('source requirement test bytes')
  }));
  const manifestHash='a'.repeat(64),call=async(method,args)=>{
    if(method==='godotProject.index')return {worldId:'w',revision:1,manifestHash,baseId:'creation-sandbox',engineVersion:'4.7.2-stable',files:[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),nextOffset:null};
    const bytes=files.get(args.path);return {sha256:hash(bytes),encoding:'base64',bytesBase64:bytes.toString('base64'),nextOffset:null};
  };
  const source=createManagedPackageSourceService({call,bind:async()=>({context:{},worldRecord:{id:'w',world:{snapshot:{}}}})});
  const exported=await source.exportSource({worldId:'w',revision:1,manifestHash,nodePath:'Module',assetId:'shared-copy',version:1});
  const resource=unpackStaticPackage(Buffer.from(exported.archiveBase64,'base64')).resources[0];
  const requirements=resource.manifest.content.entry.sourceRequirements;
  assert.ok(requirements.some(entry=>entry.path==='models/Textures/palette.png'&&entry.sha256===hash(files.get(entry.path))));
  assert.ok(requirements.some(entry=>entry.path==='scripts/core/base.gd'));assert.ok(requirements.some(entry=>entry.path==='models/a.glb'));
  assert.equal(resource.files.has('models/Textures/palette.png'),dual,'dual-use dependency needs both namespaced payload and exact original-path requirement');
 }
});
