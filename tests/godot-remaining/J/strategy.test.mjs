// L4 strategy layer: retrieval, tool selection, experiment gates and comparison.
//
// The point of these tests is not that a strategy "wins"; it is that the layer
// refuses to manufacture a win: no frozen set, no result; no adapter, no rate;
// different task sets, no comparison; small samples, no "improvement".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compareArms, compareRuns, createRetrievalIndex, runExperiment, selectTools,
  validateTaskSet, writeRunRecord,
} from '../../../desktop/godot/strategy/index.mjs';
import { hashContent } from '../../../desktop/godot/extensions/index.mjs';

const CONTEXT = { baseId: 'top-down', baseVersion: '1.1.0', stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable', availableCapabilities: ['read-scene', 'write-script'] };

function refOf(overrides = {}) {
  return {
    contentId: 'town-quest', contentVersion: '1.0.0', contentHash: hashContent('town-quest-bytes'),
    baseId: 'top-down', baseVersion: '1.0.0', stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable',
    ...overrides,
  };
}

function entryOf(overrides = {}) {
  return {
    format: 'craftmine.godot-strategy-entry/1',
    entryId: 'town-quest-work',
    entryKind: 'work',
    contentRef: refOf(),
    tags: ['quest', 'shop'],
    summary: 'add a shop quest',
    ...overrides,
  };
}

const resolver = ref => ({ found: true, hash: ref.contentHash });

function taskSetOf(count, overrides = {}) {
  return {
    format: 'craftmine.godot-strategy-taskset/1',
    frozen: true,
    frozenAt: '2026-09-10T00:00:00.000Z',
    frozenBy: 'acceptance-owner',
    scoringContract: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    tasks: Array.from({ length: count }, (_, index) => ({
      taskId: `task-${String(index + 1).padStart(2, '0')}`,
      baseId: 'top-down',
      baseVersion: '1.1.0',
      stateFormat: 'craftmine.godot-topdown-state/1',
      engineVersion: '4.7.2-stable',
      prompt: `需求 ${index + 1}`,
      capabilityTags: ['quest'],
    })),
    ...overrides,
  };
}

test('retrieval excludes incompatible and unresolvable entries with reasons', () => {
  const index = createRetrievalIndex({
    resolveContent: resolver,
    entries: [
      entryOf(),
      entryOf({ entryId: 'wrong-engine', contentRef: refOf({ engineVersion: '4.6.0-stable' }) }),
      entryOf({ entryId: 'wrong-base', contentRef: refOf({ baseId: 'first-person' }) }),
      entryOf({ entryId: 'wrong-state', contentRef: refOf({ stateFormat: 'craftmine.godot-topdown-state/9' }) }),
      entryOf({ entryId: 'too-new-base', contentRef: refOf({ baseVersion: '2.0.0' }) }),
      entryOf({ entryId: 'pointer-only', contentRef: { ...refOf(), contentHash: undefined } }),
      entryOf({ entryId: 'other-tag', tags: ['mining'] }),
      entryOf({ entryId: 'experience-entry', entryKind: 'experience', tags: ['quest'], outcome: { success: true, repairs: 1 } }),
    ],
  });

  const result = index.query({ ...CONTEXT, tags: ['quest'], limit: 10 });
  assert.deepEqual(result.items.map(item => item.entryId), ['experience-entry', 'town-quest-work']);
  const codes = Object.fromEntries(result.excluded.map(item => [item.entryId, item.code]));
  assert.equal(codes['wrong-engine'], 'engine-mismatch');
  assert.equal(codes['wrong-base'], 'base-mismatch');
  assert.equal(codes['wrong-state'], 'state-format-mismatch');
  assert.equal(codes['too-new-base'], 'base-version-incompatible');
  assert.equal(codes['other-tag'], 'tag-miss');
  assert.equal(result.invalid.length, 1, '只有指针没有哈希的条目连索引都进不去');
  assert.equal(result.invalid[0].entryId, 'pointer-only');
});

test('retrieval refuses entries it cannot verify', () => {
  const index = createRetrievalIndex({ entries: [entryOf()] });
  const result = index.query({ ...CONTEXT, tags: ['quest'] });
  assert.equal(result.items.length, 0);
  assert.equal(result.excluded[0].code, 'unresolved-content');

  const verified = createRetrievalIndex({ entries: [entryOf()], resolveContent: () => ({ found: true, bytes: 'different' }) });
  assert.equal(verified.query({ ...CONTEXT }).excluded[0].code, 'unresolved-content');
});

test('tool selection: baseline keeps everything, candidate filters and orders', () => {
  const catalog = [
    { toolId: 'zeta-writer', bases: ['top-down'], capabilities: ['write-script'], costClass: 1 },
    { toolId: 'alpha-reader', bases: ['top-down'], capabilities: ['read-scene'], costClass: 3 },
    { toolId: 'engine-pinned', bases: ['top-down'], engineVersions: ['4.6.0-stable'], costClass: 1 },
    { toolId: 'state-pinned', bases: ['top-down'], stateFormats: ['craftmine.godot-topdown-state/9'], costClass: 1 },
    { toolId: 'needs-missing', bases: ['top-down'], requires: ['network'], costClass: 1 },
    { toolId: 'failed-tool', bases: ['top-down'], capabilities: ['write-script'], costClass: 1 },
    { toolId: 'wrong-base-tool', bases: ['first-person'], costClass: 1 },
  ];
  const memory = [{ toolId: 'failed-tool', baseId: 'top-down', baseVersion: '1.1.0', capability: 'write-script', outcome: 'failure', at: '2026-09-10T01:00:00.000Z' }];
  const input = { task: { taskId: 'task-01', capabilityTags: ['quest'] }, catalog, context: CONTEXT, memory, maxTools: 8 };

  const baseline = selectTools({ ...input, arm: 'baseline' });
  const candidate = selectTools({ ...input, arm: 'candidate' });

  assert.ok(baseline.tools.some(tool => tool.toolId === 'engine-pinned'), '旧策略不看引擎兼容');
  assert.ok(baseline.tools.some(tool => tool.toolId === 'failed-tool'), '旧策略不看失败经验');
  assert.ok(baseline.tools.some(tool => tool.toolId === 'needs-missing'), '旧策略不看前置能力');

  assert.deepEqual(candidate.tools.map(tool => tool.toolId), ['zeta-writer', 'alpha-reader']);
  const codes = Object.fromEntries(candidate.excluded.map(item => [item.toolId, item.code]));
  assert.equal(codes['engine-pinned'], 'engine-mismatch');
  assert.equal(codes['state-pinned'], 'state-format-mismatch');
  assert.equal(codes['needs-missing'], 'missing-requirement');
  assert.equal(codes['failed-tool'], 'failed-before');
  assert.equal(codes['wrong-base-tool'], 'base-mismatch');
});

test('tool selection is deterministic and both arms share one input', () => {
  const catalog = [
    { toolId: 'b-tool', bases: ['top-down'], costClass: 2 },
    { toolId: 'a-tool', bases: ['top-down'], costClass: 1 },
  ];
  const input = { task: { taskId: 'task-01' }, catalog, context: CONTEXT, memory: [] };
  assert.deepEqual(selectTools({ ...input, arm: 'candidate' }), selectTools({ ...input, arm: 'candidate' }));
  const both = compareArms(input);
  assert.deepEqual(both.baseline.tools.map(tool => tool.toolId), ['a-tool', 'b-tool']);
  assert.deepEqual(both.candidate.tools.map(tool => tool.toolId), ['a-tool', 'b-tool']);
});

test('experiment refuses to run without a frozen set or an adapter', async () => {
  const unfrozen = taskSetOf(3, { frozen: false });
  const blockedFrozen = await runExperiment({ taskSet: unfrozen, runAttempt: async () => ({ success: true }) });
  assert.equal(blockedFrozen.status, 'blocked');
  assert.equal(blockedFrozen.reason, 'evaluation-set-not-frozen');

  const blockedAdapter = await runExperiment({ taskSet: taskSetOf(3) });
  assert.equal(blockedAdapter.reason, 'no-attempt-adapter');

  const invalid = await runExperiment({ taskSet: { format: 'craftmine.godot-strategy-taskset/1' }, runAttempt: async () => ({ success: true }) });
  assert.equal(invalid.reason, 'invalid-task-set');
  assert.ok(validateTaskSet(taskSetOf(2)).passed);
});

test('a completed run keeps failures in the denominator and aggregates honestly', async () => {
  const taskSet = taskSetOf(4);
  const run = await runExperiment({
    taskSet,
    evidence: 'logic-only',
    runAttempt: async ({ task, arm, attempt }) => {
      const failsFirst = arm === 'baseline' || task.taskId === 'task-04';
      if (attempt === 1) {
        return { success: !failsFirst, humanInterventions: failsFirst ? 1 : 0, tokens: { input: 100, output: 20, cached: 5 }, durationMs: 1000 };
      }
      return { success: task.taskId !== 'task-04', tokens: { input: 200, output: 40 }, durationMs: 500 };
    },
  });

  assert.equal(run.status, 'completed');
  const baseline = run.arms.find(arm => arm.arm === 'baseline');
  const candidate = run.arms.find(arm => arm.arm === 'candidate');
  assert.equal(baseline.firstAttemptSuccess, 0);
  assert.equal(baseline.successAfterRepairs, 3);
  assert.equal(baseline.failures, 1, '失败必须留在分母里');
  assert.equal(candidate.firstAttemptSuccess, 3);
  assert.equal(candidate.successAfterRepairs, 3);
  assert.equal(candidate.failures, 1);
  assert.equal(candidate.rateStatus, 'measured');
  assert.equal(baseline.tokens.input, 4 * 100 + 4 * 200);
  assert.equal(baseline.tokens.cached, 4 * 5);
  assert.equal(baseline.tokens.unknown, 0);
  assert.match(run.note, /逻辑样本/);
});

test('run records are written only for completed runs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-j-run-'));
  const blocked = await runExperiment({ taskSet: taskSetOf(3) });
  assert.throws(() => writeRunRecord(blocked, dir), /被阻断/);
  const run = await runExperiment({ taskSet: taskSetOf(3), runAttempt: async () => ({ success: true, durationMs: 10 }) });
  const written = writeRunRecord(run, dir);
  assert.equal(fs.existsSync(written.file), true);
  assert.equal(JSON.parse(fs.readFileSync(written.file, 'utf8')).format, 'craftmine.godot-strategy-run/1');
});

async function runPair({ tasks = 10, candidateFirstSuccess, baselineFirstSuccess, candidateRegression = false }) {
  const taskSet = taskSetOf(tasks);
  const adapter = arm => async ({ task }) => {
    const succeeds = arm === 'baseline' ? baselineFirstSuccess(task) : candidateFirstSuccess(task);
    return { success: succeeds, durationMs: arm === 'baseline' ? 100 : 90, regressions: arm === 'candidate' && candidateRegression ? ['world state changed'] : [] };
  };
  const baseline = await runExperiment({ taskSet, armIds: ['baseline'], evidence: 'logic-only', runAttempt: adapter('baseline') });
  const candidate = await runExperiment({ taskSet, armIds: ['candidate'], evidence: 'logic-only', runAttempt: adapter('candidate') });
  return { taskSet, baseline, candidate };
}

test('comparison refuses across different task sets and small samples', async () => {
  const ten = taskSetOf(10);
  const runA = await runExperiment({ taskSet: ten, armIds: ['baseline', 'candidate'], evidence: 'logic-only', runAttempt: async () => ({ success: true }) });
  const other = await runExperiment({ taskSet: taskSetOf(10, { frozenAt: '2026-09-11T00:00:00.000Z' }), armIds: ['baseline', 'candidate'], evidence: 'logic-only', runAttempt: async () => ({ success: true }) });
  assert.equal(compareRuns(runA, other).reason, 'different-task-set');

  const small = await runExperiment({ taskSet: taskSetOf(2), armIds: ['baseline', 'candidate'], evidence: 'logic-only', runAttempt: async () => ({ success: true }) });
  const smallCompare = compareRuns(small, small);
  assert.equal(smallCompare.verdict, 'insufficient-sample');
});

test('comparison reports improvement, regression and refusal to overclaim', async () => {
  const improved = await runPair({
    candidateFirstSuccess: () => true,
    baselineFirstSuccess: task => task.taskId !== 'task-01',
  });
  const improvedCompare = compareRuns(improved.baseline, improved.candidate);
  assert.equal(improvedCompare.verdict, 'improved');
  assert.equal(improvedCompare.deltas.firstAttemptSuccess, 1);
  assert.deepEqual(improvedCompare.regressedTasks, []);

  const regressed = await runPair({
    candidateFirstSuccess: task => task.taskId !== 'task-03',
    baselineFirstSuccess: () => true,
  });
  const regressedCompare = compareRuns(regressed.baseline, regressed.candidate);
  assert.equal(regressedCompare.verdict, 'regressed');
  assert.deepEqual(regressedCompare.regressedTasks.map(item => item.taskId), ['task-03']);

  const flagged = await runPair({
    candidateFirstSuccess: () => true,
    baselineFirstSuccess: () => true,
    candidateRegression: true,
  });
  assert.equal(compareRuns(flagged.baseline, flagged.candidate).verdict, 'regressed', '回归标记不能被"成功数不降"抵消');

  const noChange = await runPair({ candidateFirstSuccess: () => true, baselineFirstSuccess: () => true });
  assert.equal(compareRuns(noChange.baseline, noChange.candidate).verdict, 'no-improvement');
});

test('an adapter that throws leaves the task in the denominator and disables the rate', async () => {
  const run = await runExperiment({
    taskSet: taskSetOf(3),
    armIds: ['baseline', 'candidate'],
    evidence: 'logic-only',
    runAttempt: async ({ task, arm }) => {
      if (task.taskId === 'task-02' && arm === 'candidate') throw new Error('adapter crashed');
      return { success: true };
    },
  });
  assert.equal(run.status, 'completed');
  const candidate = run.arms.find(arm => arm.arm === 'candidate');
  assert.equal(candidate.attempts, 2);
  assert.equal(candidate.completionRate, null);
  assert.equal(candidate.rateStatus, 'unknown');
  assert.equal(candidate.failures, 1, '未执行的任务必须留在分母里');
  assert.deepEqual(candidate.errors, [{ taskId: 'task-02', error: 'adapter crashed' }]);
  const comparison = compareRuns(run, run);
  assert.equal(comparison.status, 'refused');
  assert.equal(comparison.reason, 'incomplete-run');
});

test('allowUnverified is the only escape hatch and marks entries unverified', () => {
  const index = createRetrievalIndex({ entries: [entryOf()] });
  assert.equal(index.query({ ...CONTEXT }).items.length, 0);
  const loose = index.query({ ...CONTEXT, allowUnverified: true });
  assert.equal(loose.items.length, 1);
  assert.equal(loose.items[0].verified, false);
  assert.equal(loose.excluded.length, 0);
});
