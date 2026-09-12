import test from 'node:test';
import assert from 'node:assert/strict';
import {observeGodotPerformance} from '../../plugins/craftmine-world/godot-performance-observation.mjs';
const scope={worldId:'w1',buildId:'b1',instanceId:'i1'};
const sample={...scope,sampledAt:'2026-09-12T00:00:00Z',memoryWorkingSetMb:120.5,provenance:'electron-app-metrics',measurementScope:'renderer-process',rendererProcessId:42};
const project=(patch={},expected=scope)=>observeGodotPerformance({scope:expected,sample:{...sample,...patch},now:()=> '2026-09-12T00:00:01Z'});

test('only actual process channel is projected; invented engine metrics stay unknown',()=>{
  const r=project({frameTimeMs:6.2,physicsStepMs:0,objectCount:14,gpuTimeMs:0});
  assert.equal(r.available,true);assert.equal(r.measured.memoryWorkingSetMb.value,120.5);
  assert.equal(r.measured.memoryWorkingSetMb.unit,'MiB');
  for(const key of ['frameTimeMs','objectCount','physicsStepMs','gpuTimeMs'])assert.equal(r.measured[key].status,'unknown');
  assert.match(r.measurementHash,/^[a-f0-9]{64}$/);
  assert.notEqual(project({rendererProcessId:43}).measurementHash,r.measurementHash);
  assert.notEqual(project({memoryWorkingSetMb:121}).measurementHash,r.measurementHash);
  assert.deepEqual(project({}, {...scope,secret:'not forwarded'}).scope,scope);
});

test('rejects foreign identities, stale times, invalid values and untrusted measurement origins',()=>{
  const missing=project({memoryWorkingSetMb:undefined});
  assert.equal(missing.reason,'PERFORMANCE_MEMORY_UNAVAILABLE');
  assert.ok(Object.values(missing.measured).every(field=>field.status==='unknown'));
  for(const key of ['worldId','buildId','instanceId'])assert.throws(()=>project({[key]:'other'}),/SCOPE_MISMATCH/);
  for(const value of [-1,NaN,Infinity,null,'120'])assert.throws(()=>project({memoryWorkingSetMb:value}),/INVALID_PERFORMANCE_VALUE/);
  assert.throws(()=>project({sampledAt:'x'}),/SAMPLE_TIME/);
  for(const sampledAt of ['2026-09-11T23:59:00Z','2026-09-12T00:01:00Z'])assert.throws(()=>project({sampledAt}),/STALE/);
  for(const patch of [{provenance:'game-payload'},{measurementScope:'world'},{rendererProcessId:0},{rendererProcessId:1.5}])assert.throws(()=>project(patch),/PROVENANCE_UNVERIFIED/);
});
