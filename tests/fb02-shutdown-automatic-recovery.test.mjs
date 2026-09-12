// Real finishTurn + settleRunningTurnsForQuit and durable target/queue services.
// Runtime events are finite fixtures; no model, native input, or player profile.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createCreationTargetService} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-target-service.ts';
import {createCreationAutoQueue} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-auto-queue.ts';
import {createCreationStopIntents} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-stop-intent.ts';
const source=fs.readFileSync(new URL('../vendor/pi-desktop/apps/desktop/electron/main/index.ts',import.meta.url),'utf8');
const block=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return stripTypeScriptTypes(source.slice(a,b),{mode:'transform'});};
const code=block('function finishTurn(','\nasync function finishApprovedExecution(')+'\n'+block('async function settleRunningTurnsForQuit()', '\nlet craftmineQuitPrepared');
const identity={projectId:'project',sessionId:'session',turnId:'repair-turn'},job={context:identity,jobId:'gjob-'+'d'.repeat(64)};
async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fb02-shutdown-recovery-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const targetDeps={directory:path.join(directory,'targets'),selection:async()=> 'world',instance:()=>({worldId:'world',buildId:'build',instanceId:'native'}),
    descriptor:async()=>({worldId:'world',buildId:'build',baseId:'creation-sandbox',sourceRevision:1,manifestHash:'a'.repeat(64)}),
    sample:async()=>({worldId:'world',buildId:'build',instanceId:'native',baseId:'creation-sandbox',sampledAt:new Date().toISOString(),payload:{player:{position:[0,.9,6]}}}),fullAuto:async()=>true};
  const targets=createCreationTargetService(targetDeps);await targets.bindWorld(identity,'world','Keep the original player creation request');
  let performed=0;
  const queueDeps={directory:path.join(directory,'queue'),world:async()=> 'world',perform:async()=>{performed++;return {status:'repairing'};}};
  const queue=createCreationAutoQueue(queueDeps);await queue.completed(job);await queue.suspend();
  const calls=[],stops=createCreationStopIntents();
  const context={console,Error,Date,Promise,QUIT_TURN_SETTLE_BUDGET_MS:1000,
    activeTurns:new Map([['session','repair-turn']]),turnFinalizations:new Map(),planSubmissionTurnIds:new Set(),
    planSubmissionTurnKey:(session,turn)=>JSON.stringify([session,turn]),craftmineTelemetry:{finishAgentJob(){}},
    creationStopIntents:stops,creationTargets:targets,creationAutoQueue:queue,craftmineGateway:{end(){}},craftmineMaintenanceContexts:{has:()=>false},
    plugins:{endCraftmineTurn:async input=>calls.push(['core-end',input])},shouldCreateTaskNotification:()=>false,
    activeTurnUsages:new Map(),taskMetricsAdmissionFailures:new Set(),taskMetricsRecorder:{drain:async()=>({complete:true}),release(){}},
    host:{call:async(method,args)=>{calls.push([method,args]);return {};},},logger:{app(){}},scheduledRunsBySession:new Map(),resolvedCaptureModels:new Map(),turnSettlements:new Map(),activeToolCalls:new Map(),
    setTimeout:()=>({unref(){}}),inflightCheckpointer:{flushAll:async()=>{}},persistenceOutbox:{flush:async()=>{},size:()=>0},sidecar:null};
  vm.createContext(context);vm.runInContext(code,context);
  context.sidecar={call:async method=>{assert.equal(method,'agent.abort');await context.finishTurn('session','aborted','TURN_ABORTED');}};
  return {context,calls,targets,queue,stops,reopenTargets:()=>createCreationTargetService(targetDeps),reopenQueue:()=>createCreationAutoQueue(queueDeps),get performed(){return performed;}};
}
test('actual shutdown abort settles the model turn but keeps automatic repair authority and durable queue for restart',async t=>{
  const f=await fixture(t);await f.context.settleRunningTurnsForQuit();
  assert.equal(f.context.activeTurns.size,0);assert.equal(f.reopenTargets().owned(identity).autoApply,true);
  assert.equal(f.calls.find(([method])=>method==='session.endTurn')[1].errorCode,'APP_SHUTDOWN_INTERRUPTED');
  const restarted=f.reopenQueue();assert.equal(restarted.status(job.jobId,'session').status,'repairing');
  const before=f.performed;await restarted.resume();assert.equal(f.performed,before+1,'restart reconsiders the original durable receipt');
});
test('explicit player cancellation still revokes the repair chain when it races shutdown',async t=>{
  const f=await fixture(t);f.stops.user('session','repair-turn');f.targets.cancel('session','repair-turn');f.queue.cancel('session','repair-turn');
  await f.context.settleRunningTurnsForQuit();assert.equal(f.reopenTargets().owned(identity).autoApply,false);
  const restarted=f.reopenQueue(),before=f.performed;await restarted.resume();assert.equal(f.performed,before);assert.equal(restarted.status(job.jobId,'session').status,'cancelled');
});
