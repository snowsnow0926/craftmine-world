import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {register} from 'node:module';
register('./helpers/ts-import-hooks.mjs',import.meta.url);
const {createEvaluationBudget,evaluationRequestLimit}=await import('../electron/main/creation-evaluation-budget.ts');

test('pilot configuration may lower the existing request ceiling, never raise or clear it',()=>{
  assert.equal(evaluationRequestLimit(undefined),40);assert.equal(evaluationRequestLimit('10'),10);
  for(const value of ['0','41','-1','1.5','NaN','Infinity',' 10',''])assert.throws(()=>evaluationRequestLimit(value));
});
test('real-request fence survives process restart and same request replay',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'creation-budget-'));
  const first=createEvaluationBudget(dir,2);first.reserve('one');first.reserve('one');
  const restarted=createEvaluationBudget(dir,2);assert.equal(restarted.snapshot().remaining,1);
  restarted.reserve('two');assert.throws(()=>restarted.reserve('three'),/REQUEST_LIMIT/);
  assert.equal(createEvaluationBudget(dir,2).snapshot().reserved,2);
});
