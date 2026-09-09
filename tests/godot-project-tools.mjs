// Real broker + Rust stdio tests. No engine import, browser, or input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {compileScene,INITIAL_SNAPSHOT} from '../app/scene.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const dependencies=createRequire(path.join(process.env.CRAFTMINE_DEPENDENCY_ROOT||root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const {build}=dependencies('esbuild');
const {CoreClient}=require('../plugins/craftmine-world/core-client.cjs');
const binary=process.env.CRAFTMINE_CORE_BIN;
assert.ok(binary,'Set CRAFTMINE_CORE_BIN to the newly built Rust core');
await mkdir(path.join(root,'test-results'),{recursive:true});
const output=await mkdtemp(path.join(root,'test-results/godot-project-tools-'));
await build({entryPoints:[path.join(root,'plugins/craftmine-world/world-tools.cjs')],
  outfile:path.join(output,'broker.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',
  alias:{'@babel/parser':dependencies.resolve('@babel/parser')},
  plugins:[{name:'actual-domain-source',setup(builder){
    builder.onResolve({filter:/^\.\/domain\.cjs$/},()=>({path:path.join(root,'plugins/craftmine-world/domain-adapter.mjs')}));
    builder.onResolve({filter:/behavior-syntax\.mjs$/},()=>({path:path.join(root,'plugins/craftmine-world/behavior-syntax.mjs')}));
  }}]});
const {createWorldTools}=require(path.join(output,'broker.cjs'));
const files=[{path:'project.godot',text:'config_version=5\n[application]\nconfig/name="Source probe"\nrun/main_scene="res://world.tscn"\n'},
  {path:'world.tscn',text:'[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://world.gd" id="1"]\n[node name="World" type="Node3D"]\nscript = ExtResource("1")\n'},
  {path:'world.gd',text:'extends Node3D\nvar damage = 12\n# 花草 🌱\n'}];
let sequence=0;
async function fixture(t) {
  const directory=await mkdtemp(path.join(output,'profile-'));
  let client=new CoreClient(binary,directory);
  const hello=await client.start();
  assert.equal(hello.godotProjects,true);
  assert.equal(hello.godotExecution,false);
  t.after(()=>client.stop());
  const scene=compileScene({format:'craftmine.scene/3',title:'Source world',night:false,objects:[],systems:[],behaviors:[]});
  const world={build:{...scene,id:'v-'+scene.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]};
  for(const id of ['alpha','beta'])await client.call('world.create',{id,title:id,world});
  const invocation={projectId:'project',sessionId:'session',turnId:'turn',executionId:'execution'};
  let selectedWorld='alpha',ended=false,fault=null;
  const calls=[];
  // Delegation still calls the real core. Only panel selection and lifecycle are fixtures.
  const core={start:()=>client.start(),call:async(method,args)=>{
    calls.push(method);
    if(fault?.method===method&&fault.beforeCommit){fault=null;throw Error('Craftmine Rust request timed out');}
    const result=await client.call(method,args);
    if(fault?.method===method) {
      fault=null;
      await client.call('workspace.endTurn',{sessionId:invocation.sessionId,turnId:invocation.turnId,status:'completed'});
      ended=true;
      throw Error('Craftmine Rust request timed out'); // Inject loss after the real commit.
    }
    return result;
  }};
  const tools=createWorldTools(core,async()=>({activeWorldId:selectedWorld}),()=>ended);
  const call=(name,args={},extra={})=>tools.find(tool=>tool.name===name).execute(args,
    {...invocation,toolCallId:'call-'+(++sequence),...extra});
  return {call,core,invocation,world,calls,lose:(method,beforeCommit=false)=>{fault={method,beforeCommit};},select:id=>{selectedWorld=id;},end:()=>{ended=true;},
    restart:async()=>{await client.stop();client=new CoreClient(binary,directory);await client.start();}};
}

test('real source tools: world binding, Unicode reads, immutable revision and process restart',async t=>{
  const f=await fixture(t);
  const created=await f.call('godot_project_create',{baseId:'first-person',files});
  assert.equal(created.worldId,'alpha');assert.equal(created.status,'source-only');
  assert.equal(created.verified,false);assert.equal(created.applied,false);
  const first=await f.call('godot_project_index');
  const pin={revision:first.revision,manifestHash:first.manifestHash};
  const before=await f.call('godot_file_read',{...pin,path:'world.gd'});
  assert.equal(before.text,files[2].text);
  const offset=Array.from(files[2].text).indexOf('花');
  const page=await f.call('godot_file_read',{...pin,path:'world.gd',offset,limit:4});
  assert.equal(page.text,'花草 🌱');
  f.select('beta');
  const patched=await f.call('godot_project_patch',{...pin,operations:[{op:'put',path:'world.gd',
    text:files[2].text.replace('12','7'),expectedHash:before.sha256}]});
  assert.equal(patched.worldId,'alpha');assert.equal(patched.revision,first.revision+1);
  assert.equal((await f.call('godot_file_read',{...pin,path:'world.gd'})).text,before.text);
  assert.deepEqual((await f.core.call('world.read',{id:'alpha'})).world,f.world);
  await f.restart();
  await assert.rejects(f.call('godot_project_index',{}, {turnId:'after-restart'}),/EXPLICIT_RECOVERY_REQUIRED/);
  const recovery=await f.core.call('task.recoverable',{projectId:'project',worldId:'alpha'});
  assert.equal(recovery.items.length,1);
  await f.core.call('task.resume',{taskId:recovery.items[0].taskId,generation:recovery.items[0].generation,
    context:{projectId:'project',sessionId:'session',turnId:'after-restart'}});
  const current=await f.call('godot_project_index',{}, {turnId:'after-restart'});
  assert.equal(current.manifestHash,patched.manifestHash);assert.equal(current.worldId,'alpha');
  const source=await f.call('godot_file_read',{revision:current.revision,manifestHash:current.manifestHash,path:'world.gd'}, {turnId:'after-restart'});
  assert.match(source.text,/damage = 7/);
  await assert.rejects(f.core.call('godotProject.index',{context:{projectId:'project',sessionId:'session',turnId:'after-restart'},worldId:'beta'}));
});

test('real source tools: exact retry receipt, stale edits and path failures preserve head',async t=>{
  const f=await fixture(t);
  const input={baseId:'top-down',files};
  const created=await f.call('godot_project_create',input,{toolCallId:'create-once'});
  assert.deepEqual(await f.call('godot_project_create',input,{toolCallId:'create-once'}),created);
  await assert.rejects(f.call('godot_project_create',{...input,baseId:'side-view'},{toolCallId:'create-once'}),/REPLAY_MISMATCH/);
  const index=await f.call('godot_project_index'),pin={revision:index.revision,manifestHash:index.manifestHash};
  const source=await f.call('godot_file_read',{...pin,path:'world.gd'});
  const request={...pin,operations:[{op:'put',path:'world.gd',text:source.text+'# changed\n',expectedHash:source.sha256}]};
  const receipt=await f.call('godot_project_patch',request,{toolCallId:'patch-once'});
  assert.deepEqual(await f.call('godot_project_patch',request,{toolCallId:'patch-once'}),receipt);
  await assert.rejects(f.call('godot_project_patch',request));
  const latest={revision:receipt.revision,manifestHash:receipt.manifestHash};
  for(const path of ['../escape.gd','C:/escape.gd','world.gd:secret','CON.gd']) {
    await assert.rejects(f.call('godot_project_patch',{...latest,operations:[{op:'put',path,text:'extends Node',expectedHash:null}]}));
  }
  assert.equal((await f.call('godot_project_index')).manifestHash,receipt.manifestHash);
});

test('broker rejects forged identity, ended turns and oversized content before mutation',async t=>{
  const f=await fixture(t),input={baseId:'first-person',files};
  for(const key of ['worldId','context','toolCallId','baseBuild'])await assert.rejects(
    f.call('godot_project_create',{...input,[key]:'forged'}));
  await assert.rejects(f.call('godot_project_create',{baseId:'first-person',files:[{path:'project.godot',text:'花'.repeat(61000)}]}),/TOOL_INPUT_TOO_LARGE/);
  await assert.rejects(f.call('godot_project_create',input,{toolCallId:'@host:forged'}),/RESERVED_HOST_RECEIPT/);
  await assert.rejects(f.call('godot_project_create',input,{executionId:''}),/HOST_IDENTITY_REQUIRED/);
  f.end();await assert.rejects(f.call('godot_project_create',input),/TURN_ENDED/);
  assert.deepEqual((await f.core.call('world.read',{id:'alpha'})).world,f.world);
});

test('tool catalogue exposes only source authoring for Godot',async()=>{
  const manifest=JSON.parse(await readFile(path.join(root,'plugins/craftmine-world/manifest.json'),'utf8'));
  const tools=manifest.contributes.agentTools.filter(tool=>tool.name.startsWith('godot_'));
  assert.equal(tools.length,4);
  for(const tool of tools)for(const key of ['worldId','context','toolCallId','baseBuild'])assert.ok(!Object.hasOwn(tool.schema.properties,key));
  assert.ok(tools.every(tool=>tool.schema.additionalProperties===false));
  assert.equal(tools.find(tool=>tool.name==='godot_project_index').schema.properties.limit.maximum,32);
});

test('lost mutation response recovers its real receipt after turn completion without another write',async t=>{
  const f=await fixture(t);
  await f.call('godot_project_create',{baseId:'first-person',files});
  const index=await f.call('godot_project_index'),pin={revision:index.revision,manifestHash:index.manifestHash};
  const file=await f.call('godot_file_read',{...pin,path:'world.gd'});
  f.lose('godotProject.patch');
  const result=await f.call('godot_project_patch',{...pin,operations:[{op:'put',path:'world.gd',text:file.text+'# retained\n',expectedHash:file.sha256}]});
  assert.equal(result.revision,index.revision+1);assert.equal(result.applied,false);
  assert.equal(f.calls.filter(m=>m==='godotProject.patch').length,1);
  assert.equal(f.calls.filter(m=>m==='godotProject.receipt').length,1);
  await assert.rejects(f.call('godot_project_index'),/TURN_ENDED/);
  assert.deepEqual((await f.core.call('world.read',{id:'alpha'})).world,f.world);
});

test('a missing receipt preserves the original uncertain error and does not replay creation',async t=>{
  const f=await fixture(t);f.lose('godotProject.create',true);
  await assert.rejects(f.call('godot_project_create',{baseId:'first-person',files}),/Craftmine Rust request timed out/);
  assert.equal(f.calls.filter(m=>m==='godotProject.create').length,1);
  assert.equal(f.calls.filter(m=>m==='godotProject.receipt').length,1);
  await assert.rejects(f.call('godot_project_index'),/GODOT_PROJECT_NOT_FOUND/);
});
console.log('evidence_directory='+output);
