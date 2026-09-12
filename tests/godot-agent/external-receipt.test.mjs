import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateExternalReceipt} from '../../scripts/lib/godot-external-receipt.mjs';
const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../docs/evidence/gu6-open-source-20260912');
const summary=JSON.parse(fs.readFileSync(path.join(directory,'summary.json')));
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(kit=summary.kits[0],operation=kit.operations[0]){
  const receipt=JSON.parse(fs.readFileSync(path.join(directory,operation.receipt)));
  // Expected values come from the host trial summary/staged manifest, not from
  // sourceBinding or identity fields in the receipt under test.
  const request={schemaVersion:1,requestId:operation.taskId,taskId:operation.taskId,operation:operation.operation,
    inputHash:sha(operation.taskId),sourceBinding:{worldId:'isolated-external-starter-trial',buildId:operation.taskId,sourceRevision:1,sourceDigest:kit.modifiedDigest}};
  const expectedSourceFiles=JSON.parse(fs.readFileSync(path.join(directory,kit.id+'-source-files.json'))).modified;
  const options={brokerSha256:operation.brokerSha256,transportExitCode:operation.transportExitCode,expectedSourceFiles};
  return {request,receipt,options};
}
test('six archived real LPAC receipts match independent host identity, copied source and policy evidence',()=>{
  let checked=0;
  for(const kit of summary.kits)for(const operation of kit.operations){
    const {request,receipt,options}=fixture(kit,operation);
    assert.deepEqual(validateExternalReceipt(request,receipt,options),{valid:true,errors:[]});checked++;
  }
  assert.equal(checked,6);
});
test('successful-looking receipts with any wrong request identity are rejected',()=>{
  for(const field of ['requestId','taskId','operation','inputHash']){
    const {request,receipt,options}=fixture();receipt[field]='incorrect';
    const result=validateExternalReceipt(request,receipt,options);assert.equal(result.valid,false,field);
    assert.ok(result.errors.includes('RECEIPT_'+field.toUpperCase()+'_MISMATCH'));
  }
  for(const field of ['worldId','buildId','sourceRevision','sourceDigest']){
    const {request,receipt,options}=fixture();receipt.sourceBinding[field]='wrong';
    assert.ok(validateExternalReceipt(request,receipt,options).errors.includes('RECEIPT_SOURCE_BINDING_MISMATCH'));
  }
});
test('source changed after staging cannot pass by recomputing the broker snapshot hash',()=>{
  const {request,receipt,options}=fixture();receipt.sourceFiles[0].sha256='f'.repeat(64);
  receipt.sourceSnapshotDigest=sha(JSON.stringify(receipt.sourceFiles.map(({path,bytes,sha256})=>({path,bytes,sha256}))));
  const result=validateExternalReceipt(request,receipt,options);
  assert.equal(result.valid,false);assert.ok(result.errors.includes('SOURCE_FILES_CHANGED_AFTER_STAGING'));
  assert.ok(result.errors.includes('SOURCE_SNAPSHOT_NOT_AUDITED_COPY'));
});
test('bad digest, malformed file manifests and failed transport are rejected',()=>{
  for(const mutate of [r=>r.schemaVersion=2,r=>r.sourceSnapshotDigest='0'.repeat(64),
    r=>r.sourceFiles[0].path='../escape',r=>r.sourceFiles.push(r.sourceFiles[0]),
    r=>r.processVerification.verified=false,r=>r.cleanup.workRemoved=false]){
    const {request,receipt,options}=fixture();mutate(receipt);assert.equal(validateExternalReceipt(request,receipt,options).valid,false);
  }
  const {request,receipt,options}=fixture();assert.equal(validateExternalReceipt(request,receipt,{...options,transportExitCode:1}).valid,false);
});
