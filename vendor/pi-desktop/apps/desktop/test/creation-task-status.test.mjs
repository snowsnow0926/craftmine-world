import assert from 'node:assert/strict';
import test from 'node:test';
import {CreationTaskStatusObserver, parseCreationTaskStatus, creationTaskLabel, creationTaskPending} from '../src/lib/creation-task-status.ts';
const status = (phase, requirementStatus='not-requested') => ({worldId:'world-a',sessionId:'session-a',phase,requirementStatus});

test('actual adoption and requirement verification remain separate claims', () => {
  assert.match(creationTaskLabel(status('applied','passed'),true),/已采用 · 愿望检查通过/);
  for(const requirement of ['unsupported','not-requested','pending']) assert.match(creationTaskLabel(status('applied',requirement),true),/愿望结果待验证/);
  assert.match(creationTaskLabel(status('ready','failed'),true),/愿望检查未通过/);
  assert.equal(creationTaskPending(status('applied')),false);
  assert.equal(creationTaskPending(status('checking')),true);
});
test('unknown phase, wrong session and malformed host status are rejected', () => {
  for(const value of [null,{},status('success'),{...status('applied'),sessionId:'other'},status('ready','invented')]) assert.throws(()=>parseCreationTaskStatus(value,'session-a'));
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
