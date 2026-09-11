import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {compileScene,INITIAL_SNAPSHOT} from '../../app/scene.mjs';
const require=createRequire(import.meta.url);
const {CoreClient}=require('../../plugins/craftmine-world/core-client.cjs');
const {createProjectQuery}=require('../../plugins/craftmine-world/godot-query.cjs');
const binary=process.env.CRAFTMINE_CORE_BIN;

test('real source store preserves continuation identity after source head advances',{skip:binary?false:'CRAFTMINE_CORE_BIN required'},async t=>{
  const binaryHash=createHash('sha256').update(await readFile(binary)).digest('hex');
  console.log('core_binary='+JSON.stringify({path:binary,sha256:binaryHash}));
  const directory=await mkdtemp(path.join(tmpdir(),'craftmine-gu2-query-'));
  const core=new CoreClient(binary,directory);t.after(()=>core.stop());
  await core.start();
  const context={projectId:'query-project',sessionId:'query-session',turnId:'query-turn'};
  const scene=compileScene({format:'craftmine.scene/3',title:'Query integration',night:false,objects:[],systems:[],behaviors:[]});
  const world={build:{...scene,id:'v-'+scene.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]};
  await core.call('world.create',{id:'alpha',title:'alpha',world});
  const workspace=await core.call('workspace.open',{context,selectedWorld:'alpha'});
  const files=[
    {path:'project.godot',text:'config_version=5\n[application]\nconfig/name="Query integration"\nrun/main_scene="res://world.tscn"\n[input]\njump={\n"deadzone":0.5,\n"events":[]\n}\n'},
    {path:'world.tscn',text:'[gd_scene format=3]\n[ext_resource type="PackedScene" path="res://base.tscn" id="base"]\n[node name="World" instance=ExtResource("base")]\n'},
    {path:'base.tscn',text:'[gd_scene format=3]\n[node name="Base" type="Node3D"]\n'},
    {path:'controls.gd',text:'extends Node\nfunc _process(_delta):\n if Input.is_action_pressed("jump"):\n  pass\n'},
    {path:'paint.gdshader',text:'shader_type spatial;\n'},
    {path:'paint.tres',text:'[gd_resource type="ShaderMaterial" format=3]\n[ext_resource type="Shader" path="res://paint.gdshader" id="s"]\n[resource]\nshader=ExtResource("s")\n'},
    ...Array.from({length:30},(_,i)=>({path:`scripts/s${String(i).padStart(2,'0')}.gd`,text:i===29?'# Final script\nclass_name HiddenFeature\nfunc old_feature():\n pass\n':'extends Node\n'})),
    {path:'large.tres',text:'[gd_resource type="Resource" format=3]\n'+'; padding\n'.repeat(1700)+'[resource]\n'}
  ];
  let source=await core.call('godotProject.create',{context,worldId:'alpha',toolCallId:'create-query-source',baseBuild:workspace.task.binding.baseBuild,baseId:'first-person',files:files.slice(0,16)},30000);
  for(let offset=16;offset<files.length;offset+=16){
    source=await core.call('godotProject.patch',{context,worldId:'alpha',toolCallId:'extend-query-source-'+offset,
      revision:source.revision,manifestHash:source.manifestHash,
      operations:files.slice(offset,offset+16).map(file=>({op:'put',...file,expectedHash:null}))},30000);
  }
  const make=()=>createProjectQuery({core,context,worldId:'alpha'});
  const first=await make().find({name:'old_feature'});
  assert.equal(first.nextOffset,24);assert.deepEqual(first.matches,[]);
  const pin={revision:first.identity.revision,manifestHash:first.identity.manifestHash};
  const sceneQuery=await make().scene({...pin,path:'world.tscn'});
  assert.equal(sceneQuery.instances[0].relation,'scene-inheritance');
  assert.equal(sceneQuery.instances[0].sourceReference.status,'manifest-entry');
  assert.equal(sceneQuery.instances[0].sourceReference.contentsRead,false);
  const controls=await make().scripts({...pin,path:'controls.gd'});
  assert.equal(controls.scripts[0].inputActionReferences[0].projectSettings.status,'declared');
  const paint=await make().resources({...pin,path:'paint.tres'});
  assert.equal(paint.resources[0].resourceLinks[0].sourceReference.path,'paint.gdshader');
  assert.equal(paint.resources[0].resourceLinks[0].sourceReference.status,'manifest-entry');
  const file=await core.call('godotProject.read',{context,worldId:'alpha',...pin,path:'scripts/s29.gd',offset:0,limit:16000});
  const settings=await core.call('godotProject.read',{context,worldId:'alpha',...pin,path:'project.godot',offset:0,limit:16000});
  await core.call('godotProject.patch',{context,worldId:'alpha',toolCallId:'advance-query-head',...pin,operations:[
    {op:'put',path:file.path,expectedHash:file.sha256,text:'extends Node\nfunc new_feature():\n pass\n'},
    {op:'put',path:settings.path,expectedHash:settings.sha256,text:settings.text.split('[input]')[0]}
  ]},30000);
  assert.equal((await make().scripts({...pin,path:'controls.gd'})).scripts[0].inputActionReferences[0].projectSettings.status,'declared');
  assert.equal((await make().scripts({path:'controls.gd'})).scripts[0].inputActionReferences[0].projectSettings.status,'not-in-project-settings');
  const continued=await make().find({...pin,offset:first.nextOffset,name:'old_feature'});
  assert.equal(continued.identity.manifestHash,pin.manifestHash);
  assert.equal(continued.matches[0].path,'scripts/s29.gd');assert.equal(continued.matches[0].line,3);
  assert.equal(continued.nextOffset,null);
  const current=await make().find({name:'new_feature',limit:24});
  assert.notEqual(current.identity.manifestHash,pin.manifestHash);
  const last=await make().find({name:'new_feature',offset:24,revision:current.identity.revision,manifestHash:current.identity.manifestHash});
  assert.equal(last.matches.length,1);
  const resources=await make().resources({...pin});
  assert.equal(resources.complete,false);assert.equal(resources.skipped[0].path,'large.tres');
  console.log('isolated_core_data='+directory);
});
