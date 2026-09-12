import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {creationRequestStatus}=await import('../electron/main/creation-request-status.ts');
const task=(session,turn)=>'work-'+createHash('sha256').update(JSON.stringify([session,turn])).digest('hex');
test('a prior applied job does not prove a later interrupted request completed',()=>{
  const result=creationRequestStatus('s',{worldId:'w',taskId:task('s','before')},{turnId:'now',status:'aborted'});
  assert.equal(result.resultRequestRelation,'previous-request');assert.equal(result.latestRequest.status,'aborted');
  assert.equal(creationRequestStatus('s',{worldId:'w',taskId:task('s','now')},{turnId:'now',status:'completed'}).resultRequestRelation,'current-request');
});
test('automatic repair can share an exact host capture but another world or request cannot',()=>{
  const job={worldId:'w',taskId:task('s','author')},latest={turnId:'repair',status:'running'},capture={worldId:'w',snapshotId:'snapshot-one'};
  assert.equal(creationRequestStatus('s',job,latest,capture,{...capture}).resultRequestRelation,'current-request');
  for(const old of [{worldId:'other',snapshotId:'snapshot-one'},{worldId:'w',snapshotId:'snapshot-two'},null])
    assert.equal(creationRequestStatus('s',job,latest,capture,old).resultRequestRelation,'previous-request');
});
test('missing authoritative turn or job remains unresolved',()=>{
  assert.equal(creationRequestStatus('s',{taskId:'old'},null).resultRequestRelation,'unresolved');
  assert.equal(creationRequestStatus('s',null,{turnId:'new'}).resultRequestRelation,'unresolved');
});
