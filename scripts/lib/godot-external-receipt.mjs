import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const POLICY='craftmine.windows.lpac-registry.v1';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const relative=value=>typeof value==='string'&&value.length>0&&!/[\\:\x00-\x1f]/.test(value)
  &&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
function fileRecords(records){
  if(!Array.isArray(records))return null;
  const result=[];let previous=null;
  for(const record of records){
    if(!record||!relative(record.path)||!Number.isSafeInteger(record.bytes)||record.bytes<0||!hash(record.sha256)
      ||(previous!==null&&previous>=record.path))return null;
    previous=record.path;result.push({path:record.path,bytes:record.bytes,sha256:record.sha256});
  }
  return result;
}
// Compare host expectations, never expectations reconstructed from the receipt.
// sourceDigest is merely echoed by the broker; measure the actual source list
// and compare it to the host's audited staged list before attributing success.
export function validateExternalReceipt(request,result,{brokerSha256,transportExitCode,expectedSourceFiles}={}){
  const errors=[];const check=(condition,reason)=>{if(!condition)errors.push(reason);};
  if(!request||typeof request!=='object'||Array.isArray(request))return {valid:false,errors:['HOST_REQUEST_OBJECT_REQUIRED']};
  if(!result||typeof result!=='object'||Array.isArray(result))return {valid:false,errors:['RECEIPT_OBJECT_REQUIRED']};
  check(transportExitCode===0,'BROKER_TRANSPORT_FAILED');
  check(request?.schemaVersion===1&&result.schemaVersion===1,'RECEIPT_SCHEMA_MISMATCH');
  for(const field of ['requestId','taskId','operation','inputHash'])check(typeof request?.[field]==='string'&&result[field]===request[field],'RECEIPT_'+field.toUpperCase()+'_MISMATCH');
  check(isDeepStrictEqual(result.sourceBinding,request?.sourceBinding),'RECEIPT_SOURCE_BINDING_MISMATCH');
  check(result.state==='succeeded'&&result.exitCode===0&&result.error===null,'GODOT_EXECUTION_FAILED');
  check(hash(brokerSha256)&&result.brokerSha256===brokerSha256,'BROKER_SHA256_MISMATCH');
  check(result.policyVersion===POLICY,'BROKER_POLICY_MISMATCH');
  const source=fileRecords(result.sourceFiles),expected=fileRecords(expectedSourceFiles);
  check(!!source&&!!expected,'SOURCE_FILE_MANIFEST_INVALID');
  if(source&&expected){
    const measured=digest(JSON.stringify(source)),expectedDigest=digest(JSON.stringify(expected));
    check(isDeepStrictEqual(source,expected),'SOURCE_FILES_CHANGED_AFTER_STAGING');
    check(hash(result.sourceSnapshotDigest)&&result.sourceSnapshotDigest===measured,'SOURCE_SNAPSHOT_DIGEST_INVALID');
    check(measured===expectedDigest&&request.sourceBinding?.sourceDigest===expectedDigest,'SOURCE_SNAPSHOT_NOT_AUDITED_COPY');
  }
  const process=result.processVerification,network=result.networkPreflight,cleanup=result.cleanup;
  check(process?.verified===true&&process.policyVersion===POLICY&&process.isAppContainer===true
    &&process.lpacCreationAttribute===true&&process.jobMembershipVerified===true&&process.verifiedBeforeResume===true
    &&process.resumePreviousCount===1,'PROCESS_BOUNDARY_NOT_VERIFIED');
  check(network?.verified===true&&network.policyVersion===POLICY&&network.exactTaskExempt===false,'NETWORK_BOUNDARY_NOT_VERIFIED');
  check(cleanup?.verified===true&&cleanup.workRemoved===true&&cleanup.error===null,'CLEANUP_NOT_VERIFIED');
  check(result.recoveryJournal?.cleared===true&&result.recoveryJournal.error===null,'RECOVERY_JOURNAL_NOT_CLEARED');
  check(typeof result.artifactsRoot==='string'&&typeof result.logsRoot==='string','RECEIPT_ROOTS_INVALID');
  check(!!fileRecords(result.artifacts)&&!!fileRecords(result.logs),'OUTPUT_MANIFEST_INVALID');
  if(request.operation==='exportWeb')check(['index.html','index.js','index.pck','index.wasm'].every(name=>result.artifacts?.some(file=>file.path===name&&file.bytes>0)),'WEB_ARTIFACTS_MISSING');
  return {valid:errors.length===0,errors};
}
