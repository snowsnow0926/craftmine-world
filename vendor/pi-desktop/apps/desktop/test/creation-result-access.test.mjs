import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./helpers/ts-import-hooks.mjs',import.meta.url);
const {assertCreationResultAccess}=await import('../electron/main/creation-result-access.ts');
const {creationTaskStatus}=await import('../electron/main/creation-task-status.ts');
const identity={sessionId:'session-one',worldId:'world-one',jobId:'job-one',candidateId:'candidate-one',buildId:'build-one'};
const request={action:'open',...identity};
const job={...identity,status:'passed',sourceStale:false};
const candidate={...identity,status:'ready',checkJobId:identity.jobId};
function access(overrides={}){return {viewingSession:()=>identity.sessionId,selectedWorld:async()=>identity.worldId,
  domain:async method=>method==='godotBuild.latest'?job:{candidate,checkStatus:'passed'},...overrides};}
test('unopened exact result supports preview and direct adoption, without raw application tokens',async()=>{
  for(const action of ['open','adopt'])await assertCreationResultAccess({...request,action},access());
  await assert.rejects(assertCreationResultAccess({...request,token:'forged'},access()),/INVALID_PREVIEW/);
});
test('every stale identity and foreign session/world is refused before preview',async()=>{
  for(const key of Object.keys(identity))await assert.rejects(assertCreationResultAccess({...request,[key]:'other'},access()),/CONTEXT_CHANGED|RESULT_STALE/);
  await assert.rejects(assertCreationResultAccess(request,access({domain:async()=>({...job,sourceStale:true})})),/RESULT_STALE/);
  await assert.rejects(assertCreationResultAccess(request,access({domain:async method=>method==='godotBuild.latest'?job:{candidate:{...candidate,checkJobId:'old'},checkStatus:'passed'}})),/RESULT_STALE/);
});
test('a switch while reading facts cancels the action, and a failed read stays retryable',async()=>{
  let selected=identity.worldId;
  await assert.rejects(assertCreationResultAccess(request,access({selectedWorld:async()=>selected,domain:async method=>{
    if(method==='godotBuild.latest')return job;selected='changed';return {candidate,checkStatus:'passed'};
  }})),/CONTEXT_CHANGED/);
  await assert.rejects(assertCreationResultAccess(request,access({domain:async()=>{throw Error('OFFLINE');}})),/OFFLINE/);
  await assertCreationResultAccess(request,access());
});
test('pending automation remains distinct from durable formal adoption and carries action identity',()=>{
  const formal={worldId:identity.worldId,buildId:'previous',baseId:'creation-sandbox'};
  const automatic={jobId:job.jobId,context:{sessionId:identity.sessionId},status:'deferred',reason:'WORLD_BUSY'};
  const state=creationTaskStatus(identity.worldId,identity.sessionId,job,formal,false,automatic);
  assert.equal(state.phase,'deferred');assert.equal(state.candidateId,identity.candidateId);assert.equal(state.buildId,identity.buildId);
  assert.equal(creationTaskStatus(identity.worldId,identity.sessionId,job,{...formal,buildId:identity.buildId},false,automatic).phase,'applied');
  assert.equal(creationTaskStatus(identity.worldId,identity.sessionId,job,formal,false,{...automatic,context:{sessionId:'other'}}).phase,'ready');
});
test('maintenance successor retains adoption while a real rollback becomes historical, never an apply invitation',()=>{
  const formal={worldId:identity.worldId,buildId:'maintenance-successor',baseId:'creation-sandbox'};
  const adoption={...identity,currentBuildId:formal.buildId,wasApplied:true,inCurrentLineage:true};
  const state=creationTaskStatus(identity.worldId,identity.sessionId,job,formal,false,null,adoption);
  assert.equal(state.phase,'applied');assert.equal(state.laterVersion,true);
  const rolledBack=creationTaskStatus(identity.worldId,identity.sessionId,job,formal,false,null,{...adoption,inCurrentLineage:false});
  assert.equal(rolledBack.phase,'historical');
  for(const field of ['worldId','candidateId','buildId','currentBuildId'])assert.equal(creationTaskStatus(identity.worldId,identity.sessionId,job,formal,false,null,{...adoption,[field]:'foreign'}).phase,'ready');
});
