// One place decides what a run's result means, so a single-case run can never be
// reported as a two-case pass and a stopped or failed run can never be reported
// as passed. The driver calls this; the offline tests call the same function.
const CASE_IDS = Object.freeze(['hammer', 'dog']);

// One place decides what a run's result means, so a single-case run can never be
// reported as a two-case pass and a stopped or failed run can never be reported
// as passed. The driver calls this; the offline tests call the same function.

export const CASE_PIPELINE_COMPLETE = 'source-check-apply-save-completed';

/** Per-case identity a reviewer needs: source, package, model, task, candidate,
 * adoption and gameplay verdict, never only a boolean. */
export function summarizeCase(item) {
  return {
    caseId: item.caseId,
    worldId: item.worldId ?? null,
    outcome: item.outcome ?? 'running',
    startedAt: item.startedAt ?? null,
    finishedAt: item.finishedAt ?? null,
    pipeline: item.outcome === CASE_PIPELINE_COMPLETE && item.restart?.passed === true,
    restart: item.restart?.passed === true,
    behaviorVerified: item.gameplay?.verified === true,
    gameplayFailed: item.gameplay?.failed ?? [],
    gameplayInsufficient: item.gameplay?.insufficient ?? [],
    initialBuildId: item.initialBuildId ?? null,
    candidateId: item.candidate?.candidateId ?? null,
    candidateBuildId: item.candidate?.buildId ?? null,
    appliedBuildId: item.application?.record?.world?.build?.id ?? null,
    applicationStatus: item.application?.status ?? null,
    sourceFiles: Array.isArray(item.source) ? item.source.map(file => ({ path: file.path, sha256: file.sha256, bytes: file.bytes })) : [],
    sessionId: item.binding?.sessionId ?? null,
    providerId: item.binding?.providerId ?? null,
    modelId: item.metrics?.models?.[0]?.modelId ?? null,
    lastTurnId: Array.isArray(item.turns) && item.turns.length ? item.turns.at(-1).turnId : null,
    rounds: Array.isArray(item.turns) ? item.turns.length : 0,
    stopped: !!item.stop,
    error: item.error ?? null,
  };
}

/** Aggregate one run. `passed` stays false on purpose: gameplay verdicts still
 * need an independent reviewer, and this function only states facts it proved. */
export function summarizeRun({ requestedCases, executedCases, cases, stopped = false, error = null, requestLimitReached = false }) {
  const requested = [...requestedCases];
  const executed = [...executedCases];
  const perCase = (cases ?? []).map(summarizeCase);
  const complete = perCase.filter(item => item.pipeline && item.behaviorVerified).map(item => item.caseId);
  const allRequestedExecuted = requested.length > 0 && requested.every(caseId => executed.includes(caseId));
  const expected = executed.length === requested.length && perCase.length === requested.length && perCase.every(item => item.pipeline);
  const pipelinePassed = !stopped && !error && !requestLimitReached && allRequestedExecuted && expected;
  const behaviorVerified = pipelinePassed && perCase.every(item => item.behaviorVerified);
  const both = requested.length === 2 && CASE_IDS.every(caseId => requested.includes(caseId));
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
    // A single-case pass is only ever a single-case pass, in the report itself.
    singleCasePassed: requested.length === 1 && pipelinePassed && behaviorVerified && complete.length === 1 && complete[0] === requested[0],
    combinedTwoCasePassed: both && pipelinePassed && behaviorVerified && complete.length === 2,
    reviewRequired: true,
    passed: false,
    note: 'pipelinePassed covers build/check/preview/adopt/save/restart and the gameplay verdict; it is not a product, installer or player acceptance.',
  };
}

