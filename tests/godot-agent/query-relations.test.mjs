import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {parseScene,parseScript,parseResource,parseProjectSettings,createProjectQuery}=require('../../plugins/craftmine-world/godot-query.cjs');
const sha=text=>createHash('sha256').update(text).digest('hex');
const sceneText=`[gd_scene format=3]
[ext_resource type="PackedScene" path="res://base.tscn" id="base"]
[ext_resource type="Script" path="res://actor.gd" id="script"]
[ext_resource type="PackedScene" path="res://part.tscn" id="part"]
[ext_resource type="Material" path="res://paint.tres" id="paint"]
[sub_resource type="BoxMesh" id="mesh"]
material = ExtResource("paint")
[node name="Derived" instance=ExtResource( "base" )]
script = ExtResource("script")
[node name="A" type="Node" parent="."]
[node name="Door" type="Node" parent="A"]
[node name="B" type="Node" parent="."]
[node name="Door" type="Node" parent="B"]
[node name="Piece" parent="." instance=ExtResource("part")]
[node name="Mesh" type="MeshInstance3D" parent="."]
mesh = SubResource("mesh")
[connection signal="opened" from="A/Door" to="B/Door" method="_receive"]
[connection signal="ready" from="InheritedChild" to="." method="_ready"]`;
const settingsText=`config_version=5
[application]
config/name="Relations"
run/main_scene="res://world.tscn"
[input]
jump={
"deadzone": 0.25,
"events": [Object(InputEventKey,"physical_keycode":32)]
}
left={"deadzone": 0.5, "events": []}
right={"deadzone": 0.5, "events": []}
`;
const scriptText=`extends "res://base_actor.gd"
# preload("res://comment.tres")
var description = 'load("res://string.tres")'
var prose = """
class_name FakeClass
func fake(): pass
Input.is_action_pressed("fake")
"""
var resource = preload("res://paint.tres")
func _process(_dt):
    Input.is_action_pressed(&"jump")
    Input.get_axis("left", "right")
    Input.is_action_just_pressed("ui_accept")
    Input.is_action_pressed(action_name)
    load(dynamic_path)
    add_child(Node.new())
`;
const resourceText=`[gd_resource type="Material" format=3]
[ext_resource type="Shader" path="res://paint.gdshader" id="shader"]
[sub_resource type="GradientTexture1D" id="gradient"]
[resource]
shader = ExtResource("shader")
shader_parameter/ramp = SubResource("gradient")
metadata/note = "ExtResource(\"not-real\")"
; script = ExtResource("fake-script")
`;
function store(contents,changeRead=()=>{}){
  const rows=Object.entries(contents).map(([path,text])=>({path,text,sha256:sha(text)})),calls=[];
  const pin={revision:7,manifestHash:'a'.repeat(64)};
  const core={call:async(method,args)=>{
    calls.push({method,args});
    if(method==='godotProject.index'){
      const offset=args.offset??0,limit=args.limit??32,files=rows.slice(offset,offset+limit).map(({path,sha256,text})=>({path,sha256,bytes:Buffer.byteLength(text)}));
      return {worldId:'alpha',...pin,files,totalFiles:rows.length,nextOffset:offset+files.length<rows.length?offset+files.length:null};
    }
    if(method==='godotProject.read'){
      const row=rows.find(row=>row.path===args.path);assert.ok(row,'only indexed paths may be read');
      const chars=Array.from(row.text),text=chars.slice(args.offset,args.offset+args.limit).join(''),end=args.offset+Array.from(text).length;
      const page={worldId:'alpha',...pin,path:row.path,sha256:row.sha256,bytes:Buffer.byteLength(row.text),text,offset:args.offset,totalCharacters:chars.length,nextOffset:end<chars.length?end:null};
      changeRead(page);return page;
    }
    throw Error('unexpected host mutation '+method);
  }};
  return {core,calls,pin,make:options=>createProjectQuery({core,worldId:'alpha',context:{projectId:'p',sessionId:'s',turnId:'t'},...options})};
}
const content=()=>({'project.godot':settingsText,'world.tscn':sceneText,'base.tscn':'[gd_scene format=3]\n[node name="Base" type="Node"]',
  'part.tscn':'[gd_scene format=3]\n[node name="Part" type="Node"]','actor.gd':scriptText,'base_actor.gd':'extends Node\n',
  'paint.tres':resourceText,'paint.gdshader':'shader_type spatial;\n'});

test('inherited scenes, instances, same names under distinct parents and signal endpoints remain source declarations',()=>{
  const parsed=parseScene(sceneText);
  assert.deepEqual(parsed.instances.map(item=>[item.nodePath,item.relation,item.path]),[['.','scene-inheritance','res://base.tscn'],['Piece','scene-instance','res://part.tscn']]);
  assert.equal(parsed.analysisScope.runtimeTree,'unknown');assert.equal(parsed.analysisScope.inheritedContentsExpanded,false);
  assert.equal(parsed.connectionRefs[0].fromRef.path,'A/Door');assert.equal(parsed.connectionRefs[0].toRef.path,'B/Door');
  assert.equal(parsed.connectionRefs[0].fromRef.status,'declared');assert.equal(parsed.connectionRefs[1].fromRef.status,'unknown');
  assert.equal(parsed.connectionRefs[1].fromRef.reason,'INHERITED_OR_INSTANCED_CONTENT_NOT_EXPANDED');
  assert.equal(parsed.connectionRefs[1].fromRef.possibleInstanceSources[0].resourcePath,'res://base.tscn');
  assert.equal(parsed.connectionRefs[1].toRef.script,'res://actor.gd');
  assert.equal(parsed.connectionRefs[0].methodResolution,'unknown');
  assert.ok(parsed.resourceLinks.some(item=>item.ownerKind==='sub_resource'&&item.targetPath==='res://paint.tres'));
  assert.ok(parsed.resourceLinks.some(item=>item.ownerNodePath==='Mesh'&&item.targetKind==='SubResource'&&item.resolution==='declared'));
});

test('duplicate serialized node paths never select the final duplicate as parent or signal endpoint',()=>{
  const scene=parseScene('[gd_scene format=3]\n[node name="Root" type="Node"]\n[node name="Door" type="Node" parent="."]\n[node name="Door" type="Node" parent="."]\n[node name="Button" type="Node" parent="Door"]\n[connection signal="ready" from="Door" to="." method="_ready"]');
  assert.ok(scene.warnings.some(item=>item.reason==='AMBIGUOUS_NODE_PATH:Door'));
  assert.ok(scene.tree[0].children.every(item=>item.children.length===0));
  assert.equal(scene.detached[0].path,'Door/Button');
  assert.equal(scene.connectionRefs[0].fromRef.status,'ambiguous');
  assert.equal(scene.connectionRefs[0].fromRef.lines.length,2);
});

test('out of order declared nodes associate by path and duplicate external IDs stay ambiguous',()=>{
  const parsed=parseScene('[gd_scene format=3]\n[ext_resource type="Script" path="res://a.gd" id="s"]\n[ext_resource type="Script" path="res://b.gd" id="s"]\n[node name="Root" type="Node"]\nscript=ExtResource("s")\n[node name="Child" type="Node" parent="Parent"]\n[node name="Parent" type="Node" parent="."]');
  assert.equal(parsed.tree[0].children[0].children[0].path,'Parent/Child');
  assert.equal(parsed.tree[0].script,null);assert.equal(parsed.resourceLinks[0].resolution,'ambiguous');
  assert.ok(parsed.warnings.some(item=>item.reason==='AMBIGUOUS_EXTERNAL_RESOURCE_ID:s'));
});

test('comments and quoted prose cannot invent script dependencies, classes or input actions',()=>{
  const parsed=parseScript(scriptText);
  assert.equal(parsed.className,null);assert.deepEqual(parsed.functions.map(item=>item.name),['_process']);
  assert.deepEqual(parsed.preloads.map(item=>item.path),['res://paint.tres']);assert.deepEqual(parsed.runtimeLoads,[]);
  assert.deepEqual(parsed.inputActionReferences.map(item=>item.name),['jump','left','right','ui_accept']);
  assert.equal(parsed.dynamicLoads.length,1);assert.equal(parsed.dynamicInputCalls.length,1);
  assert.equal(parsed.inheritance.path,'res://base_actor.gd');assert.equal(parsed.analysisScope.dynamicConstruction,'unknown');
  const scoped=parseScript('extends "res://root.gd" # root parent\nclass Inner:\n    extends "res://inner.gd"\n');
  assert.equal(scoped.inheritance.path,'res://root.gd');
  assert.equal(parseScript("var x=preload('res://bad\\q.tres')").dynamicLoads.length,1);
});

test('InputMap multiline definitions preserve complete serialized values without claiming runtime bindings',()=>{
  const parsed=parseProjectSettings(settingsText);
  assert.deepEqual(parsed.inputActions,['jump','left','right']);
  const jump=parsed.inputActionDefinitions.find(item=>item.name==='jump');
  assert.equal(jump.complete,true);assert.equal(jump.deadzone,'0.25');assert.deepEqual(jump.eventTypes,['InputEventKey']);
  assert.match(jump.raw,/physical_keycode/);assert.equal(jump.endLine-jump.line,3);assert.equal(jump.runtimeBinding,'unknown');
  assert.equal(parseProjectSettings('[input]\nbroken={\n"events": [').inputActionDefinitions[0].complete,false);
  const duplicate=parseProjectSettings('[input]\njump={"events":[]}\njump={"events":[]}');
  assert.equal(duplicate.inputActionDefinitions[0].complete,false);assert.equal(duplicate.warnings[0].reason,'DUPLICATE_SETTING:input/jump');
  assert.deepEqual(parseProjectSettings('[input]\n"jump action"={"events":[]}').inputActions,['jump action']);
});

test('resource relations retain subresource and external property owners without fake quoted references',()=>{
  const parsed=parseResource(resourceText);
  assert.equal(parsed.resourceLinks.length,2);assert.deepEqual(parsed.scriptResourceIds,[]);
  assert.equal(parsed.resourceLinks[0].property,'shader');assert.equal(parsed.resourceLinks[0].targetPath,'res://paint.gdshader');
  assert.equal(parsed.resourceLinks[1].targetKind,'SubResource');assert.equal(parsed.resourceLinks[1].resolution,'declared');
  assert.equal(parsed.analysisScope.relationsComplete,false);
});

test('scene, resource and script links use one pinned manifest without recursively reading dependencies',async()=>{
  const f=store(content());
  const scene=await f.make().scene({path:'world.tscn'});
  assert.equal(scene.instances[0].sourceReference.sha256,sha(content()['base.tscn']));
  assert.equal(scene.instances[0].sourceReference.contentsRead,false);
  assert.equal(scene.connectionRefs[1].toRef.scriptSourceReference.sha256,sha(scriptText));
  assert.deepEqual(f.calls.filter(item=>item.method==='godotProject.read').map(item=>item.args.path),['world.tscn']);
  const resource=await f.make().resources({path:'paint.tres'});
  assert.equal(resource.resources[0].resourceLinks[0].sourceReference.sha256,sha(content()['paint.gdshader']));
  const scripts=await f.make().scripts({path:'actor.gd'}),actor=scripts.scripts[0];
  assert.equal(actor.inheritance.sourceReference.sha256,sha(content()['base_actor.gd']));
  assert.equal(actor.preloads[0].sourceReference.sha256,sha(resourceText));
  assert.equal(actor.inputActionReferences[0].projectSettings.status,'declared');
  assert.equal(actor.inputActionReferences[0].projectSettings.sha256,sha(settingsText));
  assert.equal(actor.inputActionReferences.at(-1).projectSettings.status,'not-in-project-settings');
  assert.equal(actor.inputActionReferences.at(-1).projectSettings.runtimeBinding,'unknown');
  for(const call of f.calls.filter(item=>item.method==='godotProject.read')){assert.equal(call.args.revision,7);assert.equal(call.args.manifestHash,f.pin.manifestHash);}
});

test('unindexed/UID references, truncated settings and hash mismatches never become authoritative links',async()=>{
  const files=content();files['world.tscn']=sceneText.replace('res://base.tscn','uid://missing');
  const f=store(files);assert.equal((await f.make().scene({path:'world.tscn'})).instances[0].sourceReference.status,'unknown');
  files['project.godot']=';'+ 'x'.repeat(1000)+'\n'+settingsText;
  const limited=store(files),result=await limited.make({readLimit:800}).scripts({path:'actor.gd'});
  assert.equal(result.scripts[0].inputActionReferences[0].projectSettings.status,'unknown');
  assert.equal(result.scripts[0].inputActionReferences[0].projectSettings.reason,'SETTINGS_EXCEEDS_READ_CAP');
  const changed=store(content(),page=>{if(page.path==='project.godot')page.sha256='f'.repeat(64);});
  await assert.rejects(changed.make().scripts({path:'actor.gd'}),/PROJECT_QUERY_IDENTITY_MISMATCH/);
  const sceneChanged=store(content(),page=>{if(page.path==='world.tscn')page.sha256='f'.repeat(64);});
  await assert.rejects(sceneChanged.make().scene({path:'world.tscn'}),/PROJECT_QUERY_IDENTITY_MISMATCH/);
});
