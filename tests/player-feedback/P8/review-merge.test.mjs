import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeReview, mergeReviewFiles, REVIEW_FORMAT } from './review-merge.mjs';

// A merge may only close what the driver deferred. It can never overturn a
// machine failure, never erase a recorded failure, never raise the pipeline
// verdict, and never turn a reviewed run into an overall pass.
const sha = 'a'.repeat(64);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = path.join(root, 'test-results/p8-review-merge');

const report = ({ pipelinePassed = true, outcome = 'source-check-apply-save-completed', restart = true, extra = {} } = {}) => ({
  format: 'craftmine.p8-client/1', runId: 'run-1', passed: false,
  error: null, shutdownError: null, stopped: false,
  launches: [{ exit: { code: 0 } }], steps: [{ name: 'first strict owned shutdown', passed: true }],
  summary: { caseSelection: { requested: ['hammer'], executed: ['hammer'], requestedCount: 1, executedCount: 1 }, behaviorVerified: false, reviewRequired: ['hammer:lightning-visible-in-frames'], pipelinePassed },
  cases: [{
    caseId: 'hammer', outcome, restart: { passed: restart }, pipeline: restart, behaviorVerified: false, error: null,
    reviewRequired: ['lightning-visible-in-frames', 'lightning-cooldown-at-least-one-second'],
    gameplay: { verdict: { verified: false, machineVerified: false, failed: [], insufficient: [], reviewRequired: ['lightning-visible-in-frames', 'lightning-cooldown-at-least-one-second'], criteria: [
      { id: 'equip-stable-id', status: 'verified', evidence: { attempts: [] } },
      { id: 'pickup-actual', status: 'verified', evidence: { attempts: [] } },
      { id: 'lightning-visible-in-frames', status: 'review-required', evidence: { evidence: [{ file: 'D:\\runs\\run-1\\hammer-frame-2-fire.png', sha256: 'b'.repeat(64) }] } },
      { id: 'lightning-cooldown-at-least-one-second', status: 'review-required', evidence: { declared: [{ name: 'LIGHTNING_COOLDOWN', seconds: 1.2 }] } },
    ] } },
  }],
  ...extra,
});
const review = (verdicts, over = {}) => ({ format: REVIEW_FORMAT, reviewer: 'P5', runId: 'run-1', cases: [{ caseId: 'hammer', verdicts }], ...over });
const both = [
  { id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['hammer-frame-2-fire.png'], note: 'frames show the local flash' },
  { id: 'lightning-cooldown-at-least-one-second', verdict: 'confirmed', evidence: ['LIGHTNING_COOLDOWN'] },
];

test('a reviewer confirms the deferred claims and the run is then reviewed, not automatically passed', () => {
  const merged = mergeReview({ report: report(), review: review(both), reviewSha256: sha });
  assert.equal(merged.reviewMerged, true); assert.equal(merged.passed, false, 'a reviewed merge is still not a product acceptance');
  assert.deepEqual(merged.summary.reviewRequired, []);
  assert.equal(merged.summary.behaviorVerified, true);
  assert.equal(merged.summary.verifiedAfterReview, true);
  assert.equal(merged.cases[0].gameplay.verdict.verified, true);
  assert.equal(merged.review.reviewer, 'P5');
  assert.deepEqual(merged.review.decisions.map(item => item.id), ['lightning-visible-in-frames', 'lightning-cooldown-at-least-one-second']);
  const confirmed = merged.cases[0].gameplay.verdict.criteria.find(item => item.id === 'lightning-visible-in-frames');
  assert.equal(confirmed.merged, 'verified'); assert.equal(confirmed.review.reviewSha256, sha);
});

test('a reviewer rejection becomes a failure and no overall pass is written', () => {
  const merged = mergeReview({ report: report(), review: review([{ ...both[0], verdict: 'rejected', note: 'no flash visible' }, both[1]]), reviewSha256: sha });
  assert.deepEqual(merged.cases[0].gameplay.verdict.failed, ['lightning-visible-in-frames']);
  assert.equal(merged.cases[0].gameplay.verdict.verified, false);
  assert.equal(merged.summary.behaviorVerified, false); assert.equal(merged.summary.verifiedAfterReview, false);
  assert.deepEqual(merged.summary.gameplayFailed, ['hammer:lightning-visible-in-frames']);
  assert.equal(merged.passed, false);
});

test('an incomplete pipeline is never written as reviewed-clean', () => {
  for (const broken of [report({ pipelinePassed: false }), report({ outcome: 'running' }), report({ restart: false })]) {
    const merged = mergeReview({ report: broken, review: review(both), reviewSha256: sha });
    assert.equal(merged.summary.verifiedAfterReview, false, 'a merge cannot complete the pipeline');
    assert.equal(merged.summary.pipelinePassed, broken.summary.pipelinePassed, 'the merge never raises the pipeline verdict');
    assert.equal(merged.passed, false);
  }
  // The happy path still works, so the guard is not simply always false.
  assert.equal(mergeReview({ report: report(), review: review(both), reviewSha256: sha }).summary.verifiedAfterReview, true);
});
test('a Windows path, an escaped path and a bare file name all cite the same evidence', () => {
  // The report holds a Windows path with backslashes. P6 measured that a raw
  // citation of it was rejected, which would fail a legitimate merge.
  const raw = 'D:\\runs\\run-1\\hammer-frame-2-fire.png';
  const bases = [report(), report()];
  bases[0].cases[0].gameplay.verdict.criteria.find(row => row.id === 'lightning-visible-in-frames').evidence.evidence = [{ file: raw, sha256: 'b'.repeat(64) }];
  for (const citation of [raw, raw.replace(/\\/g, '/'), 'hammer-frame-2-fire.png', 'b'.repeat(64), JSON.stringify(raw).slice(1, -1)]) {
    const merged = mergeReview({ report: bases[0], review: review([{ ...both[0], evidence: [citation] }, both[1]]), reviewSha256: sha });
    assert.equal(merged.summary.verifiedAfterReview, true, 'citation form must not decide the merge: ' + citation);
  }
  const unrelated = mergeReview({ report: bases[1], review: review(both), reviewSha256: sha });
  assert.equal(unrelated.summary.verifiedAfterReview, true, 'a bare file name still matches the report path');
  assert.throws(() => mergeReview({ report: bases[1], review: review([{ ...both[0], evidence: ['D:\\other\\run\\hammer-frame-2-fire.png'] }, both[1]]), reviewSha256: sha }), /P8_REVIEW_EVIDENCE_NOT_IN_REPORT/);
});

test('a merge cannot erase a recorded failure, an exit error or a page-error step', () => {
  const original = report({ extra: { error: 'audit failed: page errors present', shutdownError: '[Uncaught TypeError: BaseAudioContext]', steps: [{ name: 'first strict owned shutdown', passed: false, error: 'pageErrors not empty' }] } });
  const merged = mergeReview({ report: original, review: review(both), reviewSha256: sha });
  assert.equal(merged.shutdownError, original.shutdownError);
  assert.equal(merged.error, original.error);
  assert.deepEqual(merged.steps, original.steps);
  assert.deepEqual(merged.launches, original.launches);
  assert.equal(merged.stopped, false);
  assert.equal(merged.summary.verifiedAfterReview, false, 'retaining an error must also prevent a reviewed-clean verdict');
  const tampered = JSON.parse(JSON.stringify(merged));
  tampered.shutdownError = null;
  assert.throws(() => mergeReview({ report: tampered, review: review(both), reviewSha256: sha }), /P8_REVIEW_NOT_DEFERRED|P8_REVIEW_MUST_NOT_ERASE_FAILURES/);
});

test('only a deferred claim can be judged, and only against evidence the run produced', () => {
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'pickup-actual', verdict: 'rejected', evidence: ['attempts'] }]), reviewSha256: sha }), /P8_REVIEW_NOT_DEFERRED:hammer:pickup-actual:verified/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['some-other-file.png'] }]), reviewSha256: sha }), /P8_REVIEW_EVIDENCE_NOT_IN_REPORT/);
  assert.throws(() => mergeReview({ report: report(), review: review(both, { runId: 'run-2' }), reviewSha256: sha }), /P8_REVIEW_RUN_MISMATCH/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: [] }]), reviewSha256: sha }), /P8_REVIEW_EVIDENCE_REQUIRED/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'maybe', evidence: ['hammer-frame-2-fire.png'] }]), reviewSha256: sha }), /P8_REVIEW_VERDICT_VALUE/);
  assert.throws(() => mergeReview({ report: report(), review: review(both, { reviewer: ' ' }), reviewSha256: sha }), /P8_REVIEW_REVIEWER_REQUIRED/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'unknown-criterion', verdict: 'confirmed', evidence: ['x'] }]), reviewSha256: sha }), /P8_REVIEW_UNKNOWN_CRITERION/);
  assert.throws(() => mergeReview({ report: report(), review: review(both), reviewSha256: 'not-a-hash' }), /P8_REVIEW_HASH_REQUIRED/);
  assert.throws(() => mergeReview({ report: report(), review: review(both, { cases: [{ caseId: 'dog', verdicts: [{ id: 'x', verdict: 'confirmed', evidence: ['y'] }] }] }), reviewSha256: sha }), /P8_REVIEW_CASE_NOT_REQUESTED/);
});

test('a machine failure cannot be overturned by a reviewer', () => {
  const base = report();
  base.cases[0].gameplay.verdict.criteria.push({ id: 'far-out-of-contact-observed', status: 'failed', evidence: { farTalk: null } });
  base.cases[0].gameplay.verdict.failed = ['far-out-of-contact-observed'];
  assert.throws(() => mergeReview({ report: base, review: review([{ id: 'far-out-of-contact-observed', verdict: 'confirmed', evidence: ['farTalk'] }]), reviewSha256: sha }), /P8_REVIEW_NOT_DEFERRED/);
  const insufficient = report();
  insufficient.cases[0].gameplay.verdict.criteria.push({ id: 'pickup-actual', status: 'insufficient', evidence: { note: 'never aimed' } });
  assert.throws(() => mergeReview({ report: insufficient, review: review([{ id: 'pickup-actual', verdict: 'confirmed', evidence: ['never aimed'] }]), reviewSha256: sha }), /P8_REVIEW_NOT_DEFERRED/);
});

test('the merge never mutates the input report and writes a separate copy', () => {
  const original = report();
  const copy = JSON.parse(JSON.stringify(original));
  mergeReview({ report: original, review: review(both), reviewSha256: sha });
  assert.deepEqual(original, copy, 'the input report is left exactly as it was');
  fs.mkdirSync(out, { recursive: true });
  const directory = fs.mkdtempSync(path.join(out, 'case-'));
  const reportPath = path.join(directory, 'report.json'), reviewPath = path.join(directory, 'review.json'), mergedPath = path.join(directory, 'report-reviewed.json');
  fs.writeFileSync(reportPath, JSON.stringify(report()));
  fs.writeFileSync(reviewPath, JSON.stringify(review(both)));
  const result = mergeReviewFiles({ reportPath, reviewPath, outPath: mergedPath });
  assert.equal(result.out, mergedPath);
  assert.equal(result.passed, false);
  assert.equal(result.verifiedAfterReview, true);
  assert.equal(fs.existsSync(mergedPath), true);
  assert.notDeepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), JSON.parse(fs.readFileSync(mergedPath, 'utf8')), 'the original report must not be overwritten with the merged copy');
  assert.throws(() => mergeReviewFiles({ reportPath, reviewPath, outPath: reportPath }), /P8_REVIEW_WOULD_OVERWRITE_THE_REPORT/);
  assert.throws(() => mergeReviewFiles({ reportPath, reviewPath, outPath: mergedPath }), /P8_REVIEW_OUT_PATH_EXISTS/);
});
