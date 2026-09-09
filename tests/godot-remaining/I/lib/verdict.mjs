// Round verdict for task I.
//
// A round can only pass when: every frozen machine assertion passed, every
// declared screenshot artefact exists, every human-review assertion has a real
// reviewer record, usage accounting is present, and the identity is complete.
// Missing evidence is 证据不足, never a pass and never a silent skip.
import { evaluateAssertions } from './assert-dsl.mjs';
import { missingIdentityFields } from './identity.mjs';

export const VERDICT_FORMAT = 'craftmine.i.verdict/1';

export const VERDICTS = Object.freeze({ PASSED: 'passed', FAILED: 'failed', INSUFFICIENT: 'insufficient', NOT_RUN: 'not-run', BLOCKED: 'blocked' });

function hasScreenshot(observation, assertion) {
  const shots = observation?.evidence?.screenshots ?? [];
  return shots.some(shot => shot.assertionId === assertion.id && Number(shot.bytes) > 0 && typeof shot.sha256 === 'string');
}

function hasHumanReview(observation, assertion) {
  const reviews = observation?.evidence?.human ?? [];
  return reviews.some(review => review.assertionId === assertion.id && typeof review.reviewer === 'string' && review.reviewer.length > 0 && review.verdict === 'pass');
}

function hasAccounting(observation) {
  const usage = observation?.usage;
  return Boolean(usage) && typeof usage.calls === 'number';
}

export function evaluateRound({ round, assertions, observation = {}, identity = {}, mode = 'replay' }) {
  const evaluation = evaluateAssertions(assertions, observation);
  const reasons = [];
  const missingEvidence = [];

  const machineFailed = evaluation.results.filter(result => result.kind === 'machine' && !result.passed);
  for (const result of machineFailed) reasons.push(`${result.id}: ${result.reason}`);

  for (const assertion of assertions) {
    if (assertion.kind === 'visual' && !hasScreenshot(observation, assertion)) missingEvidence.push({ id: assertion.id, need: 'screenshot' });
    if (assertion.kind === 'human' && !hasHumanReview(observation, assertion)) missingEvidence.push({ id: assertion.id, need: 'human-review' });
    if (assertion.kind === 'accounting' && !hasAccounting(observation)) missingEvidence.push({ id: assertion.id, need: 'usage-accounting' });
  }
  if (missingEvidence.length) reasons.push(`missing evidence: ${missingEvidence.map(item => `${item.id}/${item.need}`).join(', ')}`);

  const identityMissing = missingIdentityFields(identity);
  if (identityMissing.length) reasons.push(`identity incomplete: ${identityMissing.join(', ')}`);

  let verdict;
  if (machineFailed.length) verdict = VERDICTS.FAILED;
  else if (missingEvidence.length || identityMissing.length) verdict = VERDICTS.INSUFFICIENT;
  else verdict = VERDICTS.PASSED;

  return {
    format: VERDICT_FORMAT,
    roundId: round.id,
    mode,
    verdict,
    reasons,
    missingEvidence,
    identityMissing,
    assertions: evaluation.results.map(result => ({ id: result.id, kind: result.kind, hard: result.hard, passed: result.passed, reason: result.reason })),
    hardFailures: evaluation.results.filter(result => result.hard && !result.passed).map(result => ({ class: result.kind === 'machine' ? 'model-wrong-behavior' : 'evidence-insufficient', message: `${result.id}: ${result.reason}` })),
  };
}

// A blocked round is one whose product interface dependency is missing. It is
// recorded explicitly so a missing dependency is never hidden by a green run.
export function blockedRound({ round, reason, detail = null }) {
  return {
    format: VERDICT_FORMAT,
    roundId: round.id,
    mode: 'live',
    verdict: VERDICTS.BLOCKED,
    reasons: [reason, detail].filter(Boolean),
    missingEvidence: [],
    identityMissing: [],
    assertions: [],
    hardFailures: [],
    blockedBy: round.blockedBy ?? [],
  };
}
