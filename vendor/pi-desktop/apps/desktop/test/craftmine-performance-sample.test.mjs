import test from 'node:test';
import assert from 'node:assert/strict';
import {createCraftminePerformanceSampler} from '../electron/main/craftmine-performance-sample.ts';
const identity={worldId:'world-1',buildId:'build-1',instanceId:'instance-1',rendererProcessId:321,webContentsId:3};
const timestamp=Date.parse('2026-09-12T00:00:00Z');
const memory=[{pid:321,type:'Tab',memory:{workingSetSize:1536}}];

test('measures matching OS renderer working set in MiB without inventing engine metrics',async()=>{
  const sample=await createCraftminePerformanceSampler(()=>identity,()=>memory,()=>timestamp)({worldId:'world-1'});
  assert.equal(sample.memoryWorkingSetMb,1.5);assert.equal(sample.memoryUnit,'MiB');
  assert.equal(sample.provenance,'electron-app-metrics');assert.equal(sample.measurementScope,'renderer-process');
  assert.equal(sample.sampledAt,'2026-09-12T00:00:00.000Z');
  for(const key of ['frameTimeMs','physicsStepMs','objectCount']){assert.equal(sample[key],undefined);assert.ok(sample.unavailable[key]);}
});
test('no instance and invalid/narrowed identities never collect another process',async()=>{
  let calls=0;const collect=()=>{calls++;return memory;};
  assert.equal(await createCraftminePerformanceSampler(()=>null,collect)(),null);
  const sample=createCraftminePerformanceSampler(()=>identity,collect);
  for(const input of [{worldId:'other'},{buildId:'other'},{instanceId:'other'},{worldId:''},{rendererProcessId:321},[]])await assert.rejects(sample(input));
  assert.equal(calls,0);
});
test('instance, build, view and PID changes during asynchronous metrics fail closed',async()=>{
  for(const key of Object.keys(identity)){
    let current={...identity};const read=createCraftminePerformanceSampler(()=>current,async()=>{
      current={...current,[key]:typeof current[key]==='number'?current[key]+1:current[key]+'-next'};return memory;
    });
    await assert.rejects(read(),/PERFORMANCE_INSTANCE_CHANGED/);
  }
  let current={...identity};await assert.rejects(createCraftminePerformanceSampler(()=>current,async()=>{current=null;return memory;})(),/PERFORMANCE_INSTANCE_CHANGED/);
});
test('missing, ambiguous, other process and invalid metrics stay unavailable; a real zero is retained',async()=>{
  for(const metrics of [[],[{...memory[0],pid:322}],[{...memory[0],type:'GPU'}],[...memory,...memory],
    [{...memory[0],memory:{}}],...[-1,NaN,Infinity].map(n=>[{...memory[0],memory:{workingSetSize:n}}])]){
    const sample=await createCraftminePerformanceSampler(()=>identity,()=>metrics)();
    assert.equal(sample.memoryWorkingSetMb,undefined);assert.ok(sample.unavailable.memoryWorkingSetMb);
  }
  assert.equal((await createCraftminePerformanceSampler(()=>identity,()=>[{...memory[0],memory:{workingSetSize:0}}])()).memoryWorkingSetMb,0);
});
test('host lifecycle and OS failures propagate rather than produce successful fake samples',async()=>{
  await assert.rejects(createCraftminePerformanceSampler(()=>{throw Error('WORLD_BUSY');},()=>memory)(),/WORLD_BUSY/);
  await assert.rejects(createCraftminePerformanceSampler(()=>identity,()=>{throw Error('OS unavailable');})(),/OS unavailable/);
  await assert.rejects(createCraftminePerformanceSampler(()=>({...identity,rendererProcessId:0}),()=>memory)(),/PERFORMANCE_PROCESS_UNAVAILABLE/);
});
