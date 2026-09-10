import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CASE_PIPELINE_COMPLETE } from './run-outcome.mjs';

// Some claims cannot be settled by a machine: whether a model-authored lightning
// effect is actually visible, whether its own cooldown is a second, whether the
// dog visibly stops at its boundary. The driver marks those `review-required` and
// cites exactly what a reviewer must read. This module merges a reviewer's
// signed-off verdict into a finished run report — and cannot do anything else:
//
//   * only `review-required` criteria can be judged;
//   * a machine `failed` or `insufficient` can never be flipped to a pass;
//   * every verdict must cite evidence that is present in that criterion;
//   * exit, page-error, launch and per-case error fields are preserved verbatim,
//     so a merge cannot tidy away a failure;
//   * `pipelinePassed` is never raised by a review, and the merged report still
//     says `passed: false`;
//   * the input report is never modified: the caller writes a separate copy.

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

/** A citation may be a hash, a bare file name, a Windows path or a POSIX path.
 * Separators and JSON escaping must not decide whether a real citation counts. */
function cites(haystack, file) {
  const normalized = String(file).replace(/\\+/g, '/');
  // A qualified path must match that path. Falling back to its basename would
  // accept an unrelated run's file merely because it has the same name.
  return normalized.length > 0 && haystack.includes(normalized);
}
const normalizedEvidence = criterion => JSON.stringify(criterion.evidence ?? {}).replace(/\\\\/g, '/').replace(/\\/g, '/');

/** Fields that carry a failure and must survive a merge untouched. */
function assertPreserved(original, merged) {
  const pick = report => ({
    error: report.error ?? null, shutdownError: report.shutdownError ?? null, stopped: report.stopped ?? null,
    launches: JSON.stringify(report.launches ?? null), steps: JSON.stringify(report.steps ?? null),
    caseErrors: JSON.stringify((report.cases ?? []).map(item => item.error ?? null)),
    caseOutcomes: JSON.stringify((report.cases ?? []).map(item => item.outcome ?? null)),
    historicalLedgerMutated: report.historicalLedgerMutated ?? null,
    pipelinePassed: report.summary?.pipelinePassed ?? report.pipelinePassed ?? null,
  });
  assert.deepEqual(pick(merged), pick(original), 'P8_REVIEW_MUST_NOT_ERASE_FAILURES');
}

/** Merge one reviewer file into one finished report. Returns a new report and
 * never touches the input. */
export function mergeReview({ report, review, reviewSha256 }) {
  validate(review);
  assert.ok(report && typeof report === 'object' && Array.isArray(report.cases), 'P8_REPORT_REQUIRED');
  assert.equal(review.runId, report.runId, 'P8_REVIEW_RUN_MISMATCH');
  assert.ok(typeof reviewSha256 === 'string' && /^[a-f0-9]{64}$/.test(reviewSha256), 'P8_REVIEW_HASH_REQUIRED');
  const merged = clone(report);
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
      const effectiveStatus = criterion.merged ?? criterion.status;
      assert.equal(effectiveStatus, 'review-required', `P8_REVIEW_NOT_DEFERRED:${entry.caseId}:${verdict.id}:${effectiveStatus}`);
      // A reviewer may only cite evidence this report actually holds.
      const haystack = normalizedEvidence(criterion);
      for (const file of verdict.evidence) assert.ok(cites(haystack, file), `P8_REVIEW_EVIDENCE_NOT_IN_REPORT:${verdict.id}:${file}`);
      criterion.merged = verdict.verdict === 'confirmed' ? 'verified' : 'failed';
      criterion.review = { reviewer: review.reviewer, verdict: verdict.verdict, evidence: verdict.evidence, note: verdict.note ?? null, reviewSha256 };
      decisions.push({ caseId: entry.caseId, id: verdict.id, verdict: verdict.verdict, merged: criterion.merged });
    }
    const rows = criteria.map(row => row.merged ?? row.status);
    const verifiedAfterReview = rows.every(status => status === 'verified');
    item.gameplay.verdict.reviewRequired = criteria.filter(row => (row.merged ?? row.status) === 'review-required').map(row => row.id);
    item.gameplay.verdict.failed = criteria.filter(row => (row.merged ?? row.status) === 'failed').map(row => row.id);
    item.gameplay.verdict.insufficient = criteria.filter(row => (row.merged ?? row.status) === 'insufficient').map(row => row.id);
    // Reviewed-and-confirmed is only reached when nothing is left deferred.
    item.gameplay.verdict.verified = verifiedAfterReview && item.gameplay.verdict.reviewRequired.length === 0;
    item.gameplay.verdict.reviewed = true;
    item.reviewRequired = item.gameplay.verdict.reviewRequired;
    item.behaviorVerified = item.gameplay.verdict.verified;
  }
  if (merged.summary) {
    const rows = merged.cases.filter(item => requested.includes(item.caseId));
    merged.summary.review = { reviewer: review.reviewer, reviewSha256, decisions, reviewedAt: new Date().toISOString(), scope: 'A merge only closes criteria the driver deferred. It never raises pipelinePassed and never erases a failure.' };
    merged.summary.behaviorVerified = rows.length === requested.length && rows.every(item => item.behaviorVerified === true);
    merged.summary.reviewRequired = rows.flatMap(item => (item.reviewRequired ?? []).map(id => `${item.caseId}:${id}`));
    // Verbatim, so a reader can see the failure the merge did not remove.
    merged.summary.gameplayFailed = rows.flatMap(item => (item.gameplay?.verdict?.failed ?? []).map(id => `${item.caseId}:${id}`));
    merged.summary.gameplayInsufficient = rows.flatMap(item => (item.gameplay?.verdict?.insufficient ?? []).map(id => `${item.caseId}:${id}`));
    const pipelineComplete = rows.every(item => item.outcome === CASE_PIPELINE_COMPLETE) && rows.every(item => item.restart?.passed === true);
    const recordedFailure = merged.error || merged.shutdownError || merged.stopped
      || merged.historicalLedgerMutated || merged.accountingError || (merged.faults ?? []).length > 0
      || (merged.steps ?? []).some(step => step.passed === false)
      || rows.some(item => item.error);
    merged.summary.verifiedAfterReview = !recordedFailure && merged.summary.behaviorVerified
      && merged.summary.reviewRequired.length === 0
      && merged.summary.gameplayFailed.length === 0
      && merged.summary.gameplayInsufficient.length === 0
      && pipelineComplete
      && merged.summary.pipelinePassed === true; // never raised here, only read
    merged.summary.note = 'Merged reviewer verdicts close only the criteria the driver deferred. pipelinePassed is never raised by a review, machine failures are never overturned, and the outcome is still not a product, installer or player acceptance.';
  }
  merged.passed = false;
  merged.reviewMerged = true;
  merged.review = { reviewer: review.reviewer, reviewSha256, decisions };
  assertPreserved(report, merged);
  return merged;
}

/** Read a report and a review, write the merged copy elsewhere. The original
 * report is never overwritten. */
export function mergeReviewFiles({ reportPath, reviewPath, outPath }) {
  for (const [value, code] of [[reportPath, 'P8_REVIEW_REPORT_PATH'], [reviewPath, 'P8_REVIEW_FILE_PATH'], [outPath, 'P8_REVIEW_OUT_PATH']]) {
    assert.ok(typeof value === 'string' && path.isAbsolute(value), code + '_ABSOLUTE_REQUIRED');
    assert.ok(fs.lstatSync(value, { throwIfNoEntry: false })?.isFile() ?? !fs.existsSync(value), code + '_MUST_BE_A_FILE');
  }
  assert.notEqual(path.resolve(outPath), path.resolve(reportPath), 'P8_REVIEW_WOULD_OVERWRITE_THE_REPORT');
  assert.ok(!fs.existsSync(outPath), 'P8_REVIEW_OUT_PATH_EXISTS');
  const reportBytes = fs.readFileSync(reportPath), reviewBytes = fs.readFileSync(reviewPath);
  const merged = mergeReview({
    report: JSON.parse(reportBytes.toString('utf8')),
    review: JSON.parse(reviewBytes.toString('utf8')),
    reviewSha256: createHash('sha256').update(reviewBytes).digest('hex'),
  });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  return { out: outPath, reviewer: merged.review.reviewer, decisions: merged.review.decisions, verifiedAfterReview: merged.summary?.verifiedAfterReview === true, passed: merged.passed };
}

function argument(name) {
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === name) return argv[index + 1];
    if (argv[index].startsWith(name + '=')) return argv[index].slice(name.length + 1);
  }
  return undefined;
}

// CLI: only runs when this file is the entry point, so importing it is safe.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(mergeReviewFiles({ reportPath: argument('--report'), reviewPath: argument('--review'), outPath: argument('--out') })));
}
