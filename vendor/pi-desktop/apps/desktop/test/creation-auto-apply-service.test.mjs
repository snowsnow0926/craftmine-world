import assert from "node:assert/strict";
import test from "node:test";
import {createCreationAutoApplyService} from "../electron/main/creation-auto-apply-service.ts";
const input={jobId:"gjob-"+"1".repeat(64),context:{projectId:"project",sessionId:"session",turnId:"turn"}};
function fixture(){
  const state={capture:{snapshotId:"capture",worldId:"world",buildId:"formal",instanceId:"live",sourceRevision:1,manifestHash:"old",autoApply:true},
    job:{worldId:"world",jobId:input.jobId,kind:"check",status:"passed",baseId:"creation-sandbox",candidateId:"candidate",buildId:"new",sourceRevision:2,manifestHash:"new",outputHash:"proof",taskId:"task",branchId:"main"},
    candidate:{status:"ready",worldId:"world",checkJobId:input.jobId,buildId:"new",sourceRevision:2,manifestHash:"new",checkOutputHash:"proof"},
    source:{currentTaskId:"task",worldId:"world",baseId:"creation-sandbox",revision:2,manifestHash:"new"},checkStatus:"passed",active:true,applies:0,commits:0,beforeCommit:()=>{}};
  const service=createCreationAutoApplyService({capture:async()=>{if(!state.active)throw Error("CREATION_ACTIVE_TURN_REQUIRED");return structuredClone(state.capture);},
    domain:async method=>{
      if(method==="godotRuntime.describe")return {worldId:"world",baseId:"creation-sandbox",buildId:"formal",sourceRevision:1,manifestHash:"old"};
      if(method==="godotBuild.read")return structuredClone(state.job);
      if(method==="godotCandidate.read")return {candidate:structuredClone(state.candidate),checkStatus:state.checkStatus};
      if(method==="godotProject.index")return structuredClone(state.source);
      throw Error(method);
    },apply:async(worldId,candidateId,expected,guard)=>{state.applies++;assert.deepEqual(expected,{buildId:"formal",instanceId:"live"});state.beforeCommit();await guard();state.commits++;return {status:"applied",worldId,candidateId};}});
  return {state,service};
}
test("checked completion rereads host facts and coalesces duplicate callbacks",async()=>{
  const {state,service}=fixture();const results=await Promise.all([service.completed(input),service.completed(input)]);
  assert.equal(results[0].status,"applied");assert.equal(state.commits,1);
  assert.equal((await service.completed(input)).status,"applied");assert.equal(state.applies,1);
});
test("missing consent never invokes application",async()=>{
  const {state,service}=fixture();state.capture.autoApply=false;
  assert.equal((await service.completed(input)).status,"manual");assert.equal(state.applies,0);
});
for(const [label,change] of Object.entries({failed:s=>s.job.status="failed",cancelled:s=>s.job.status="cancelled",buildOnly:s=>s.job.kind="build",foreignTask:s=>s.source.currentTaskId="other",staleSource:s=>s.source.revision++,forgedProof:s=>s.candidate.checkOutputHash="forged",unready:s=>s.candidate.status="rejected",inactive:s=>s.active=false}))test(label+" completion never applies",async()=>{
  const {state,service}=fixture();change(state);await assert.rejects(service.completed(input));assert.equal(state.applies,0);
});
for(const [label,change] of Object.entries({revoked:s=>s.capture.autoApply=false,cancelled:s=>s.active=false,sourceChanged:s=>s.source.manifestHash="changed"}))test(label+" during launch prevents commit",async()=>{
  const {state,service}=fixture();state.beforeCommit=()=>change(state);await assert.rejects(service.completed(input));assert.equal(state.commits,0);
});
test("model-supplied proof and unbounded arguments are rejected",async()=>{
  const {state,service}=fixture();await assert.rejects(service.completed({...input,verified:true}));
  await assert.rejects(service.completed({...input,context:{...input.context,targetSnapshot:{}}}));assert.equal(state.applies,0);
});
