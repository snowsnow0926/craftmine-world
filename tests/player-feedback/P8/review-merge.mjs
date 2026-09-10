import assert from 'node:assert/strict';

// Some claims cannot be settled by a machine: whether a model-authored lightning
// effect is actually visible, whether its own cooldown is a second, whether the
// dog visibly stops at its boundary. The driver marks those `review-required` and
// cites exactly what a reviewer must read. This module merges a reviewer's
// signed-off verdict into a finished run report — and cannot do anything else:
//
//   * only `review-required` criteria can be judged;
//   * a machine `failed` or `insufficient` can never be flipped to a pass;
//   * every verdict must cite the evidence files it inspected;
//   * the merged report still says `passed: false`, because a reviewer's merge is
//     not a product, installer or player acceptance.

export const REVIEW_FORMAT = 'craftmine.p8-review/1';
export const REVIEW_VERDICTS = Object.freeze(['confirmed', 'rejected']);

const clone = value => JSON.parse(JSON.stringify(value));

function validate(review) {
  assert.ok(review && typeof review === 'object' && !Array.isArray(review), 'P8_REVIEW_REQUIRED');
  assert.equal(review.format, REVIEW_FORMAT, 'P8_REVIEW_FORMAT');
  assert.ok(typeof review.reviewer === 'string' && review.reviewer.trim().length >= 2, 'P8_REVIEW_REVIEWER_REQUIRED');
  assert.ok(typeof review.runId === 'string' && review.runId.length > 0, 'P8_REVIEW_RUN_REQUIRED');
  assert.ok(Array.isArray(review.cases) && review.cases.length > 0 && review.cases.length <= 4, 'P8_REVIEW_CASES_REQUIRED');
  for (const item of review.cases) {
    assert.ok(item && typeof item === 'object' && !Array.isArray(item), 'P8_REVIEW_CASE_INVALID');
    assert.ok(['hammer', 'dog'].includes(item.caseId), 'P8_REVIEW_CASE_INVALID');
    assert.ok(Object.keys(item).sort().join(',') === 'caseId,verdicts', 'P8_REVIEW_CASE_FIELDS');
    assert.ok(Array.isArray(item.verdicts) && item.verdicts.length > 0, 'P8_REVIEW_VERDICTS_REQUIRED');
    for (const verdict of item.verdicts) {
      assert.ok(verdict && typeof verdict === 'object' && !Array.isArray(verdict), 'P8_REVIEW_VERDICT_INVALID');
      assert.ok(typeof verdict.id === 'string' && verdict.id.length > 0, 'P8_REVIEW_VERDICT_ID');
      assert.ok(REVIEW_VERDICTS.includes(verdict.verdict), 'P8_REVIEW_VERDICT_VALUE');
      assert.ok(Array.isArray(verdict.evidence) && verdict.evidence.length > 0, 'P8_REVIEW_EVIDENCE_REQUIRED');
      for (const file of verdict.evidence) assert.ok(typeof file === 'string' && file.length > 0 && !file.includes('\n'), 'P8_REVIEW_EVIDENCE_INVALID');
      assert.ok(verdict.note === undefined || (typeof verdict.note === 'string' && verdict.note.length <= 2000), 'P8_REVIEW_NOTE_INVALID');
    }
  }
}

/** Merge one reviewer file into one finished report. Returns a new report. */
export function mergeReview({ report, review, reviewSha256, mergeCase = item => item }) {
  validate(review);
  assert.ok(report && typeof report === 'object' && Array.isArray(report.cases), 'P8_REPORT_REQUIRED');
  assert.equal(review.runId, report.runId, 'P8_REVIEW_RUN_MISMATCH');
  assert.ok(typeof reviewSha256 === 'string' && /^[a-f0-9]{64}$/.test(reviewSha256), 'P8_REVIEW_HASH_REQUIRED');
  const merged = mergeCase(clone(report));
  const requested = merged.summary?.caseSelection?.requested ?? merged.requestedCases ?? [];
  const decisions = [];
  for (const entry of review.cases) {
    assert.ok(requested.includes(entry.caseId), 'P8_REVIEW_CASE_NOT_REQUESTED:' + entry.caseId);
    const item = merged.cases.find(row => row.caseId === entry.caseId);
    assert.ok(item, 'P8_REVIEW_CASE_MISSING:' + entry.caseId);
    const criteria = item.gameplay?.verdict?.criteria;
    assert.ok(Array.isArray(criteria) && criteria.length > 0, 'P8_REVIEW_VERDICT_MISSING:' + entry.caseId);
    for (const verdict of entry.verdicts) {
      const criterion = criteria.find(row => row.id === verdict.id);
      assert.ok(criterion, `P8_REVIEW_UNKNOWN_CRITERION:${entry.caseId}:${verdict.id}`);
      // Only a claim the driver itself deferred may be judged here.
      assert.equal(criterion.status, 'review-required', `P8_REVIEW_NOT_DEFERRED:${entry.caseId}:${verdict.id}:${criterion.status}`);
      // A reviewer may only restate its own reading, never invent a fact the run
      // never produced, and never inspect evidence that is not in this report.
      const cited = JSON.stringify(criterion.evidence ?? {});
      for (const file of verdict.evidence) assert.ok(cited.includes(file), `P8_REVIEW_EVIDENCE_NOT_IN_REPORT:${verdict.id}:${file}`);
      criterion.merged = verdict.verdict === 'confirmed' ? 'verified' : 'failed';
      criterion.review = { reviewer: review.reviewer, verdict: verdict.verdict, evidence: verdict.evidence, note: verdict.note ?? null, reviewSha256 };
      decisions.push({ caseId: entry.caseId, id: verdict.id, verdict: verdict.verdict, merged: criterion.merged });
    }
    const rows = criteria.map(row => row.merged ?? row.status);
    item.gameplay.verdict.machineVerified = rows.every(status => status === 'verified');
    item.gameplay.verdict.reviewRequired = criteria.filter(row => (row.merged ?? row.status) === 'review-required').map(row => row.id);
    item.gameplay.verdict.failed = criteria.filter(row => (row.merged ?? row.status) === 'failed').map(row => row.id);
    item.gameplay.verdict.insufficient = criteria.filter(row => (row.merged ?? row.status) === 'insufficient').map(row => row.id);
    // Reviewed-and-confirmed is a stronger statement than machine-verified, and
    // only reached when nothing is left deferred.
    item.gameplay.verdict.verified = item.gameplay.verdict.machineVerified && item.gameplay.verdict.reviewRequired.length === 0;
    item.gameplay.verdict.reviewed = true;
    item.reviewRequired = item.gameplay.verdict.reviewRequired;
    item.behaviorVerified = item.gameplay.verdict.verified;
  }
  if (merged.summary) {
    const rows = merged.cases.filter(item => requested.includes(item.caseId));
    merged.summary.review = { reviewer: review.reviewer, reviewSha256, decisions, reviewedAt: new Date().toISOString() };
    merged.summary.behaviorVerified = rows.length === requested.length && rows.every(item => item.behaviorVerified === true);
    merged.summary.reviewRequired = rows.flatMap(item => (item.reviewRequired ?? []).map(id => `${item.caseId}:${id}`));
    merged.summary.pipelinePassed = false;
    merged.summary.verifiedAfterReview = merged.summary.behaviorVerified && merged.summary.reviewRequired.length === 0 && rows.every(item => item.restart?.passed === true) && rows.every(item => item.pipeline !== false);
    merged.summary.note = 'Merged reviewer verdicts only close criteria the driver deferred. Machine failures cannot be overturned, and this is still not a product, installer or player acceptance.';
  }
  merged.passed = false;
  merged.reviewMerged = true;
  merged.review = { reviewer: review.reviewer, reviewSha256, decisions };
  return merged;
}
