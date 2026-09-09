import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fields} from '../../app/harness/contracts.mjs';
const require=createRequire(import.meta.url);
const {createHistoryService}=require('../../plugins/craftmine-world/godot-history.cjs');
const ref=(commit='a')=>({repoId:'repo-alpha',commitOid:commit.repeat(40),assetLockHash:'e'.repeat(64)});
function fixture(){
  const calls=[];
  const core={start:async()=>{},call:async(method,params)=>{
    calls.push({method,params});
    if(method==='content.status')return {registered:true,repoId:'repo-alpha'};
    return {items:[],worldId:params.worldId,jobId:'host-job'};
  }};
  return {core,calls,history:createHistoryService({core,context:{},workspace:{worldId:'alpha',task:{binding:{}}}})};
}
test('history reads use exact core fields without writable branch identity',async()=>{
  const {history,calls}=fixture();
  assert.equal((await history.history({cursor:'4',limit:8})).available,true);
  assert.deepEqual(calls,[{method:'content.history',params:{worldId:'alpha',skip:4,limit:8}}]);
  assert.throws(()=>history.history({cursor:'not-a-cursor'}),/INVALID_HISTORY_CURSOR/);
});
test('version and range reads bind repository before supplying exact commits',async()=>{
  const {history,calls}=fixture();
  await history.version({contentRef:ref()});
  await history.diff({from:ref(),to:ref('b')});
  assert.deepEqual(calls[1],{method:'content.history',params:{worldId:'alpha',rev:'a'.repeat(40),skip:0,limit:1}});
  assert.deepEqual(calls[3],{method:'content.changes',params:{worldId:'alpha',from:'a'.repeat(40),to:'b'.repeat(40)}});
  await assert.rejects(history.version({contentRef:{...ref(),repoId:'foreign'}}),/CONTENT_REF_WORLD_MISMATCH/);
});
test('operation reads call the pure RPC, never recovery',async()=>{
  const {history,calls}=fixture();
  await history.operationResult({operationId:'op-1'});
  assert.deepEqual(calls,[{method:'content.operation.read',params:{worldId:'alpha',operationId:'op-1'}}]);
});
test('history proposals perform no writes',()=>{
  const {history,calls}=fixture();
  assert.equal(history.checkpoint({contentRef:ref(),label:'checkpoint'}).requiresPlayerAction,true);
  assert.equal(history.mergeCandidate({from:ref(),to:ref('b')}).applies,false);
  assert.equal(calls.length,0);
});
function router(godotExecutor,packageTurns){
  const source=readFileSync(new URL('../../plugins/craftmine-world/host-requests.cjs',import.meta.url),'utf8');
  const module={exports:{}};
  vm.runInThisContext('(function(require,module,exports){'+source+'\n})')(
    name=>{assert.equal(name,'./domain.cjs');return {fields};},module,module.exports);
  const {core,calls}=fixture();
  return {calls,handle:module.exports.createHostRequests(core,{godotExecutor,packageTurns})};
}

test('private package status uses only its bounded lifecycle route',async()=>{
  const reads=[];
  const {handle,calls}=router(undefined,{readJob:async args=>{reads.push(args);return {status:'passed'};}});
  assert.equal((await handle('package.sourceJob',{worldId:'alpha',jobId:'job'})).status,'passed');
  await assert.rejects(handle('package.sourceJob',{worldId:'alpha',jobId:'job',context:{}}));
  assert.deepEqual(reads,[{worldId:'alpha',jobId:'job'}]);assert.deepEqual(calls,[]);
  await assert.rejects(router().handle('package.sourceJob',{worldId:'alpha',jobId:'job'}),/LIFECYCLE_REQUIRED/);
});
test('private application confirmation rejects old self-attestation',async()=>{
  const {handle,calls}=router();
  await handle('content.apply.confirm',{operationId:'op',applicationId:'app',detail:'verified'});
  await assert.rejects(handle('content.apply.confirm',{operationId:'op',appliedOid:'a',detail:'claim'}));
  assert.equal(calls.length,1);
});
test('portable and history private routes forward exact fields',async()=>{
  const {handle,calls}=router();
  const cases=[['backup.exportPortable',{operationId:'exp',archivePath:'archive'}],
    ['backup.inspectPortable',{archivePath:'archive'}],['backup.verifyPortable',{archivePath:'archive'}],
    ['backup.restorePortable',{operationId:'restore',archivePath:'archive',targetDirectory:'target'}],
    ['backup.cancelPortable',{operationId:'restore'}],['backup.protectedRefs',{worldId:'alpha'}],
    ['backup.releasePortable',{archiveId:'archive'}],['content.operation.read',{worldId:'alpha',operationId:'op'}],
    ['workspace.endTurn',{sessionId:'s',turnId:'t',status:'completed'}],
    ['task.recoverable',{projectId:'initialization',worldId:'alpha'}],
    ['asset.bodyPath',{assetId:'a',version:1,path:'asset.png'}],
    ['godotProject.patch',{context:{},worldId:'alpha',toolCallId:'t',revision:1,manifestHash:'h',operations:[],operation:{}}]];
  for(const [method,args]of cases){await handle(method,args);await assert.rejects(handle(method,{...args,arbitraryShell:'no'}));}
  assert.equal(calls.length,cases.length);
});
test('existing authorized build routes dispatch core results and cancellation to the owned executor',async()=>{
  const sent=[];
  const {handle}=router({enqueue:async(job,context)=>{sent.push({job,context});return {enqueued:true};},cancel:async id=>({cancelled:id==='host-job'})});
  const context={sessionId:'session',turnId:'turn',projectId:'project'};
  assert.equal((await handle('godotBuild.start',{context,worldId:'alpha',toolCallId:'t',revision:1,manifestHash:'h',mode:'check'})).execution.enqueued,true);
  assert.equal(sent[0].job.jobId,'host-job');
  assert.deepEqual(sent[0].context,context);
  assert.equal((await handle('godotBuild.cancel',{worldId:'alpha',jobId:'host-job'})).execution.cancelled,true);
});
