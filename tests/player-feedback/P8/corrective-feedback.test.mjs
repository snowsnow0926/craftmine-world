import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {readCorrectiveFeedback} from './corrective-feedback.mjs';

test('corrective input links the closed prior run without changing its failure',()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'p8-feedback-'));
  const priorReport=path.join(out,'report.json'),file=path.join(out,'feedback.json');
  const prior={format:'craftmine.p8-client/1',runId:'prior',cases:[{caseId:'hammer'}],launches:[{exit:{code:0}}],passed:false};
  fs.writeFileSync(priorReport,JSON.stringify(prior));
  fs.writeFileSync(file,JSON.stringify({format:'craftmine.p8-corrective-feedback/1',caseId:'hammer',priorReport,feedback:'The equipped mesh was absent.'}));
  const result=readCorrectiveFeedback(file,['hammer']);
  assert.equal(result.mode,'corrective-rerun');assert.equal(result.priorRunId,'prior');assert.match(result.priorReportSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(priorReport)),prior);
  assert.throws(()=>readCorrectiveFeedback(file,['dog']),/P8_FEEDBACK_CASE_MISMATCH/);
  prior.launches[0].exit=null;fs.writeFileSync(priorReport,JSON.stringify(prior));
  assert.throws(()=>readCorrectiveFeedback(file,['hammer']),/P8_PRIOR_PROCESS_NOT_CLOSED/);
  assert.equal(readCorrectiveFeedback(undefined,['hammer']),null);
});
