// Pure parser tests plus a service test over a fake durable store.
// No engine, no Rust binary, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {createProjectQuery,parseScene,parseScript,parseProjectSettings,parseResource,kindOf}=
  require(path.join(root,'plugins/craftmine-world/godot-query.cjs'));

const PROJECT_GODOT=`config_version=5

[application]

config/name="Query Probe"
run/main_scene="res://world.tscn"

[autoload]

Game="*res://autoload/game.gd"

[input]

move_forward={"deadzone": 0.5, "events": []}

[rendering]

renderer/rendering_method="gl_compatibility"
`;

const WORLD_TSCN=`[gd_scene load_steps=3 format=3 uid="uid://abc"]

[ext_resource type="Script" path="res://world.gd" id="1_w"]
[ext_resource type="PackedScene" path="res://player.tscn" id="2_p"]

[node name="World" type="Node3D"]
script = ExtResource("1_w")

[node name="Player" parent="." instance=ExtResource("2_p")]

[node name="HUD" type="CanvasLayer" parent="."]
layer = 1

[connection signal="wave_started" from="." to="." method="_on_wave"]
`;

const WORLD_GD=`class_name WorldRoot
extends Node3D

signal wave_started(index: int)

const MAX_WAVE := 3

@export var damage: float = 12.0
@export_range(0, 10) var accuracy: int = 5
@onready var muzzle: Node3D = $Muzzle
var health: int = 100

func spawn_enemy(count: int) -> void:
\tpass

func _ready() -> void:
\tvar scene := preload("res://weapons/rifle.tres")
`;

const RIFLE_TRES=`[gd_resource type="Resource" script_class="WeaponDefinition" load_steps=2 format=3]

[ext_resource type="Script" path="res://weapons/weapon_definition.gd" id="1_wd"]

[resource]
script = ExtResource("1_wd")
damage = 12.0
`;

test('kindOf classifies source files without guessing',()=>{
  assert.equal(kindOf('world.gd'),'script');
  assert.equal(kindOf('world.tscn'),'scene');
  assert.equal(kindOf('weapon.tres'),'resource');
  assert.equal(kindOf('project.godot'),'settings');
  assert.equal(kindOf('icon.png'),'other');
});

test('parseScene builds the node tree and resolves script attachments',()=>{
  const scene=parseScene(WORLD_TSCN);
  assert.equal(scene.header.load_steps,'3');
  assert.equal(scene.header.format,'3');
  assert.equal(scene.header.uid,'uid://abc');
  assert.equal(scene.extResources.length,2);
  assert.equal(scene.extResources[0].path,'res://world.gd');
  assert.equal(scene.nodes,3);
  assert.equal(scene.connections.length,1);
  assert.equal(scene.connections[0].signal,'wave_started');
  assert.equal(scene.tree.length,1);
  const rootNode=scene.tree[0];
  assert.equal(rootNode.name,'World');
  assert.equal(rootNode.type,'Node3D');
  assert.equal(rootNode.script,'res://world.gd');
  assert.deepEqual(rootNode.children.map(child=>child.name),['Player','HUD']);
  assert.equal(rootNode.children[0].instance,'res://player.tscn');
  assert.equal(rootNode.children[1].propertyCount,1);
  assert.deepEqual(scene.warnings,[]);
});

test('parseScene reports an unknown section and an orphan instead of inventing one',()=>{
  const broken=parseScene('[gd_scene format=3]\n[weird_thing foo="1"]\n[node name="A" type="Node" parent="Missing"]\n');
  assert.ok(broken.warnings.some(warning=>warning.reason==='UNKNOWN_SECTION:weird_thing'));
  assert.ok(broken.warnings.some(warning=>warning.reason.startsWith('ORPHAN_NODE')));
});

test('parseScript extracts the real declared surface',()=>{
  const script=parseScript(WORLD_GD);
  assert.equal(script.className,'WorldRoot');
  assert.equal(script.extends,'Node3D');
  assert.deepEqual(script.signals.map(signal=>signal.name),['wave_started']);
  assert.deepEqual(script.signals[0].args,['index: int']);
  assert.deepEqual(script.constants.map(constant=>constant.name),['MAX_WAVE']);
  assert.deepEqual(script.functions.map(fn=>fn.name),['spawn_enemy','_ready']);
  assert.equal(script.functions[0].returns,'void');
  assert.deepEqual(script.exports.map(entry=>entry.name),['damage','accuracy']);
  assert.deepEqual(script.onready.map(entry=>entry.name),['muzzle']);
  assert.ok(script.variables.some(variable=>variable.name==='health'&&variable.exported===false));
  assert.deepEqual(script.preloads.map(preload=>preload.path),['res://weapons/rifle.tres']);
});

test('parseProjectSettings reads the real identity and inputs',()=>{
  const settings=parseProjectSettings(PROJECT_GODOT);
  assert.equal(settings.configVersion,5);
  assert.equal(settings.name,'Query Probe');
  assert.equal(settings.mainScene,'res://world.tscn');
  assert.deepEqual(settings.autoloads,[{name:'Game',path:'res://autoload/game.gd',line:10}]);
  assert.deepEqual(settings.inputActions,['move_forward']);
  assert.equal(settings.rendering,'gl_compatibility');
});

test('parseResource lists external dependencies',()=>{
  const resource=parseResource(RIFLE_TRES);
  assert.equal(resource.resourceType,'Resource');
  assert.equal(resource.loadSteps,2);
  assert.equal(resource.extResources[0].path,'res://weapons/weapon_definition.gd');
  assert.deepEqual(resource.scriptResourceIds,['1_wd']);
});

// A fake durable store keeps this a logic test: it exercises the query service
// contract, not the Rust storage.
function fakeCore(files){
  const byPath=new Map(files.map(file=>[file.path,file.text]));
  const calls=[];
  return {calls,core:{call:async(method,params)=>{
    calls.push({method,params});
    if(method==='godotProject.index'){
      const list=files.map(file=>({path:file.path,sha256:'a'.repeat(64),bytes:file.text.length}));
      const offset=params.offset||0,limit=params.limit||32;
      const page=list.slice(offset,offset+limit);
      return {format:'craftmine.godot-project/1',worldId:params.worldId,revision:7,manifestHash:'b'.repeat(64),
        baseId:'first-person',engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web',
        files:page,totalFiles:list.length,nextOffset:offset+page.length<list.length?offset+page.length:null,
        status:'source-only',verified:false,applied:false,executionAvailable:false,binaryAssetsAvailable:false};
    }
    if(method==='godotProject.read'){
      const text=byPath.get(params.path);
      if(text===undefined)throw Object.assign(Error('PROJECT_FILE_NOT_FOUND'),{errorCode:'PROJECT_FILE_NOT_FOUND'});
      const chars=Array.from(text),offset=params.offset||0,limit=params.limit||16000;
      const slice=chars.slice(offset,offset+limit).join('');
      const next=offset+Array.from(slice).length;
      return {worldId:params.worldId,revision:7,manifestHash:'b'.repeat(64),path:params.path,
        sha256:'a'.repeat(64),bytes:text.length,offset,text:slice,totalCharacters:chars.length,
        nextOffset:next<chars.length?next:null};
    }
    throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
  }}};
}

const FIXTURE=[{path:'project.godot',text:PROJECT_GODOT},{path:'world.tscn',text:WORLD_TSCN},
  {path:'world.gd',text:WORLD_GD},{path:'weapons/rifle.tres',text:RIFLE_TRES}];

test('query service summarizes the bound project through the durable store',async()=>{
  const {core}=fakeCore(FIXTURE);
  const query=createProjectQuery({core,context:{projectId:'p',sessionId:'s',turnId:'t'},worldId:'alpha'});
  const summary=await query.summary();
  assert.equal(summary.identity.worldId,'alpha');
  assert.equal(summary.identity.revision,7);
  assert.equal(summary.mainScene,'res://world.tscn');
  assert.equal(summary.projectName,'Query Probe');
  assert.equal(summary.totalFiles,4);
  assert.equal(summary.kinds.script,1);
  assert.equal(summary.status,'source-only');
  assert.equal(summary.verified,false);
  assert.equal(summary.untrusted.trust,'untrusted-project-data');
});

test('query service returns the scene tree and script symbols for one file',async()=>{
  const {core}=fakeCore(FIXTURE);
  const query=createProjectQuery({core,context:{projectId:'p',sessionId:'s',turnId:'t'},worldId:'alpha'});
  const scene=await query.scene({path:'world.tscn'});
  assert.equal(scene.tree[0].name,'World');
  assert.equal(scene.sha256,'a'.repeat(64));
  const scripts=await query.scripts({path:'world.gd'});
  assert.equal(scripts.scripts.length,1);
  assert.equal(scripts.scripts[0].className,'WorldRoot');
  assert.deepEqual(scripts.skipped,[]);
});

test('query service finds a symbol across scripts and bounds the scan',async()=>{
  const {core}=fakeCore(FIXTURE);
  const query=createProjectQuery({core,context:{projectId:'p',sessionId:'s',turnId:'t'},worldId:'alpha'});
  const found=await query.find({name:'spawn_enemy'});
  assert.deepEqual(found.matches,[{path:'world.gd',kind:'func',line:13,returns:'void'}]);
  assert.equal(found.scannedFiles,1);
  const none=await query.find({name:'does_not_exist'});
  assert.deepEqual(none.matches,[]);
  await assert.rejects(query.find({name:''}),/INVALID_SYMBOL_NAME/);
});

test('query service reports a missing file rather than inventing content',async()=>{
  const {core}=fakeCore(FIXTURE);
  const query=createProjectQuery({core,context:{projectId:'p',sessionId:'s',turnId:'t'},worldId:'alpha'});
  await assert.rejects(query.scene({path:'missing.tscn'}),/PROJECT_FILE_NOT_FOUND/);
});

test('parseScript separates section annotations from real exports',()=>{
  const script=parseScript('@export_group "Weapons"\n@export var damage: float = 1.0\n@export_category "Misc"\nvar plain: int = 2\n');
  assert.deepEqual(script.exports.map(entry=>entry.name),['damage']);
  assert.equal(script.variables.find(variable=>variable.name==='plain').exported,false);
});

test('parseScript distinguishes preload from run-time load',()=>{
  const script=parseScript('var a := preload("res://a.tres")\nvar b := load("res://b.tres")\n');
  assert.deepEqual(script.preloads.map(entry=>entry.path),['res://a.tres']);
  assert.deepEqual(script.runtimeLoads.map(entry=>entry.path),['res://b.tres']);
});

test('scene query reports its own format and keeps the parse format',async()=>{
  const {core}=fakeCore(FIXTURE);
  const query=createProjectQuery({core,context:{projectId:'p',sessionId:'s',turnId:'t'},worldId:'alpha'});
  const scene=await query.scene({path:'world.tscn'});
  assert.equal(scene.format,'craftmine.godot-scene-query/1');
  assert.equal(scene.parseFormat,'craftmine.scene-parse/1');
});

test('ambiguous parentless roots leave child ownership unresolved',()=>{
  const scene=parseScene('[gd_scene format=3]\n[node name="A" type="Node"]\n[node name="B" type="Node"]\n[node name="C" type="Node" parent="."]\n');
  assert.ok(scene.warnings.some(warning=>warning.reason==='EXTRA_SCENE_ROOT:B'));
  assert.equal(scene.tree[0].children.length,0);
  assert.equal(scene.tree[1].children.length,0);
  assert.equal(scene.detached[0].name,'C');
  assert.ok(scene.warnings.some(warning=>warning.reason==='AMBIGUOUS_NODE_PATH:.'));
});

test('multi-page project listing stays pinned to the first revision',async()=>{
  const calls=[];
  const files=Array.from({length:40},(_,index)=>({path:'f'+index+'.gd',sha256:'a'.repeat(64),bytes:1}));
  const core={call:async(method,params)=>{
    calls.push({method,params});
    if(method!=='godotProject.index')throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
    const offset=params.offset||0,limit=params.limit||32;
    const page=files.slice(offset,offset+limit);
    return {worldId:'alpha',revision:5,manifestHash:'b'.repeat(64),baseId:'first-person',engineVersion:'4.7.2-stable',
      renderer:'gl_compatibility',target:'web',files:page,totalFiles:files.length,
      nextOffset:offset+page.length<files.length?offset+page.length:null,status:'source-only',verified:false,applied:false};
  }};
  const query=createProjectQuery({core,context:{projectId:'p',sessionId:'s',turnId:'t'},worldId:'alpha'});
  const {identity,files:listed}=await query.allFiles();
  assert.equal(identity.revision,5);
  assert.equal(listed.length,40);
  const pages=calls.filter(call=>call.method==='godotProject.index');
  assert.equal(pages.length,2);
  assert.equal(pages[0].params.revision,undefined);
  assert.equal(pages[1].params.revision,5);
  assert.equal(pages[1].params.manifestHash,'b'.repeat(64));
  assert.equal(pages[1].params.offset,32);
});

test('find reports scripts it could not read instead of reporting no match',async()=>{
  const long='var x = 1\n'.repeat(2000);
  const files=[{path:'big.gd',sha256:'a'.repeat(64),bytes:long.length}];
  const core={call:async(method,params)=>{
    if(method==='godotProject.index')return {worldId:'alpha',revision:1,manifestHash:'b'.repeat(64),baseId:'first-person',
      engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web',files,totalFiles:1,nextOffset:null,
      status:'source-only',verified:false,applied:false};
    if(method==='godotProject.read')return {worldId:'alpha',revision:1,manifestHash:'b'.repeat(64),path:'big.gd',
      sha256:'a'.repeat(64),bytes:long.length,offset:0,text:long.slice(0,16000),totalCharacters:long.length,nextOffset:16000};
    throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
  }};
  const query=createProjectQuery({core,context:{projectId:'p',sessionId:'s',turnId:'t'},worldId:'alpha'});
  const result=await query.find({name:'x'});
  assert.deepEqual(result.matches,[]);
  assert.deepEqual(result.skipped,[{path:'big.gd',reason:'FILE_EXCEEDS_READ_CAP'}]);
  assert.equal(result.complete,false);
});
