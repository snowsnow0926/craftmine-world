import assert from 'node:assert/strict';
export function assertFormalPackageCheck(worldId,imported,job){
  assert.equal(imported.worldId,worldId);assert.equal(imported.applied,false);assert.equal(imported.status,'check-queued');
  assert.equal(job.worldId,worldId);assert.equal(job.jobId,imported.job.id);assert.equal(job.kind,'check');assert.equal(job.status,'passed');
  assert.equal(job.sourceRevision,imported.source.revision);assert.equal(job.manifestHash,imported.source.manifestHash);
  assert.equal(job.executorId,'craftmine-windows-broker-v1');assert.equal(job.output?.passed,true);
  assert.equal(job.output?.import?.passed,true);assert.equal(job.output?.compile?.passed,true);assert.equal(job.output?.check?.passed,true);
  for(const id of ['runtime.ready','runtime.frame','runtime.no-errors','runtime.snapshot','runtime.isolation','runtime.recovery']){
    const matches=job.output.check.assertions.filter(row=>row.id===id);assert.equal(matches.length,1,id);assert.equal(matches[0].passed,true,id);
  }
  assert.ok(job.candidateId&&job.buildId);
}
export function assertFormalAdoption(worldId,job,preview,applied,observed){
  assert.equal(preview.buildId,job.buildId);assert.equal(applied.status,'applied');assert.equal(applied.worldId,worldId);assert.equal(applied.candidateId,job.candidateId);
  assert.equal(applied.record.world.build.id,job.buildId);assert.equal(observed.worldId,worldId);assert.equal(observed.buildId,job.buildId);
}
export function assertFormalCold(before,after){
  assert.equal(before.snapshot.state?.format,'craftmine.godot-progress/1');assert.equal(before.snapshot.state?.worldId,before.observation.worldId);
  assert.equal(after.observed.worldId,before.observation.worldId);assert.equal(after.observed.buildId,before.observation.buildId);
  assert.notEqual(after.observed.instanceId,before.observation.instanceId,'cold reopen must create a new runtime instance');
  assert.deepEqual(after.sources.items.map(item=>item.entityId).sort(),before.sources.items.map(item=>item.entityId).sort());
  assert.equal(after.sources.manifestHash,before.sources.manifestHash);assert.equal(after.sources.revision,before.sources.revision);
  assert.deepEqual(after.snapshot.state,before.snapshot.state,'existing base snapshot survives; module parameter state is outside this snapshot contract');
}
