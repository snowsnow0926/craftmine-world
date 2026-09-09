import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {compileScene,upgradeScene,INITIAL_SNAPSHOT} from '../../../app/scene.mjs';
import {sourceFixture} from '../c/fixtures/applied-source.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),require=createRequire(import.meta.url);
const {CoreClient}=require(path.join(root,'desktop/build/craftmine.world/core-client.cjs'));
const {createHostRequests}=require(path.join(root,'desktop/build/craftmine.world/host-requests.cjs'));
const dependencies=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
async function module(name){const build=await dependencies('esbuild').build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/'+name+'.ts')],platform:'node',bundle:true,format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(build.outputFiles[0].text).toString('base64'));}
const {CraftmineMaintenanceContexts}=await module('craftmine-maintenance-context');
const {CraftmineTurnGateway}=await module('craftmine-turn-gateway');
const context={projectId:'fixture-project',sessionId:'fixture-source',turnId:'fixture-turn'};

test('actual completed draft keeps verification, review and ledger through successful and failed maintenance',async t=>{
  assert.ok(path.isAbsolute(process.env.CRAFTMINE_CORE_BIN||''),'explicit own binary required');
  const base=path.join(root,'test-results/dispatch-e-maintenance');await mkdir(base,{recursive:true});const dir=await mkdtemp(path.join(base,'domain-'));
  const core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,dir);t.after(()=>core.stop());await core.start();
  const call=(method,args)=>core.call(method,args);
  const domain=createHostRequests(core,{getSettings:async()=>({activeWorldId:'different-panel-world'})});
  assert.equal(await domain('maintenance.context',{projectId:context.projectId,sessionId:context.sessionId}),null);
  assert.equal(await call('workspace.current',{projectId:context.projectId,sessionId:context.sessionId}),null);
  const empty=upgradeScene({format:'craftmine.scene/1',title:'Maintenance',night:false,objects:[]});
  const source=upgradeScene({...empty,format:'craftmine.scene/1',objects:[{id:'tree',name:'Tree',position:{x:0,y:6,z:0},parts:[{offset:{x:0,y:0,z:0},size:{x:1,y:3,z:1},material:'wood'}]}]});
  const build=scene=>{const compiled=compileScene(scene);return {...compiled,behaviors:compiled.behaviors||[],id:'v-'+compiled.hash.slice(0,20)};};
  // Real durable check/review contracts, explicitly synthetic evidence. Stop
  // before application so this verifies the player's pending candidate.
  await sourceFixture({context,empty,source,build,INITIAL_SNAPSHOT})(async(method,args)=>method.startsWith('application.')?{id:'not-applied'}:call(method,args));
  await assert.rejects(domain('maintenance.context',{projectId:context.projectId,sessionId:context.sessionId}),/FINISHED_TASK_REQUIRED/);
  const running=await domain('task.context',{context});
  const identity={binding:running.binding,generation:running.generation};
  await domain('budget.reserve',{...identity,context,requestId:'original-creation',purpose:'creation',estimatedInputTokens:100,maxOutputTokens:50});
  await domain('budget.settle',{...identity,context,requestId:'original-creation',status:'known',usage:{inputTokens:70,outputTokens:20,totalTokens:90}});
  await call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
  const current=await domain('maintenance.context',{projectId:context.projectId,sessionId:context.sessionId});
  const beforeWorkspace=await call('workspace.inspect',{context});
  const beforeJobs=structuredClone(current.jobs),beforeReview=await call('review.read',{id:'fixture-review'});
  const beforeCheck=await call('verification.read',{id:beforeReview.verificationId});
  assert.equal(current.status,'finished');assert.equal(current.world.id,'source-world');assert.equal(current.budget.actualTokens,90);
  const registry=new CraftmineMaintenanceContexts();let active='maintenance-one';
  // Use the same registry route as Main's private gateway callback.
  const routed=new CraftmineTurnGateway(()=>active,()=>new Set(),async(method,params,binding)=>{
    const {sessionId,turnId,...input}=params;return registry.request(binding,method==='craftmine.context'?'task.context':method.replace('craftmine.',''),input,domain);
  },(sessionId,turnId)=>registry.has(sessionId,turnId));
  const binding={projectId:context.projectId,sessionId:context.sessionId,turnId:active,selectedWorld:'source-world'};registry.bind(binding,current);routed.bind(binding);
  const host={sessionId:context.sessionId,turnId:active};
  assert.throws(()=>routed.assertTool({...host,toolName:'runtime_info'}),/MAINTENANCE_SCOPE_DENIED/);
  assert.deepEqual((await routed.invoke('craftmine.context',host)).binding,current.binding);
  for(const purpose of ['creation','retry','review'])await assert.rejects(routed.invoke('craftmine.budget.reserve',{...host,...identity,requestId:'denied-'+purpose,purpose,estimatedInputTokens:10,maxOutputTokens:10}),/MAINTENANCE_SCOPE_DENIED/);
  await assert.rejects(routed.invoke('craftmine.budget.boundary',{...host,...identity,eventId:'denied-tool',kind:'tool'}),/MAINTENANCE_SCOPE_DENIED/);
  await routed.invoke('craftmine.budget.boundary',{...host,...identity,eventId:'maintenance-one',kind:'compaction'});
  await routed.invoke('craftmine.budget.reserve',{...host,...identity,requestId:'summary-one',purpose:'summary',estimatedInputTokens:100,maxOutputTokens:50});
  await routed.invoke('craftmine.budget.settle',{...host,...identity,requestId:'summary-one',status:'known',usage:{inputTokens:30,outputTokens:10,totalTokens:40}});
  // A failed provider request keeps its estimate charged, with no world end.
  await routed.invoke('craftmine.budget.boundary',{...host,...identity,eventId:'maintenance-failed',kind:'compaction'});
  await routed.invoke('craftmine.budget.reserve',{...host,...identity,requestId:'summary-failed',purpose:'summary',estimatedInputTokens:80,maxOutputTokens:20});
  routed.end(context.sessionId,active);active=undefined;
  await routed.invoke('craftmine.budget.settle',{...host,...identity,requestId:'summary-failed',status:'unknown',errorCode:'FIXTURE_FAILURE'});
  await assert.rejects(routed.invoke('craftmine.context',host),/ACTIVE_TURN_REQUIRED/);
  const after=await domain('maintenance.context',{projectId:context.projectId,sessionId:context.sessionId});
  assert.deepEqual(await call('workspace.inspect',{context}),beforeWorkspace);assert.deepEqual(after.jobs,beforeJobs);assert.deepEqual(await call('review.read',{id:'fixture-review'}),beforeReview);
  assert.deepEqual(await call('verification.read',{id:beforeReview.verificationId}),beforeCheck);
  assert.equal(after.budget.ownerTaskId,current.budget.ownerTaskId);assert.equal(after.budget.requestCount,3);assert.equal(after.budget.compactionCount,2);assert.equal(after.budget.actualTokens,130);assert.equal(after.budget.reservedTokens,100);assert.deepEqual(after.requirements,current.requirements);
  // The completed-only allowance is enforced by Rust even without Main.
  await assert.rejects(call('budget.reserve',{...identity,requestId:'raw-create',purpose:'creation',estimatedInputTokens:10,maxOutputTokens:10}),/TASK_INACTIVE/);
  await assert.rejects(call('budget.boundary',{...identity,eventId:'raw-tool',kind:'tool'}),/TASK_INACTIVE/);
  const next={...context,turnId:'new-creation'};await call('workspace.open',{context:next,selectedWorld:'source-world'});
  await assert.rejects(call('budget.reserve',{...identity,requestId:'late-summary',purpose:'summary',estimatedInputTokens:10,maxOutputTokens:10}),/STALE_TURN/);
  assert.equal(registry.has(context.sessionId,next.turnId),false);
  await core.stop();
  const reopened=new CoreClient(process.env.CRAFTMINE_CORE_BIN,dir);t.after(()=>reopened.stop());await reopened.start();
  const afterRestart=createHostRequests(reopened,{getSettings:async()=>({activeWorldId:'source-world'})});
  await assert.rejects(afterRestart('maintenance.context',{projectId:context.projectId,sessionId:context.sessionId}),/FINISHED_TASK_REQUIRED/);
});
