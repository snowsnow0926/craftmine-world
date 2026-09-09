// Round verdict for task I.
//
// A round can only pass when: every frozen machine assertion passed, every
// declared screenshot artefact exists in the sealed evidence bundle with a
// matching hash, every human-review assertion points at a real review record,
// usage accounting is present, and the identity is complete.
// Missing evidence is 证据不足, never a pass and never a silent skip.
import { evaluateAssertions, resolvePath } from './assert-dsl.mjs';
import { missingIdentityFields } from './identity.mjs';

export const VERDICT_FORMAT = 'craftmine.i.verdict/1';

export const VERDICTS = Object.freeze({ PASSED: 'passed', FAILED: 'failed', INSUFFICIENT: 'insufficient', NOT_RUN: 'not-run', BLOCKED: 'blocked' });

function findArtifact(artifacts, name) {
  if (!name) return null;
  return artifacts.find(artifact => artifact.path === name || artifact.path.endsWith(`/${name}`)) ?? null;
}

// Screenshot evidence must be a real file in the evidence bundle whose recorded
// hash matches, not a self-reported field in the observation document.
function hasScreenshot(observation, assertion, artifacts) {
  const shots = observation?.evidence?.screenshots ?? [];
  return shots.some(shot => {
    if (shot.assertionId !== assertion.id) return false;
    const artifact = findArtifact(artifacts, shot.name ?? shot.path);
    if (!artifact) return false;
    if (typeof shot.sha256 === 'string' && shot.sha256 !== artifact.sha256) return false;
    return Number(artifact.bytes) > 0;
  });
}

// A human review must name a review record that is actually part of the bundle.
function hasHumanReview(observation, assertion, artifacts) {
  const reviews = observation?.evidence?.human ?? [];
  return reviews.some(review => review.assertionId === assertion.id
    && typeof review.reviewer === 'string' && review.reviewer.length > 0
    && review.verdict === 'pass'
    && Boolean(findArtifact(artifacts, review.record)));
}

// Usage accounting must be present and must state how many calls were unknown.
function hasAccounting(observation) {
  const usage = observation?.usage;
  return Boolean(usage) && typeof usage.calls === 'number' && typeof usage.unknownCalls === 'number';
}

// Collect the top-level observation sections a machine assertion reads, so an
// observation that simply omits a section cannot leave assertions unevaluated.
function collectRoots(check, roots = new Set(), nested = false) {
  if (!check || typeof check !== 'object') return roots;
  const add = value => { if (typeof value === 'string' && value && !value.startsWith('$')) roots.add(value.split('.')[0].replace(/\[.*$/, '')); };
  // A nested check inside every/some reads element fields, not observation roots.
  if (!nested) {
    add(check.path);
    if (typeof check.value === 'string' && (check.op === 'equalsPath' || check.op === 'notEqualsPath' || check.op === 'changedFrom' || check.op === 'unchangedFrom' || check.op === 'lessThanPath' || check.op === 'greaterThanPath')) add(check.value);
  }
  for (const key of ['all', 'any', 'none']) if (Array.isArray(check[key])) check[key].forEach(child => collectRoots(child, roots, nested));
  if (check.not) collectRoots(check.not, roots, nested);
  if (check.check) collectRoots(check.check, roots, true);
  return roots;
}

export function evaluateRound({ round, assertions, observation = {}, identity = {}, mode = 'replay', artifacts = [] }) {
  const evaluation = evaluateAssertions(assertions, observation);
  const reasons = [];
  const missingEvidence = [];

  const machineFailed = evaluation.results.filter(result => result.kind === 'machine' && !result.passed);
  for (const result of machineFailed) reasons.push(`${result.id}: ${result.reason}`);
  for (const result of evaluation.invalid ?? []) reasons.push(`${result.id}: ${result.reason}`);

  const requiredRoots = new Set();
  for (const assertion of assertions) if (assertion.kind === 'machine' && assertion.check) collectRoots(assertion.check, requiredRoots);
  const absentSections = [...requiredRoots].filter(root => resolvePath(observation, root) === undefined);
  if (absentSections.length) missingEvidence.push({ id: 'observation', need: `missing sections: ${absentSections.join(', ')}` });

  for (const assertion of assertions) {
    if (assertion.kind === 'visual' && !hasScreenshot(observation, assertion, artifacts)) missingEvidence.push({ id: assertion.id, need: 'screenshot-artifact' });
    if (assertion.kind === 'human' && !hasHumanReview(observation, assertion, artifacts)) missingEvidence.push({ id: assertion.id, need: 'human-review-record' });
    if (assertion.kind === 'accounting' && !hasAccounting(observation)) missingEvidence.push({ id: assertion.id, need: 'usage-accounting' });
  }
  if (missingEvidence.length) reasons.push(`missing evidence: ${missingEvidence.map(item => `${item.id}/${item.need}`).join(', ')}`);

  const identityMissing = missingIdentityFields(identity);
  if (identityMissing.length) reasons.push(`identity incomplete: ${identityMissing.join(', ')}`);

  let verdict;
  if (machineFailed.length || (evaluation.invalid ?? []).length) verdict = VERDICTS.FAILED;
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
    // Only machine assertions can create a hard failure; evidence-class
    // assertions are handled as missing evidence above.
    hardFailures: evaluation.results
      .filter(result => result.kind === 'machine' && result.hard && !result.passed)
      .map(result => ({ class: 'model-wrong-behavior', message: `${result.id}: ${result.reason}` })),
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
