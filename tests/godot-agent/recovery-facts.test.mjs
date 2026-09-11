import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {projectFacts}=require('../../plugins/craftmine-world/godot-observe.cjs');
const {usageSummary}=require('../../plugins/craftmine-world/godot-jobs.cjs');
const context={projectId:'p',sessionId:'s',turnId:'t'};
const pin='a'.repeat(64),oldPin='b'.repeat(64),outputHash='c'.repeat(64);
function fixture(){
 const task={binding:{...context,taskId:'task-current',baseBuild:'formal-build'},generation:3,status:'active',world:{id:'w'},draft:{revision:50,hash:'d'.repeat(64)},
  budget:{ownerTaskId:'original-owner',requestCount:6,toolCallCount:19,compactionCount:2,actualTokens:120,reservedTokens:80,unknownRequestCount:1,chargedTokens:200,remainingTokens:null,
   limits:{maxTokens:null,maxRequests:80,maxCompactions:8,deadlineAt:1234567890}},requirements:[{text:'MODEL_SUMMARY_SENTINEL'}],receipts:[{summary:'MODEL_SUMMARY_SENTINEL'}]};
 const latest={jobId:'gjob-last',worldId:'w',taskId:'task-current',buildId:'failed-build',kind:'check',status:'failed',stage:'import',sourceRevision:7,manifestHash:oldPin,branchId:'main',sourceStale:true,
  candidateId:'gcan-last',outputHash,createdAt:10,updatedAt:11,output:{format:'craftmine.godot-job-result/1',inputHash:'e'.repeat(64),passed:false,
   import:{passed:false,log:'SCRIPT ERROR: Parse Error: Expected parameter name.\n   at: GDScript::reload (res://actor.gd:2)'},compile:{passed:false,errors:['SCRIPT ERROR: Parse Error: Expected parameter name.']},check:{passed:false,assertions:[{id:'runtime.not-run',passed:false,detail:'GODOT_COMPILE_FAILED'}]}}};
 const candidate={candidateId:'gcan-last',worldId:'w',buildId:'failed-build',checkJobId:'gjob-last',checkOutputHash:outputHash,status:'rejected',sourceRevision:7,manifestHash:oldPin};
 const runtime={worldId:'w',phase:'formal',buildId:'formal-build',revision:99,sourceRevision:6,manifestHash:'f'.repeat(64),baseId:'creation-sandbox',snapshot:{},build:{godot:{engineVersion:'4.7.2-stable'}}};
 const state={task,latest,candidate,runtime,project:{worldId:'w',revision:8,manifestHash:pin,content:{branchId:'main'},baseId:'creation-sandbox',totalFiles:4},usage:{items:[],totals:{executions:0},limits:{sourceBytes:4000},unknown:['service','modelTokens']}};
 const calls=[],failures={};
 const core={call:async(method,args)=>{
  calls.push({method,args:structuredClone(args)});
  if(failures[method])throw Object.assign(Error('failure'),{errorCode:failures[method]});
  const values={'task.context':state.task,'godotBuild.latest':state.latest,'godotCandidate.read':{candidate:state.candidate},'godotCandidate.list':{items:[state.candidate],nextOffset:null},
   'godotRuntime.describe':state.runtime,'godotProject.index':state.project,'godotJob.usage':state.usage};
  assert.ok(Object.hasOwn(values,method),'no new mutation or unsupported RPC: '+method);return structuredClone(values[method]);
 }};
 return {state,calls,failures,core,read:()=>projectFacts({core,context,worldId:'w'})};
}

test('durable facts recover actual candidate IDs, draft/formal source identities and failed diagnostics after a fresh read',async()=>{
 const f=fixture(),first=await f.read(),second=await f.read();
 assert.equal(first.candidates.items[0].id,'gcan-last');assert.equal(first.candidates.items[0].candidateId,'gcan-last');
 assert.equal(first.candidates.items[0].sourceRevision,7);assert.equal(first.runtime.revision,99);assert.equal(first.runtime.sourceRevision,6);
 assert.equal(first.runtime.manifestHash,'f'.repeat(64));
 const job=first.recovery.latestJob;
 assert.equal(job.jobId,'gjob-last');assert.equal(job.scope,'current-task');assert.equal(job.status,'failed');
 assert.equal(job.sourceComparison.relation,'different-source');assert.equal(job.sourceComparison.projectSnapshot.revision,8);
 assert.equal(job.diagnostics.diagnostics[0].file,'res://actor.gd');assert.equal(job.diagnostics.diagnostics[0].line,2);
 assert.equal(job.diagnostics.diagnostics[0].fingerprint,second.recovery.latestJob.diagnostics.diagnostics[0].fingerprint);
 assert.equal(job.candidate.status,'rejected');assert.equal(job.formalBuildMatch,false);
 assert.equal(first.recovery.application.available,false);assert.match(first.recovery.application.reason,/NOT_DISCOVERABLE/);
 assert.match(first.block,/latestSessionJob: id=gjob-last scope=current-task status=failed/);
 assert.match(first.block,/diagnosticFingerprints: [0-9a-f]{64}/);
 assert.equal(JSON.stringify(first).includes('MODEL_SUMMARY_SENTINEL'),false);
});

test('session-latest request is host-scoped; a prior task failure is explicitly historical and never owns current budget',async()=>{
 const f=fixture();f.state.latest.taskId='task-old';
 const result=await f.read(),recovery=result.recovery;
 assert.deepEqual(f.calls.find(call=>call.method==='godotBuild.latest').args,{worldId:'w',sessionId:'s'});
 assert.equal(recovery.latestJob.scope,'same-session-other-task');assert.equal(recovery.latestJob.currentTaskMatch,false);
 assert.equal(recovery.currentTask.binding.taskId,'task-current');assert.equal(recovery.budget.value.ownerTaskId,'original-owner');
 assert.deepEqual(recovery.budget.value,f.state.task.budget);assert.equal(recovery.budget.value.limits.maxTokens,null);
 assert.equal(recovery.budget.value.unknownRequestCount,1);assert.equal(recovery.budget.value.reservedTokens,80);
 assert.equal(Object.hasOwn(recovery.budget,'stop'),false);
});

test('state is re-read without model memory or a second ledger and never changes persisted verdicts',async()=>{
 const f=fixture(),original=structuredClone(f.state.latest);
 await f.read();assert.deepEqual(f.state.latest,original);
 f.state.latest.status='passed';f.state.latest.sourceRevision=8;f.state.latest.manifestHash=pin;f.state.latest.output.passed=true;
 f.state.latest.output.import.log='';f.state.latest.output.compile.errors=[];f.state.latest.output.check={passed:true,assertions:[]};
 f.state.candidate.status='ready';f.state.task.budget.requestCount=7;
 const updated=await f.read();assert.equal(updated.recovery.latestJob.status,'passed');assert.equal(updated.recovery.latestJob.sourceComparison.relation,'same-source');
 assert.equal(updated.recovery.budget.value.requestCount,7);assert.equal(updated.recovery.latestJob.formalBuildMatch,false);
 assert.equal(updated.recovery.application.available,false,'passed check must not invent applying/applied');
});

test('foreign task/world/session replies fail before exposing recovery records',async()=>{
 for(const mutate of [s=>s.task.world.id='foreign',s=>s.task.binding.sessionId='foreign',s=>s.task.binding.turnId='old-turn']){
  const f=fixture();mutate(f.state);const r=(await f.read()).recovery;
  assert.equal(r.currentTask.available,false);assert.equal(r.budget.available,false);assert.equal(r.latestJob.available,false);
  assert.equal(f.calls.some(call=>call.method==='godotBuild.latest'),false);
 }
 for(const mutate of [s=>s.latest.worldId='foreign',s=>s.latest.sessionId='foreign']){
  const f=fixture();mutate(f.state);const r=(await f.read()).recovery;
  assert.equal(r.latestJob.available,false);assert.equal(r.latestJob.reason,'RECOVERY_JOB_IDENTITY_MISMATCH');
 }
 const f=fixture();f.state.project.worldId='foreign';f.state.runtime.worldId='foreign';f.state.candidate.worldId='foreign';
 const r=await f.read();assert.equal(r.project.available,false);assert.equal(r.runtime.available,false);assert.equal(r.candidates.available,false);
});

test('candidate mismatches cannot be attached to a different job or output hash',async()=>{
 for(const field of ['candidateId','buildId','checkJobId','checkOutputHash','worldId','sourceRevision','manifestHash']){
  const f=fixture();f.state.candidate[field]='foreign';const r=(await f.read()).recovery.latestJob;
  assert.equal(r.available,true);assert.equal(r.candidate.available,false);assert.equal(r.candidate.errorCode,'RECOVERY_CANDIDATE_IDENTITY_MISMATCH');
  assert.equal(r.candidateId,'gcan-last','failed detail read must retain the durable reference for further inspection');
 }
});

test('legacy missing fields and unsupported latest endpoint remain unknown without a world-latest fallback',async()=>{
 const f=fixture();delete f.state.latest.taskId;delete f.state.latest.sourceRevision;delete f.state.latest.manifestHash;
 delete f.state.runtime.sourceRevision;delete f.state.runtime.manifestHash;delete f.state.task.budget;
 let r=(await f.read()).recovery;
 assert.equal(r.latestJob.scope,'task-identity-unknown');assert.equal(r.latestJob.sourceComparison.relation,'unknown');
 assert.equal(r.application.formalSource.revision,null,'formal world revision is not source revision');assert.equal(r.budget.available,false);
 f.failures['godotBuild.latest']='UNKNOWN_METHOD';r=(await f.read()).recovery;
 assert.equal(r.latestJob.available,false);assert.equal(r.latestJob.errorCode,'UNKNOWN_METHOD');
 assert.ok(f.calls.filter(call=>call.method==='godotBuild.latest').every(call=>call.args.sessionId==='s'));
});

test('no matching job is an explicit empty result and no candidate query is attempted',async()=>{
 const f=fixture();f.state.latest=null;const r=(await f.read()).recovery;
 assert.deepEqual(r.latestJob,{available:true,found:false,scope:'verified-session',selection:'core-session-latest'});
 assert.equal(f.calls.some(call=>call.method==='godotCandidate.read'),false);
});

test('job usage retains core limit snapshot and unknown fields without treating them as model budgets',async()=>{
 const f=fixture();let result=await usageSummary(f.core,{context,worldId:'w'});
 assert.deepEqual(result.limits,{sourceBytes:4000});assert.deepEqual(result.unknown,['service','modelTokens']);
 assert.equal(result.limitsScope,'last-recorded-job-usage');
 delete f.state.usage.limits;delete f.state.usage.unknown;result=await usageSummary(f.core,{context,worldId:'w'});
 assert.equal(result.limits,null);assert.equal(result.unknown,null);
});

test('same formal build is recorded separately and never turns job recovery into application queue evidence',async()=>{
 const f=fixture();f.state.runtime.buildId='failed-build';
 const r=(await f.read()).recovery;
 assert.equal(r.latestJob.formalBuildMatch,true);assert.equal(r.latestJob.status,'failed');
 assert.equal(r.application.available,false);assert.equal(r.application.formalBuildId,'failed-build');
 assert.equal(r.application.formalSource.revision,6);
});
