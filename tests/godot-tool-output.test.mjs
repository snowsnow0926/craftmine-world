import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const {compactGodotBuildRead,compactGodotProjectFacts}=require('../plugins/craftmine-world/godot-tool-output.cjs');
const {diagnoseGodotBuildRead}=require('../plugins/craftmine-world/godot-diagnostics.cjs');
const packed=path.resolve(process.env.CRAFTMINE_DIAGNOSTIC_PLUGIN??'test-results/native-diagnostics-plugin');
const {createWorldTools}=require(path.join(packed,'world-tools.cjs'));
const sha=value=>createHash('sha256').update(value).digest('hex');
test('packaging includes exact summary module and tool schema',()=>{
  assert.deepEqual(fs.readFileSync(path.join(packed,'godot-tool-output.cjs')),fs.readFileSync(new URL('../plugins/craftmine-world/godot-tool-output.cjs',import.meta.url)));
  const manifest=JSON.parse(fs.readFileSync(path.join(packed,'manifest.json'),'utf8'));
  assert.deepEqual(manifest.contributes.agentTools.find(item=>item.name==='godot_build_read').schema.properties.detail.enum,['summary','full']);
});
function fixture(status='passed'){
  const record={jobId:'gjob-'+'1'.repeat(64),worldId:'w',buildId:'b',sourceRevision:6,manifestHash:'a'.repeat(64),sourceStale:false,status,kind:'check',candidateId:'c',outputHash:'b'.repeat(64),
    applicationGuidance:{authority:'current-host-capture',adoptionConfirmed:false,reason:'CREATION_AUTO_APPLY_NOT_AUTHORIZED'},creationApplication:{status:'manual'},artifacts:[{path:'game.wasm',sha256:'c'.repeat(64)}],
    output:{format:'craftmine.godot-job-result/1',passed:status==='passed',import:{passed:true,log:('ERROR: Call to GetAdaptersAddresses failed with error 5.\n   at: get_local_interfaces (drivers/windows/ip_windows.cpp:117)\n').repeat(9)+'ordinary import progress\n'.repeat(1000)},compile:{passed:true,errors:[],warnings:[]},check:{passed:status==='passed',assertions:[{id:'runtime.no-errors',passed:true}],diagnosticLog:'ordinary runtime trace\n'.repeat(1000),defaultsSnapshot:{objects:Array(100).fill({id:'object',state:{}})}}}};
  record.output.artifacts=structuredClone(record.artifacts);record.diagnostics=diagnoseGodotBuildRead(record);return record;
}
test('passed checks retain all observations and authority while duplicate logs become exact references',()=>{
  const original=fixture(),before=JSON.stringify(original),result=compactGodotBuildRead(original);
  assert.equal(JSON.stringify(original),before);assert.equal(result.status,'passed');assert.equal(result.output.passed,true);assert.equal(result.output.check.passed,true);assert.equal(result.sourceStale,false);
  assert.deepEqual(result.applicationGuidance,original.applicationGuidance);assert.deepEqual(result.creationApplication,original.creationApplication);assert.equal(result.outputHash,original.outputHash);
  assert.equal(result.output.import.log.sha256,sha(original.output.import.log));assert.equal(result.output.import.log.characters,original.output.import.log.length);
  assert.equal(result.diagnostics.originalDiagnosticCount,9);assert.equal(result.diagnostics.diagnostics.length,1);assert.equal(result.diagnostics.diagnostics[0].occurrences,9);assert.equal(result.diagnostics.diagnostics[0].severity,'observed');assert.equal(result.diagnostics.acceptance,'not-assessed');
  assert.equal(result.diagnostics.diagnostics[0].sourceRef,'/diagnostics/source');assert.equal(result.diagnostics.source.jobId,original.jobId);assert.equal(result.diagnostics.diagnostics[0].evidenceRefs.length,9);
  assert.deepEqual(result.summary.fullRead,{tool:'godot_build_read',args:{jobId:original.jobId,detail:'full'}});assert(JSON.stringify(result).length<before.length/3);
});
test('different errors and source pins never merge; stale/native/requirements evidence is not erased',()=>{
  const value=fixture('failed');value.sourceStale=true;value.output.compile.errors=['Parse Error: Missing symbol','Parse Error: Different symbol'];value.output.compile.passed=false;value.output.check.passed=false;value.diagnostics=diagnoseGodotBuildRead(value);
  const other=structuredClone(value.diagnostics.diagnostics.at(-1));other.source.jobId='different-job';value.diagnostics.diagnostics.push(other);
  const result=compactGodotBuildRead(value);assert.equal(result.status,'failed');assert.equal(result.sourceStale,true);assert.equal(result.output.check.passed,false);assert.deepEqual(result.output.compile,value.output.compile);
  assert(result.diagnostics.diagnostics.some(item=>item.category==='stale'));assert(result.diagnostics.diagnostics.some(item=>item.source?.jobId==='different-job'));
  assert.deepEqual(result.diagnostics.omissions,value.diagnostics.omissions);assert.equal(result.diagnostics.requirementsEvidenceBinding,value.diagnostics.requirementsEvidenceBinding);
});
test('facts retain source comparison, historic task scope and recovery budget unchanged',()=>{
  const job=fixture(),facts={project:{revision:7},recovery:{budget:{value:{actualTokens:33,maxTokens:null}},application:{available:false},latestJob:{jobId:job.jobId,status:job.status,sourceStale:true,scope:'same-session-other-task',sourceComparison:{relation:'different-source'},diagnostics:job.diagnostics,candidate:{status:'ready'}}}};
  const result=compactGodotProjectFacts(facts);assert.deepEqual(result.recovery.budget,facts.recovery.budget);assert.deepEqual(result.recovery.application,facts.recovery.application);assert.deepEqual(result.recovery.latestJob.sourceComparison,facts.recovery.latestJob.sourceComparison);assert.equal(result.recovery.latestJob.scope,'same-session-other-task');assert.equal(result.recovery.latestJob.sourceStale,true);assert.equal(result.recovery.latestJob.diagnostics.diagnostics[0].sourceRef,'/recovery/latestJob/diagnostics/source');
});
test('production tool offers full evidence explicitly and never forwards representation options to Core',async()=>{
  const record=fixture('failed'),calls=[];
  const core={start:async()=>({}),call:async(method,params)=>{calls.push({method,params});if(method==='workspace.open')return {worldId:'w',task:{binding:{taskId:'t'}}};assert.equal(method,'godotBuild.read');assert(!Object.hasOwn(params,'detail'));return structuredClone(record);}};
  const tool=createWorldTools(core,async()=>({activeWorldId:'w'})).find(item=>item.name==='godot_build_read'),invocation={projectId:'p',sessionId:'s',turnId:'t',executionId:'e',toolCallId:'read'};
  const summary=await tool.execute({jobId:record.jobId},invocation),full=await tool.execute(summary.summary.fullRead.args,invocation);
  assert.equal(summary.output.import.log.representation,'omitted-from-summary');assert.deepEqual(full.output,record.output);assert.equal(full.status,record.status);assert.equal(full.sourceStale,record.sourceStale);assert(!full.summary);assert.equal(full.diagnostics.diagnostics.length,record.diagnostics.diagnostics.length);
  for(const key of ['status','sourceStale','applicationGuidance','creationApplication'])assert.deepEqual(summary[key],full[key]);
  for(const item of full.diagnostics.diagnostics)assert(summary.diagnostics.diagnostics.some(group=>group.errorCode===item.errorCode&&group.message===item.message&&group.messageHash===item.messageHash&&group.severity===item.severity));
  await assert.rejects(tool.execute({jobId:record.jobId,detail:'unsafe'},invocation),/INVALID_GODOT_BUILD_READ_DETAIL/);
  assert.equal(calls.filter(item=>item.method==='godotBuild.read').length,2);
});
