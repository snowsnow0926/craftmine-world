import assert from 'node:assert/strict';
import test from 'node:test';
import {CreationTaskStatusObserver, parseCreationTaskStatus, creationTaskLabel, creationTaskPending, creationTaskEvidence, creationResultError, canUseCreationResult} from '../src/lib/creation-task-status.ts';
const status = (phase, requirementStatus='not-requested') => ({worldId:'world-a',sessionId:'session-a',phase,requirementStatus});

test('actual adoption and requirement verification remain separate claims', () => {
  assert.equal(creationTaskLabel(status('applied','passed'),true),'已放入世界，可以试玩');
  assert.equal(creationTaskLabel(status('applied','passed'),false),'Added to world · ready to try');
  for(const requirement of ['passed','unsupported','not-requested','pending']){
    assert.doesNotMatch(creationTaskLabel(status('applied',requirement),true),/愿望检查通过|玩法.*通过/);
    assert.match(creationTaskEvidence(status('applied',requirement),true),/交互效果需实际试玩确认/);
    assert.match(creationTaskEvidence(status('applied',requirement),false),/need an actual playtest/);
  }
  assert.match(creationTaskLabel(status('ready','failed'),true),/需处理.*未通过/);
  assert.match(creationTaskLabel(status('ready','passed'),true),/暂无试玩副本/);
  assert.equal(creationTaskPending(status('applied')),false);
  assert.equal(creationTaskPending(status('checking')),true);
});
test('unknown phase, wrong session and malformed host status are rejected', () => {
  for(const value of [null,{},status('success'),{...status('applied'),sessionId:'other'},status('ready','invented'),{...status('ready'),error:{}},{...status('ready'),sourceStale:'false'},{...status('ready'),resultRequestRelation:'guessed'}]) assert.throws(()=>parseCreationTaskStatus(value,'session-a'));
});

test('candidate actions require fresh current-owner evidence even when a retained card stays visible',()=>{
  const ready={...status('ready','passed'),jobId:'job',buildId:'build',candidateId:'candidate',selectedWorldId:'world-a',resultRequestRelation:'current-request'};
  const flags={running:false,refreshing:false,unavailable:false};
  assert.equal(canUseCreationResult(ready,flags),true);
  for(const changed of [{running:true},{refreshing:true},{unavailable:true}])assert.equal(canUseCreationResult(ready,{...flags,...changed}),false);
  for(const patch of [{selectedWorldId:'world-b'},{sourceStale:true},{resultRequestRelation:'previous-request'},{resultRequestRelation:'unresolved'},{jobId:undefined},{phase:'checking'}])assert.equal(canUseCreationResult({...ready,...patch},flags),false);
});

test('visible errors explain the failure without presenting raw technical payloads as the main message',()=>{
  assert.match(creationResultError("Error invoking remote method: GODOT_CANDIDATE_ACTIVE",true),/世界正在处理其他操作/);
  assert.match(creationResultError('CREATION_RESULT_STALE',false),/draft or target changed/);
  assert.match(creationResultError('SAVE_TEMPORARILY_UNAVAILABLE',true),/保存未完成/);
  assert.doesNotMatch(creationResultError('UNKNOWN_INTERNAL_ERROR: stack',true),/UNKNOWN|stack/);
});
test('terminal host state stays visible until changed and a reopened observer rereads it', async () => {
  let reads=0;const seen=[];
  const read=async()=>{reads++;return status('applied','passed');};
  const observer=new CreationTaskStatusObserver(read,(value)=>seen.push(value));
  await observer.refresh();assert.equal(seen.at(-1).phase,'applied');observer.dispose();
  const reopened=new CreationTaskStatusObserver(read,value=>seen.push(value));await reopened.refresh();reopened.dispose();
  assert.equal(reads,2);assert.equal(seen.at(-1).phase,'applied');
});
test('world-change refresh and disposal reject old asynchronous results',async()=>{
  let oldResolve;let reads=0;const seen=[];
  const observer=new CreationTaskStatusObserver(()=>++reads===1?new Promise(resolve=>oldResolve=resolve):Promise.resolve({...status('failed'),worldId:'world-b'}),value=>seen.push(value));
  const old=observer.refresh();await observer.refresh();oldResolve(status('applied'));await old;
  assert.deepEqual(seen.map(value=>value.worldId),['world-b']);observer.dispose();await observer.refresh();assert.equal(reads,2);
});
test('read failure never converts the last known task to success',async()=>{
  const seen=[];const observer=new CreationTaskStatusObserver(async()=>{throw Error('OFFLINE');},(value,unavailable)=>seen.push({value,unavailable}));
  await observer.refresh();observer.dispose();assert.deepEqual(seen,[{value:null,unavailable:true}]);
});
test('interruption cancellation and successful recovery have distinct visible outcomes',()=>{
  assert.match(creationTaskLabel(status('interrupted'),true),/中断/);
  assert.match(creationTaskLabel(status('cancelled'),true),/取消/);
  assert.match(creationTaskLabel(status('recovered'),true),/已恢复/);
});
