import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

/** Verify the whole finite document, not only a success label or a source hash. */
export function assertIssueExport(bytes,receipt,details,input){
 assert.ok(Buffer.isBuffer(bytes));assert.ok(bytes.length>0&&bytes.length<=512*1024);
 const document=JSON.parse(bytes.toString('utf8'));
 assert.equal(typeof document.createdAt,'string');
 assert.equal(new Date(document.createdAt).toISOString(),document.createdAt);
 assert.deepEqual(document,{
  format:'craftmine.local-issue-export/1',scope:'selected-record',createdAt:document.createdAt,
  record:details.issue,followups:details.followups,revision:details.revision,playerStatus:details.playerStatus,
  exclusions:['credentials','chat','systemLogs','screenshots','worldSource','progressSnapshots','otherIssues'],
 });
 assert.deepEqual(receipt,{
  status:'completed',operationId:input.operationId,issueId:input.issueId,revision:input.revision,
  scope:'selected-record',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
 });
 assert.equal(details.issue.id,input.issueId);assert.equal(details.revision,input.revision);
 return document;
}

/** Accept only the exact known native/preload wrappers, never a transport failure. */
export function issueExportError(error,code){
 const plain=[code,`Error: ${code}`];
 const ipc=`Error invoking remote method 'pi-plugin-panel-invoke': Error: ${code}`;
 return [...plain,ipc,`Error: ${ipc}`].includes(error?.message);
}
