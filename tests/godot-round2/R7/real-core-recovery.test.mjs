// Real Rust core: executor status, durable usage and draft recovery across a
// process restart (A11/A12 evidence for the model-facing recovery path).
//
// Requires CRAFTMINE_CORE_BIN. Without it the file skips instead of pretending.
// No engine, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {compileScene,INITIAL_SNAPSHOT} from '../../../app/scene.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {CoreClient}=require(path.join(root,'plugins/craftmine-world/core-client.cjs'));
const {executorStatus,usageSummary,listRecoverable,resumeDraft}=require(path.join(root,'plugins/craftmine-world/godot-jobs.cjs'));
const {createLibraryBinding}=require(path.join(root,'plugins/craftmine-world/godot-library.cjs'));
const {buildInventory}=require(path.join(root,'plugins/craftmine-world/godot-capability.cjs'));
const {GODOT_METHODS,LOCAL_TOOLS}=require(path.join(root,'plugins/craftmine-world/godot-routing.cjs'));
const manifest=require(path.join(root,'plugins/craftmine-world/manifest.json'));

const binary=process.env.CRAFTMINE_CORE_BIN;
const skip=binary?false:'Set CRAFTMINE_CORE_BIN to a freshly built craftmine-core';
const FIRST={projectId:'project',sessionId:'session',turnId:'turn-1'};
const SECOND={projectId:'project',sessionId:'session',turnId:'turn-2'};
const FILES=[
  {path:'project.godot',text:'config_version=5\n[application]\nconfig/name="Recovery probe"\nrun/main_scene="res://world.tscn"\n'},
  {path:'world.gd',text:'class_name RecoveryProbe\nextends Node3D\n'}];

async function openSession(){
  const directory=await mkdtemp(path.join(process.env.PI_SCRATCH_DIR||tmpdir(),'godot-round2-R7-real-'));
  let client=new CoreClient(binary,directory);
  const hello=await client.start();
  const scene=compileScene({format:'craftmine.scene/3',title:'R7 probe',night:false,objects:[],systems:[],behaviors:[]});
  const world={build:{...scene,id:'v-'+scene.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]};
  await client.call('world.create',{id:'alpha',title:'alpha',world});
  const workspace=await client.call('workspace.open',{context:FIRST,selectedWorld:'alpha'});
  await client.call('godotProject.create',{context:FIRST,worldId:'alpha',toolCallId:'create-1',
    baseBuild:workspace.task.binding.baseBuild,baseId:'first-person',files:FILES});
  return {directory,hello,get client(){return client;},restart:async()=>{
    await client.stop();
    client=new CoreClient(binary,directory);
    return client.start();
  }};
}

test('the real core reports an empty executor gate and empty durable usage',{skip},async t=>{
  const session=await openSession();
  t.after(()=>session.client.stop());
  const status=await executorStatus(session.client);
  assert.equal(status.scope,'executor');
  assert.equal(status.status.build,false,'no isolated executor is registered in a bare core');
  assert.equal(status.status.check,false);
  assert.ok(Array.isArray(status.status.executors));
  assert.equal(status.status.executors.length,0);
  const usage=await usageSummary(session.client,{context:FIRST,worldId:'alpha'});
  assert.equal(usage.items.length,0);
  assert.equal(usage.totals.executions,0);
  assert.equal(usage.totals.wallClockMillis,0,'no jobs is a real zero total');
});

test('an interrupted draft is listed and resumed in a new turn after a real restart',{skip},async t=>{
  const session=await openSession();
  t.after(()=>session.client.stop());
  const hello=await session.restart();
  assert.equal(hello.godotProjects,true);

  const listed=await listRecoverable(session.client,{projectId:'project',worldId:'alpha',sessionId:'session'});
  assert.equal(listed.items.length,1,'the interrupted task must survive a process restart');
  const draft=listed.items[0];
  assert.equal(draft.resumable,true);
  assert.equal(draft.blockedReason,null);
  assert.ok(Number.isSafeInteger(draft.generation));
  assert.match(draft.draftHash,/^[a-f0-9]{64}$/);

  const resumed=await resumeDraft(session.client,{context:SECOND,worldId:'alpha',taskId:draft.taskId,generation:draft.generation});
  assert.equal(resumed.resumed,true,JSON.stringify(resumed.reason||{}));
  assert.equal(resumed.generationAfter,draft.generation+1);
  assert.equal(resumed.workspace.worldId,'alpha');
  assert.equal(resumed.modelReplay,false);

  // The recovered draft keeps its source head, so the project is still readable.
  const index=await session.client.call('godotProject.index',{context:SECOND,worldId:'alpha',limit:8});
  assert.equal(index.worldId,'alpha');
  assert.equal(index.totalFiles,2);

  // Replaying the same recovery selection is refused, not silently repeated.
  const again=await resumeDraft(session.client,{context:SECOND,worldId:'alpha',taskId:draft.taskId,generation:draft.generation});
  assert.equal(again.resumed,false);
  assert.equal(again.reason.kind,'conflict');
  assert.equal(again.reason.code,'STALE_RECOVERY_SELECTION');
});

test('asset and package methods are genuinely absent, and the tools say which',{skip},async t=>{
  const session=await openSession();
  t.after(()=>session.client.stop());
  const library=createLibraryBinding({core:session.client,context:FIRST,worldId:'alpha'});
  const search=await library.assetSearch({scope:'current-world',query:'door'});
  assert.equal(search.available,false);
  assert.equal(search.reason,'DEPENDENCY_NOT_WIRED');
  assert.equal(search.requiredHostMethod,'asset.search');
  assert.equal(search.owner,'R6');
  const check=await library.packageCheck({ref:{assetId:'door-kit',version:1,contentHash:'a'.repeat(64)},
    target:{base:'first-person',engine:'4.7.2-stable'}});
  assert.equal(check.available,false);
  assert.equal(check.requiredHostMethod,'package.check');
  assert.equal(check.owner,'R4');
  const historyModule=require(path.join(root,'plugins/craftmine-world/godot-history.cjs'));
  // A world with no content repository has no branch identity yet: the tool
  // reports that gap instead of inventing a branch.
  const incomplete=historyModule.createHistoryService({core:session.client,context:FIRST,
    workspace:{worldId:'alpha',task:{binding:{}}}});
  const blocked=await incomplete.history({});
  assert.equal(blocked.available,false);
  assert.equal(blocked.reason,'OPERATION_CONTEXT_INCOMPLETE');
  assert.ok(blocked.missing.includes('repoId'));
  // With a full host binding the real core answers UNKNOWN_METHOD: M has not
  // registered the content-history dispatch table.
  const bound=historyModule.createHistoryService({core:session.client,context:FIRST,
    workspace:{worldId:'alpha',task:{binding:{repoId:'world-alpha',branchId:'main',
      expectedHeadOid:null,expectedAppliedOid:null,expectedProgressRevision:null}}}});
  const revisions=await bound.history({});
  assert.equal(revisions.available,false);
  assert.equal(revisions.reason,'DEPENDENCY_NOT_WIRED');
  assert.equal(revisions.requiredHostMethod,'content.history');
  assert.equal(revisions.owner,'M');
});

test('the capability report matches the real core and marks unregistered tools blocked',{skip},async t=>{
  const session=await openSession();
  t.after(()=>session.client.stop());
  const inventory=buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:session.hello});
  assert.equal(inventory.tools.filter(tool=>tool.name.startsWith('godot_')).length,19);
  const jobs=inventory.tools.find(tool=>tool.name==='godot_jobs');
  assert.equal(jobs.wired,true);
  assert.equal(jobs.reachable,true);
  for(const name of ['asset_library','package_library','godot_history']){
    const tool=inventory.tools.find(entry=>entry.name===name);
    assert.equal(tool.reachable,false,name);
    assert.equal(tool.blockedBy,'DEPENDENCY_NOT_WIRED',name);
  }
  assert.equal(inventory.tools.filter(tool=>tool.wired===false).length,0);
});

console.log('real core evidence: '+binary);
