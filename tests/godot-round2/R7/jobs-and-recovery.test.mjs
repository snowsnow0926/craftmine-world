// Job status, durable usage and draft-recovery contract tests.
// No engine, no Rust binary, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {executorStatus,usageSummary,continueJob,listRecoverable,resumeDraft,explainRecovery,
  TOKEN_GATED_METHODS,MODEL_SAFE_METHODS}=require(path.join(root,'plugins/craftmine-world/godot-jobs.cjs'));

const CONTEXT={projectId:'project',sessionId:'session',turnId:'turn'};

test('executor-facing methods are never exposed to the model',()=>{
  for(const method of ['godotJob.claim','godotJob.progress','godotJob.heartbeat','godotJob.finish',
    'godotJob.checkDescriptor','godotExecutor.register','godotExecutor.revoke'])assert.ok(TOKEN_GATED_METHODS.includes(method),method);
  assert.deepEqual(Object.values(MODEL_SAFE_METHODS).filter(name=>name.startsWith('godotJob.')),
    ['godotJob.usage','godotJob.continue']);
});

test('executor status reports the real gate',async()=>{
  const calls=[];
  const core={call:async(method,params)=>{calls.push({method,params});
    return {format:'craftmine.godot-execution-status/1',build:false,check:false,buildBlockedReason:'GODOT_EXECUTOR_UNAVAILABLE',
      checkBlockedReason:'GODOT_EXECUTOR_UNAVAILABLE',executors:[]};}};
  const status=await executorStatus(core);
  assert.equal(status.scope,'executor');
  assert.equal(status.status.build,false);
  assert.equal(status.status.buildBlockedReason,'GODOT_EXECUTOR_UNAVAILABLE');
  assert.deepEqual(calls,[{method:'godotExecutor.status',params:{}}]);
});

test('durable usage keeps totals and does not invent missing ones',async()=>{
  const core={call:async()=>({items:[{jobId:'job-1',kind:'build',outcome:'passed',wallClockMillis:900}],
    totals:{executions:1,wallClockMillis:900}})};
  const usage=await usageSummary(core,{context:CONTEXT,worldId:'alpha'});
  assert.equal(usage.totals.executions,1);
  assert.equal(usage.totals.wallClockMillis,900);
  assert.equal(usage.totals.sourceBytes,null,'a missing total stays unknown');
  assert.match(usage.note,/never merged/);
});

test('usage requires a bound world and validates identifiers',async()=>{
  const core={call:async()=>({items:[]})};
  await assert.rejects(async()=>usageSummary(core,{context:CONTEXT}),/WORLD_ID_REQUIRED/);
  await assert.rejects(async()=>continueJob(core,{context:CONTEXT,worldId:'alpha',originJobId:'',toolCallId:'c1'}),/INVALID_ORIGIN_JOB_ID/);
  await assert.rejects(async()=>continueJob(core,{context:CONTEXT,worldId:'alpha',originJobId:'job-1',toolCallId:''}),/INVALID_TOOL_CALL_ID/);
});

test('continuing a job reports a missing adapter instead of guessing',async()=>{
  const core={call:async()=>{throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});}};
  const result=await continueJob(core,{context:CONTEXT,worldId:'alpha',originJobId:'job-1',toolCallId:'call-1'});
  assert.equal(result.available,false);
  assert.equal(result.requiredHostMethod,'godotJob.continue');
  assert.equal(result.owner,'R1');
});

test('recoverable drafts report resumability and hide other sessions',async()=>{
  const core={call:async()=>({items:[
    {taskId:'task-a',binding:{sessionId:'session'},generation:2,worldId:'alpha',draftRevision:4,draftHash:'a'.repeat(64),status:'interrupted'},
    {taskId:'task-b',binding:{sessionId:'other'},generation:1,worldId:'alpha',draftRevision:1,draftHash:'b'.repeat(64),status:'interrupted'},
    {taskId:'task-c',binding:{sessionId:'session'},generation:1,worldId:'alpha',draftRevision:2,draftHash:'c'.repeat(64),status:'finished'}
  ],modelReplay:false})};
  const listed=await listRecoverable(core,{projectId:'project',worldId:'alpha',sessionId:'session'});
  assert.deepEqual(listed.items.map(item=>item.taskId),['task-a','task-c'],'another session\'s draft is not listed');
  assert.deepEqual(listed.items.map(item=>item.resumable),[true,false]);
  assert.equal(listed.items[1].blockedReason,'NOT_INTERRUPTED');
  assert.ok(!listed.items.some(item=>Object.hasOwn(item,'sessionId')),'no session id is echoed to the model');
});

test('resume refuses a stale selection, a foreign draft and an unknown task',async()=>{
  const core={call:async(method,params)=>{
    if(method==='task.recoverable')return {items:[
      {taskId:'task-a',binding:{sessionId:'session'},generation:2,worldId:'alpha',draftRevision:4,draftHash:'a'.repeat(64),status:'interrupted'}],
      modelReplay:false};
    if(method==='task.resume')return {workspace:{worldId:'alpha'},generation:3,modelReplay:false};
    throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
  }};
  const ok=await resumeDraft(core,{context:CONTEXT,worldId:'alpha',taskId:'task-a',generation:2});
  assert.equal(ok.resumed,true);
  assert.equal(ok.generationAfter,3);
  const stale=await resumeDraft(core,{context:CONTEXT,worldId:'alpha',taskId:'task-a',generation:9});
  assert.equal(stale.resumed,false);
  assert.equal(stale.reason.code,'STALE_RECOVERY_SELECTION');
  const unknown=await resumeDraft(core,{context:CONTEXT,worldId:'alpha',taskId:'task-z',generation:1});
  assert.equal(unknown.resumed,false);
  assert.equal(unknown.reason.kind,'conflict');
  await assert.rejects(async()=>resumeDraft(core,{context:CONTEXT,worldId:'alpha',taskId:'task-a',generation:0}),/INVALID_GENERATION/);
});

test('a real resume failure is mapped to a player-readable reason',async()=>{
  const core={call:async(method)=>{
    if(method==='task.recoverable')return {items:[
      {taskId:'task-a',binding:{sessionId:'session'},generation:2,worldId:'alpha',draftRevision:4,draftHash:'a'.repeat(64),status:'interrupted'}]};
    throw Object.assign(Error('TASK_NOT_RECOVERABLE'),{errorCode:'TASK_NOT_RECOVERABLE'});
  }};
  const result=await resumeDraft(core,{context:CONTEXT,worldId:'alpha',taskId:'task-a',generation:2});
  assert.equal(result.resumed,false);
  assert.equal(result.reason.kind,'expired');
  assert.equal(result.reason.code,'TASK_NOT_RECOVERABLE');
  assert.match(result.reason.reason,/不能再次接续/);
});

test('recovery reasons cover expiry, conflict and unknown codes',()=>{
  assert.equal(explainRecovery('STALE_GENERATION').kind,'expired');
  assert.equal(explainRecovery('NEW_TURN_REQUIRED').kind,'conflict');
  assert.equal(explainRecovery('TASK_BINDING_MISMATCH').kind,'conflict');
  assert.equal(explainRecovery('WORLD_REVISION_CONFLICT').kind,'conflict');
  const unknown=explainRecovery('SOMETHING_NEW');
  assert.equal(unknown.kind,'unknown');
  assert.equal(unknown.unknown,true);
  assert.equal(unknown.code,'SOMETHING_NEW');
});
