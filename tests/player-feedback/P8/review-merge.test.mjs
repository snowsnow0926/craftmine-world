import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeReview, REVIEW_FORMAT } from './review-merge.mjs';

// A merge may only close what the driver deferred. It can never overturn a
// machine failure, never invent evidence, and never turn a reviewed run into an
// overall pass.
const sha = 'a'.repeat(64);
const report = () => ({
  format: 'craftmine.p8-client/1', runId: 'run-1', passed: false,
  summary: { caseSelection: { requested: ['hammer'], executed: ['hammer'], requestedCount: 1, executedCount: 1 }, behaviorVerified: false, reviewRequired: ['hammer:lightning-visible-in-frames'], pipelinePassed: false },
  cases: [{
    caseId: 'hammer', outcome: 'source-check-apply-save-completed', restart: { passed: true }, pipeline: true, behaviorVerified: false,
    reviewRequired: ['lightning-visible-in-frames', 'lightning-cooldown-at-least-one-second'],
    gameplay: { verdict: { verified: false, machineVerified: false, failed: [], insufficient: [], reviewRequired: ['lightning-visible-in-frames', 'lightning-cooldown-at-least-one-second'], criteria: [
      { id: 'equip-stable-id', status: 'verified', evidence: { attempts: [] } },
      { id: 'pickup-actual', status: 'verified', evidence: { attempts: [] } },
      { id: 'lightning-visible-in-frames', status: 'review-required', evidence: { evidence: [{ file: 'hammer-frame-0-fire.png', sha256: 'b'.repeat(64) }] } },
      { id: 'lightning-cooldown-at-least-one-second', status: 'review-required', evidence: { declared: [{ name: 'LIGHTNING_COOLDOWN', seconds: 1.2 }] } },
    ] } },
  }],
});
const review = (verdicts, over = {}) => ({ format: REVIEW_FORMAT, reviewer: 'P5', runId: 'run-1', cases: [{ caseId: 'hammer', verdicts }], ...over });

test('a reviewer confirms the deferred claims and the run is then reviewed, not automatically passed', () => {
  const merged = mergeReview({ report: report(), review: review([
    { id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['hammer-frame-0-fire.png'], note: 'frames show the local flash' },
    { id: 'lightning-cooldown-at-least-one-second', verdict: 'confirmed', evidence: ['LIGHTNING_COOLDOWN'] },
  ]), reviewSha256: sha });
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
  const merged = mergeReview({ report: report(), review: review([
    { id: 'lightning-visible-in-frames', verdict: 'rejected', evidence: ['hammer-frame-0-fire.png'], note: 'no flash visible in the frames' },
    { id: 'lightning-cooldown-at-least-one-second', verdict: 'confirmed', evidence: ['LIGHTNING_COOLDOWN'] },
  ]), reviewSha256: sha });
  assert.deepEqual(merged.cases[0].gameplay.verdict.failed, ['lightning-visible-in-frames']);
  assert.equal(merged.cases[0].gameplay.verdict.verified, false);
  assert.equal(merged.summary.behaviorVerified, false); assert.equal(merged.summary.verifiedAfterReview, false);
  assert.equal(merged.passed, false);
});

test('only a deferred claim can be judged, and only against evidence the run produced', () => {
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'pickup-actual', verdict: 'rejected', evidence: ['attempts'] }]), reviewSha256: sha }), /P8_REVIEW_NOT_DEFERRED:hammer:pickup-actual:verified/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['some-other-file.png'] }]), reviewSha256: sha }), /P8_REVIEW_EVIDENCE_NOT_IN_REPORT/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['hammer-frame-0-fire.png'], note: 'x' }], { runId: 'run-2' }), reviewSha256: sha }), /P8_REVIEW_RUN_MISMATCH/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: [] }]), reviewSha256: sha }), /P8_REVIEW_EVIDENCE_REQUIRED/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'maybe', evidence: ['hammer-frame-0-fire.png'] }]), reviewSha256: sha }), /P8_REVIEW_VERDICT_VALUE/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['hammer-frame-0-fire.png'] }], { reviewer: ' ' }), reviewSha256: sha }), /P8_REVIEW_REVIEWER_REQUIRED/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'unknown-criterion', verdict: 'confirmed', evidence: ['x'] }]), reviewSha256: sha }), /P8_REVIEW_UNKNOWN_CRITERION/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['hammer-frame-0-fire.png'] }]), reviewSha256: 'not-a-hash' }), /P8_REVIEW_HASH_REQUIRED/);
  assert.throws(() => mergeReview({ report: report(), review: review([{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['hammer-frame-0-fire.png'] }], { cases: [{ caseId: 'dog', verdicts: [{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['x'] }] }] }), reviewSha256: sha }), /P8_REVIEW_CASE_NOT_REQUESTED/);
});

test('a machine failure cannot be overturned by a reviewer', () => {
  const base = report();
  base.cases[0].gameplay.verdict.criteria.push({ id: 'far-out-of-contact-observed', status: 'failed', evidence: { farTalk: null } });
  base.cases[0].gameplay.verdict.failed = ['far-out-of-contact-observed'];
  assert.throws(() => mergeReview({ report: base, review: review([{ id: 'far-out-of-contact-observed', verdict: 'confirmed', evidence: ['farTalk'] }]), reviewSha256: sha }), /P8_REVIEW_NOT_DEFERRED/);
});

test('the merge never mutates the input report', () => {
  const original = report();
  const copy = JSON.parse(JSON.stringify(original));
  mergeReview({ report: original, review: review([{ id: 'lightning-visible-in-frames', verdict: 'confirmed', evidence: ['hammer-frame-0-fire.png'] }, { id: 'lightning-cooldown-at-least-one-second', verdict: 'confirmed', evidence: ['LIGHTNING_COOLDOWN'] }]), reviewSha256: sha });
  assert.deepEqual(original, copy);
});
