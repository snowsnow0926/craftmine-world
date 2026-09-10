// One place decides what a run's result means, so a single-case run can never be
// reported as a two-case pass and a stopped or failed run can never be reported
// as passed. The driver calls this; the offline tests call the same function.
//
// Two different things are reported side by side and never merged into one word:
//
//   pipeline  the product did the work: build, check, preview, adopt, save and
//             survive a restart. It says nothing about whether the feature plays.
//   behaviour every gameplay criterion was verified by machine, with nothing left
//             deferred to a reviewer. It is only meaningful on top of the pipeline.
//
// `pipelinePassed` therefore never includes the gameplay verdict, and
// `behaviorVerified` is always false unless the pipeline also passed.
const CASE_IDS = Object.freeze(['hammer', 'dog']);

export const CASE_PIPELINE_COMPLETE = 'source-check-apply-save-completed';

/** The gameplay verdict the driver actually writes: `item.gameplay.verdict`. It is
 * read here, and only here, so a renamed field cannot silently turn every case
 * into "no failures recorded". */
function gameplayVerdict(item) {
  return item?.gameplay?.verdict && typeof item.gameplay.verdict === 'object' ? item.gameplay.verdict : null;
}

/** Per-case identity a reviewer needs: source, package, model, task, candidate,
 * adoption and gameplay verdict, never only a boolean. */
export function summarizeCase(item) {
  const verdict = gameplayVerdict(item);
  const pipeline = item.outcome === CASE_PIPELINE_COMPLETE && item.restart?.passed === true;
  const failed = Array.isArray(verdict?.failed) ? [...verdict.failed] : [];
  const insufficient = Array.isArray(verdict?.insufficient) ? [...verdict.insufficient] : [];
  const reviewRequired = Array.isArray(verdict?.reviewRequired) ? [...verdict.reviewRequired] : [];
  const machineVerified = verdict?.machineVerified === true;
  const verified = verdict?.verified === true;
  return {
    caseId: item.caseId,
    worldId: item.worldId ?? null,
    outcome: item.outcome ?? 'running',
    startedAt: item.startedAt ?? null,
    finishedAt: item.finishedAt ?? null,
    pipeline,
    pipelinePassed: pipeline,
    restart: item.restart?.passed === true,
    // The gameplay verdict, reported exactly as the driver recorded it.
    behaviorVerified: verified,
    machineVerified,
    gameplayFailed: failed,
    gameplayInsufficient: insufficient,
    gameplayReviewRequired: reviewRequired,
    behaviorPending: pipeline && !verified,
    initialBuildId: item.initialBuildId ?? null,
    candidateId: item.candidate?.candidateId ?? null,
    candidateBuildId: item.candidate?.buildId ?? null,
    appliedBuildId: item.application?.record?.world?.build?.id ?? null,
    applicationStatus: item.application?.status ?? null,
    sourceFiles: Array.isArray(item.source) ? item.source.map(file => ({ path: file.path, sha256: file.sha256, bytes: file.bytes })) : [],
    initialSourceFiles: Array.isArray(item.initialSource) ? item.initialSource.length : null,
    sessionId: item.binding?.sessionId ?? null,
    providerId: item.binding?.providerId ?? null,
    modelId: item.metrics?.models?.[0]?.modelId ?? null,
    lastTurnId: Array.isArray(item.turns) && item.turns.length ? item.turns.at(-1).turnId : null,
    rounds: Array.isArray(item.turns) ? item.turns.length : 0,
    stopped: !!item.stop,
    error: item.error ?? null,
  };
}

/** Aggregate one run. `passed` stays false on purpose: the driver states facts it
 * proved, and a product/installer/player acceptance is not one of them. */
export function summarizeRun({ requestedCases, executedCases, cases, stopped = false, error = null, requestLimitReached = false }) {
  const requested = [...requestedCases];
  const executed = [...executedCases];
  const perCase = (cases ?? []).map(summarizeCase);
  const complete = perCase.filter(item => item.pipeline && item.behaviorVerified).map(item => item.caseId);
  const allRequestedExecuted = requested.length > 0 && requested.every(caseId => executed.includes(caseId));
  const everyPipeline = executed.length === requested.length && perCase.length === requested.length && perCase.every(item => item.pipeline);
  const pipelinePassed = !stopped && !error && !requestLimitReached && allRequestedExecuted && everyPipeline;
  // Only the cases this run was asked for count towards its own verdict.
  const selected = perCase.filter(item => requested.includes(item.caseId));
  const behaviorVerified = pipelinePassed && selected.length === requested.length && selected.every(item => item.behaviorVerified);
  const both = requested.length === 2 && CASE_IDS.every(caseId => requested.includes(caseId));
  // Real failures and deferred items are never dropped from the summary.
  const tag = (item, list) => list.map(id => `${item.caseId}:${id}`);
  return {
    caseSelection: { requested, executed, requestedCount: requested.length, executedCount: executed.length },
    perCase,
    completeCases: complete,
    allRequestedExecuted,
    stopped: !!stopped,
    requestLimitReached: !!requestLimitReached,
    error: error ? String(error).slice(0, 2000) : null,
    pipelinePassed,
    behaviorVerified,
    gameplayFailed: selected.flatMap(item => tag(item, item.gameplayFailed)),
    gameplayInsufficient: selected.flatMap(item => tag(item, item.gameplayInsufficient)),
    reviewRequiredItems: selected.flatMap(item => tag(item, item.gameplayReviewRequired)),
    pendingReview: selected.flatMap(item => tag(item, item.gameplayReviewRequired)).length > 0,
    // A single-case pass is only ever a single-case pass, in the report itself.
    singleCasePassed: requested.length === 1 && pipelinePassed && behaviorVerified && complete.length === 1 && complete[0] === requested[0],
    combinedTwoCasePassed: both && pipelinePassed && behaviorVerified && complete.length === 2,
    reviewRequired: true,
    passed: false,
    note: 'pipelinePassed covers build/check/preview/adopt/save/restart only, never the gameplay verdict. behaviorVerified requires pipelinePassed and every gameplay criterion verified by machine with none deferred. Neither is a product, installer or player acceptance.',
  };
}
