// Real Rust core wiring for the new Godot tools.
//
// Requires CRAFTMINE_CORE_BIN to point at a freshly built craftmine-core. When
// it is unset the whole file skips instead of pretending to pass.
// No engine, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {compileScene,INITIAL_SNAPSHOT} from '../../../app/scene.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {CoreClient}=require(path.join(root,'plugins/craftmine-world/core-client.cjs'));
const {createProjectQuery}=require(path.join(root,'plugins/craftmine-world/godot-query.cjs'));
const {describeRuntime,projectFacts}=require(path.join(root,'plugins/craftmine-world/godot-observe.cjs'));
const {buildInventory}=require(path.join(root,'plugins/craftmine-world/godot-capability.cjs'));
const {createHistoryService}=require(path.join(root,'plugins/craftmine-world/godot-history.cjs'));
const {GODOT_METHODS,LOCAL_TOOLS}=require(path.join(root,'plugins/craftmine-world/godot-routing.cjs'));
const manifest=require(path.join(root,'plugins/craftmine-world/manifest.json'));

const binary=process.env.CRAFTMINE_CORE_BIN;
const skip=binary?false:'Set CRAFTMINE_CORE_BIN to a freshly built craftmine-core';

const CONTEXT={projectId:'project',sessionId:'session',turnId:'turn'};
const FILES=[
  {path:'project.godot',text:'config_version=5\n[application]\nconfig/name="Real probe"\nrun/main_scene="res://world.tscn"\n'},
  {path:'world.tscn',text:'[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://world.gd" id="1_w"]\n\n[node name="World" type="Node3D"]\nscript = ExtResource("1_w")\n'},
  {path:'world.gd',text:'class_name RealProbe\nextends Node3D\n\n@export var damage: float = 9.0\n\nfunc ping() -> int:\n\treturn 1\n'}];

async function session(t){
  const directory=await mkdtemp(path.join(process.env.PI_SCRATCH_DIR||tmpdir(),'godot-remaining-L-real-'));
  const client=new CoreClient(binary,directory);
  const hello=await client.start();
  t.after(()=>client.stop());
  const scene=compileScene({format:'craftmine.scene/3',title:'L probe',night:false,objects:[],systems:[],behaviors:[]});
  const world={build:{...scene,id:'v-'+scene.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]};
  await client.call('world.create',{id:'alpha',title:'alpha',world});
  const workspace=await client.call('workspace.open',{context:CONTEXT,selectedWorld:'alpha'});
  await client.call('godotProject.create',{context:CONTEXT,worldId:'alpha',toolCallId:'create-1',
    baseBuild:workspace.task.binding.baseBuild,baseId:'first-person',files:FILES});
  return {client,hello,workspace};
}

test('the real core advertises the Godot capability flags the inventory reports',{skip},async t=>{
  const {client,hello}=await session(t);
  assert.equal(hello.godotProjects,true);
  assert.equal(hello.godotBuildJobs,true);
  assert.equal(hello.godotExecution,false);
  const inventory=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:hello});
  assert.equal(inventory.tools.filter(tool=>tool.name.startsWith('godot_')).length,17);
  assert.equal(inventory.tools.find(tool=>tool.name==='godot_build_start').reachable,true);
  assert.equal(inventory.tools.find(tool=>tool.name==='godot_project_index').reachable,true);
  const client2=await client.call('godotProject.index',{context:CONTEXT,worldId:'alpha',limit:8});
  assert.equal(client2.status,'source-only');
});

test('the real project store answers the structured query',{skip},async t=>{
  const {client}=await session(t);
  const query=createProjectQuery({core:client,context:CONTEXT,worldId:'alpha'});
  const summary=await query.summary();
  assert.equal(summary.identity.baseId,'first-person');
  assert.equal(summary.identity.engineVersion,'4.7.2-stable');
  assert.equal(summary.mainScene,'res://world.tscn');
  assert.equal(summary.totalFiles,3);
  assert.equal(summary.status,'source-only');
  assert.equal(summary.applied,false);
  const scene=await query.scene({path:'world.tscn'});
  assert.equal(scene.tree[0].name,'World');
  assert.equal(scene.tree[0].script,'res://world.gd');
  assert.equal(scene.untrusted.trust,'untrusted-project-data');
  const scripts=await query.scripts({path:'world.gd'});
  assert.equal(scripts.scripts[0].className,'RealProbe');
  assert.deepEqual(scripts.scripts[0].exports.map(entry=>entry.name),['damage']);
  const found=await query.find({name:'ping'});
  assert.deepEqual(found.matches,[{path:'world.gd',kind:'func',line:6,returns:'int'}]);
});

test('an unapplied project has no formal runtime, and the tool says so',{skip},async t=>{
  const {client}=await session(t);
  const descriptor=await describeRuntime(client,{worldId:'alpha'});
  assert.equal(descriptor.available,false);
  assert.equal(descriptor.reason,'NO_FORMAL_GODOT_RUNTIME');
  const facts=await projectFacts({core:client,context:CONTEXT,worldId:'alpha'});
  assert.equal(facts.project.available,true);
  assert.equal(facts.project.revision,0);
  assert.equal(facts.runtime.available,false);
  assert.equal(facts.runtime.reason,'NO_FORMAL_GODOT_RUNTIME');
  assert.equal(facts.live.available,false);
  assert.equal(facts.live.reason,'LIVE_OBSERVATION_NOT_WIRED');
  assert.equal(facts.durableProgress.available,false);
  assert.match(facts.block,/runtime: unavailable\(NO_FORMAL_GODOT_RUNTIME\)/);
});

test('the runtime descriptor RPC rejects a model-supplied context',{skip},async t=>{
  const {client}=await session(t);
  // The real RPC uses deny_unknown_fields, so identity cannot be smuggled in.
  await assert.rejects(client.call('godotRuntime.describe',{worldId:'alpha',context:CONTEXT}));
  const result=await client.call('godotRuntime.describe',{worldId:'alpha'});
  assert.equal(result,null);
});

test('the history and asset adapters are genuinely absent in the real core',{skip},async t=>{
  const {client}=await session(t);
  const history=createHistoryService({core:client,context:CONTEXT,
    workspace:{worldId:'alpha',task:{binding:{repoId:'world-alpha',branchId:'plan-1'}}}});
  const listed=await history.history({});
  assert.equal(listed.available,false);
  assert.equal(listed.reason,'DEPENDENCY_NOT_WIRED');
  assert.equal(listed.requiredHostMethod,'version.history');
  assert.equal(listed.owner,'M');
  const asset=await history.assetSearch({query:'shop'});
  assert.equal(asset.owner,'N');
  assert.equal(asset.requiredHostMethod,'asset.search');
});

console.log('real core evidence: '+binary);
