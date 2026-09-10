import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ordinaryParents} from './evidence.mjs';

// Operator-supplied review of a previous synthetic run. This never edits its
// source or report, and the corrected run retains an explicit provenance link.
export function readCorrectiveFeedback(file, cases) {
  if (!file) return null;
  assert.ok(path.isAbsolute(file), 'P8_FEEDBACK_ABSOLUTE_PATH');ordinaryParents(file);
  const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=20000,'P8_FEEDBACK_INVALID_FILE');
  const bytes=fs.readFileSync(file);
  const input=JSON.parse(bytes);
  assert.equal(input.format,'craftmine.p8-corrective-feedback/1');
  assert.deepEqual(cases,[input.caseId],'P8_FEEDBACK_CASE_MISMATCH');
  assert.ok(typeof input.feedback==='string'&&input.feedback.trim()&&input.feedback.length<=12000,'P8_INVALID_FEEDBACK');
  assert.ok(typeof input.priorReport==='string'&&path.isAbsolute(input.priorReport),'P8_PRIOR_REPORT_REQUIRED');ordinaryParents(input.priorReport);
  const priorStat=fs.lstatSync(input.priorReport);assert.ok(priorStat.isFile()&&!priorStat.isSymbolicLink()&&priorStat.size<=64*1024*1024,'P8_PRIOR_REPORT_INVALID');
  const priorBytes=fs.readFileSync(input.priorReport),prior=JSON.parse(priorBytes);
  assert.equal(prior.format,'craftmine.p8-client/1');
  assert.ok(prior.runId&&prior.cases?.some(row=>row.caseId===input.caseId),'P8_PRIOR_CASE_REQUIRED');
  assert.ok(prior.launches?.length&&prior.launches.every(row=>row.exit?.code===0),'P8_PRIOR_PROCESS_NOT_CLOSED');
  return {mode:'corrective-rerun',file,sha256:createHash('sha256').update(bytes).digest('hex'),caseId:input.caseId,feedback:input.feedback,priorReport:input.priorReport,priorRunId:prior.runId,priorReportSha256:createHash('sha256').update(priorBytes).digest('hex')};
}
