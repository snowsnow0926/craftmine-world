// L4 strategy experiment runner.
//
// Hard gates, all of them deliberate:
//   * the task set must be frozen by the acceptance owner and carry a scoring
//     contract hash; an unfrozen set produces `blocked`, not results;
//   * without a real attempt adapter the runner produces `blocked` and records
//     nothing that could be mistaken for a success rate;
//   * failures stay in the denominator;
//   * a comparison refuses to run across two different task sets, and refuses
//     to declare an improvement from a sample smaller than the frozen minimum.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  EVIDENCE_CLASSES, STRATEGY_RUN_FORMAT, STRATEGY_TASKSET_FORMAT, STRATEGY_COMPARE_FORMAT,
  isPlain, median, p95,
} from './formats.mjs';
import { ARM_IDS } from './tool-selection.mjs';

export const MIN_FROZEN_TASKS = 10;

function digestOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function validateTaskSet(raw) {
  const errors = [];
  if (!isPlain(raw)) return { passed: false, errors: ['任务集必须是对象'], taskSet: null, digest: null };
  if (raw.format !== STRATEGY_TASKSET_FORMAT) errors.push(`任务集 format 必须是 ${STRATEGY_TASKSET_FORMAT}`);
  // "Frozen or not" is reported separately: a well-formed but unfrozen set is a
  // different failure from a malformed one, and the runner says so explicitly.
  if (typeof raw.frozenBy !== 'string' || raw.frozenBy.trim().length === 0) errors.push('任务集缺少 frozenBy（冻结负责人）');
  if (typeof raw.frozenAt !== 'string' || raw.frozenAt.trim().length === 0) errors.push('任务集缺少 frozenAt');
  if (typeof raw.scoringContract !== 'string' || raw.scoringContract.trim().length === 0) errors.push('任务集缺少 scoringContract（评分契约哈希，由验收方提供）');
  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) errors.push('任务集至少要有一条任务');
  else raw.tasks.forEach((task, index) => {
    if (!isPlain(task)) { errors.push(`tasks[${index}] 必须是对象`); return; }
    for (const field of ['taskId', 'baseId', 'baseVersion', 'stateFormat', 'engineVersion', 'prompt']) {
      if (typeof task[field] !== 'string' || task[field].trim().length === 0) errors.push(`tasks[${index}].${field} 不能为空`);
    }
    if (task.capabilityTags !== undefined && !Array.isArray(task.capabilityTags)) errors.push(`tasks[${index}].capabilityTags 必须是数组`);
  });
  const passed = errors.length === 0;
  return { passed, errors, frozen: raw.frozen === true, taskSet: passed ? raw : null, digest: passed ? digestOf(raw) : null };
}

function emptyTokens() {
  return { input: 0, output: 0, cached: 0, unknown: 0 };
}

function addTokens(target, tokens) {
  const source = isPlain(tokens) ? tokens : {};
  for (const key of ['input', 'output', 'cached', 'unknown']) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0) target[key] += value;
    else target.unknown += 1;
  }
}

function normalizeAttempt(result) {
  const value = isPlain(result) ? result : {};
  return {
    success: value.success === true,
    repairs: Number.isFinite(value.repairs) ? value.repairs : 0,
    humanInterventions: Number.isFinite(value.humanInterventions) ? value.humanInterventions : 0,
    tokens: isPlain(value.tokens) ? { ...emptyTokens(), ...value.tokens } : emptyTokens(),
    cacheHits: Number.isFinite(value.cacheHits) ? value.cacheHits : 0,
    durationMs: Number.isFinite(value.durationMs) ? value.durationMs : null,
    regressions: Array.isArray(value.regressions) ? value.regressions : [],
    notes: typeof value.notes === 'string' ? value.notes : '',
    toolSelection: isPlain(value.toolSelection) ? value.toolSelection : null,
  };
}

/**
 * @param {object} options
 * @param {object} options.taskSet      frozen task set from the acceptance owner
 * @param {string[]} [options.armIds]   default ['baseline','candidate']
 * @param {Function} [options.runAttempt] async ({ task, arm, attempt }) => result
 * @param {string} [options.evidence]   one of EVIDENCE_CLASSES
 * @param {Function} [options.now]
 */
export async function runExperiment({ taskSet, armIds = ARM_IDS, runAttempt = null, evidence = 'logic-only', now = () => new Date().toISOString() } = {}) {
  const validation = validateTaskSet(taskSet);
  if (!validation.passed) {
    return { format: STRATEGY_RUN_FORMAT, status: 'blocked', reason: 'invalid-task-set', errors: validation.errors, summary: '任务集不合法，未执行任何尝试' };
  }
  if (!validation.frozen) {
    return { format: STRATEGY_RUN_FORMAT, status: 'blocked', reason: 'evaluation-set-not-frozen', taskSetDigest: validation.digest, summary: '评测集未冻结，GD8 不能据此宣称任何结论' };
  }
  if (typeof runAttempt !== 'function') {
    return {
      format: STRATEGY_RUN_FORMAT, status: 'blocked', reason: 'no-attempt-adapter', taskSetDigest: validation.digest,
      summary: '没有真实执行/模型适配器：只能记录为未执行，不能产生成功率',
    };
  }
  const evidenceClass = EVIDENCE_CLASSES.includes(evidence) ? evidence : 'logic-only';
  const armList = armIds.filter(arm => ARM_IDS.includes(arm));
  if (!armList.length) return { format: STRATEGY_RUN_FORMAT, status: 'blocked', reason: 'no-arms', summary: '没有可执行的分支' };

  const runs = [];
  for (const arm of armList) {
    const attempts = [];
    for (const task of taskSet.tasks) {
      const first = normalizeAttempt(await runAttempt({ task, arm, attempt: 1 }));
      let repair = null;
      if (!first.success) repair = normalizeAttempt(await runAttempt({ task, arm, attempt: 2 }));
      attempts.push({
        taskId: task.taskId, arm,
        firstAttemptSuccess: first.success,
        successAfterRepairs: first.success || repair?.success === true,
        repairs: first.repairs + (repair?.repairs ?? 0),
        humanInterventions: first.humanInterventions + (repair?.humanInterventions ?? 0),
        tokens: (() => { const total = emptyTokens(); addTokens(total, first.tokens); if (repair) addTokens(total, repair.tokens); return total; })(),
        cacheHits: first.cacheHits + (repair?.cacheHits ?? 0),
        durationMs: (first.durationMs ?? 0) + (repair?.durationMs ?? 0),
        regressions: [...first.regressions, ...(repair?.regressions ?? [])],
        notes: [first.notes, repair?.notes].filter(Boolean).join(' | '),
        toolSelection: first.toolSelection,
      });
    }
    const attempted = attempts.filter(item => item.taskId).length;
    const everyTaskAttempted = attempted === taskSet.tasks.length;
    const firstSuccess = attempts.filter(item => item.firstAttemptSuccess).length;
    const afterRepairs = attempts.filter(item => item.successAfterRepairs).length;
    const tokens = emptyTokens();
    for (const item of attempts) addTokens(tokens, item.tokens);
    const durations = attempts.map(item => item.durationMs).filter(value => Number.isFinite(value) && value > 0);
    runs.push({
      arm,
      tasks: taskSet.tasks.length,
      attempts: attempted,
      firstAttemptSuccess: firstSuccess,
      successAfterRepairs: afterRepairs,
      failures: taskSet.tasks.length - afterRepairs,
      completionRate: everyTaskAttempted ? Number((firstSuccess / taskSet.tasks.length).toFixed(4)) : null,
      rateStatus: everyTaskAttempted ? 'measured' : 'unknown',
      humanInterventions: attempts.reduce((total, item) => total + item.humanInterventions, 0),
      tokens,
      cacheHits: attempts.reduce((total, item) => total + item.cacheHits, 0),
      durationMs: { median: median(durations), p95: p95(durations), samples: durations.length },
      regressions: attempts.flatMap(item => item.regressions.map(note => ({ taskId: item.taskId, note }))),
      details: attempts,
    });
  }

  return {
    format: STRATEGY_RUN_FORMAT,
    status: 'completed',
    runId: 'run-' + digestOf({ taskSet: validation.digest, armList, at: now() }).slice(0, 12),
    startedAt: now(),
    evidence: evidenceClass,
    taskSet: { digest: validation.digest, frozenAt: taskSet.frozenAt, frozenBy: taskSet.frozenBy, scoringContract: taskSet.scoringContract, tasks: taskSet.tasks.length },
    arms: runs,
    note: evidenceClass === 'logic-only'
      ? '本次只使用逻辑样本/固定适配器，不能当作真实模型或引擎验收结果'
      : `证据类别：${evidenceClass}`,
    summary: runs.map(run => `${run.arm}：首次成功 ${run.firstAttemptSuccess}/${run.tasks}，修复后 ${run.successAfterRepairs}/${run.tasks}`).join('；'),
  };
}

export function writeRunRecord(run, dir) {
  if (!isPlain(run) || run.format !== STRATEGY_RUN_FORMAT) throw new Error('不是可写入的策略运行记录');
  if (run.status === 'blocked') throw new Error('被阻断的运行不写入结果记录：' + run.summary);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${run.runId || 'run'}.json`);
  const temp = file + '.tmp-' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(run, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
  return { file, bytes: fs.statSync(file).size };
}

/**
 * Compare two completed runs. Refuses across different task sets, refuses to
 * call a small sample an improvement, and keeps regressions explicit.
 */
export function compareRuns(baselineRun, candidateRun, { minTasks = MIN_FROZEN_TASKS } = {}) {
  const refused = (reason, detail) => ({ format: STRATEGY_COMPARE_FORMAT, status: 'refused', reason, detail, verdict: 'inconclusive' });
  if (baselineRun?.format !== STRATEGY_RUN_FORMAT || candidateRun?.format !== STRATEGY_RUN_FORMAT) return refused('not-a-run', '输入不是策略运行记录');
  if (baselineRun.status !== 'completed' || candidateRun.status !== 'completed') return refused('incomplete-run', '有运行被阻断或未完成，不能比较');
  if (baselineRun.taskSet?.digest !== candidateRun.taskSet?.digest) return refused('different-task-set', '两次运行使用了不同的评测集，比较无效');
  if (baselineRun.evidence !== candidateRun.evidence) return refused('different-evidence', `证据类别不同：${baselineRun.evidence} / ${candidateRun.evidence}`);

  const baseline = baselineRun.arms.find(arm => arm.arm === 'baseline');
  const candidate = candidateRun.arms.find(arm => arm.arm === 'candidate');
  if (!baseline || !candidate) return refused('missing-arm', '缺少 baseline 或 candidate 分支');

  const taskCount = baselineRun.taskSet.tasks;
  const deltas = {
    firstAttemptSuccess: candidate.firstAttemptSuccess - baseline.firstAttemptSuccess,
    successAfterRepairs: candidate.successAfterRepairs - baseline.successAfterRepairs,
    humanInterventions: candidate.humanInterventions - baseline.humanInterventions,
    tokens: candidate.tokens.input + candidate.tokens.output - (baseline.tokens.input + baseline.tokens.output),
    durationMedianMs: baseline.durationMs.median === null || candidate.durationMs.median === null
      ? null : Number((candidate.durationMs.median - baseline.durationMs.median).toFixed(3)),
  };

  const regressedTasks = [];
  for (const task of baseline.details || []) {
    const match = (candidate.details || []).find(item => item.taskId === task.taskId);
    if (!match) continue;
    const notes = [];
    if (task.firstAttemptSuccess && !match.firstAttemptSuccess) notes.push('首次成功退化为需要修复');
    if (task.successAfterRepairs && !match.successAfterRepairs) notes.push('修复后成功退化为失败');
    if (notes.length) regressedTasks.push({ taskId: task.taskId, note: notes.join('；') });
  }
  const candidateRegressions = (candidate.regressions || []).length;

  let verdict = 'no-improvement';
  if (baseline.rateStatus !== 'measured' || candidate.rateStatus !== 'measured') verdict = 'inconclusive';
  else if (regressedTasks.length || candidateRegressions) verdict = 'regressed';
  else if (deltas.firstAttemptSuccess > 0 || deltas.successAfterRepairs > 0) verdict = 'improved';
  if (taskCount < minTasks && verdict !== 'inconclusive') verdict = 'insufficient-sample';

  return {
    format: STRATEGY_COMPARE_FORMAT,
    status: 'compared',
    taskSetDigest: baselineRun.taskSet.digest,
    evidence: baselineRun.evidence,
    tasks: taskCount,
    baseline: { firstAttemptSuccess: baseline.firstAttemptSuccess, successAfterRepairs: baseline.successAfterRepairs, humanInterventions: baseline.humanInterventions, tokens: baseline.tokens, durationMedianMs: baseline.durationMs.median },
    candidate: { firstAttemptSuccess: candidate.firstAttemptSuccess, successAfterRepairs: candidate.successAfterRepairs, humanInterventions: candidate.humanInterventions, tokens: candidate.tokens, durationMedianMs: candidate.durationMs.median },
    deltas,
    regressedTasks,
    candidateRegressions,
    verdict,
    summary: verdict === 'improved'
      ? `在 ${taskCount} 条冻结任务上，新策略首次成功 +${deltas.firstAttemptSuccess}，修复后成功 +${deltas.successAfterRepairs}，无回归`
      : verdict === 'regressed'
        ? `新策略有回归：${regressedTasks.map(item => item.taskId + '（' + item.note + '）').join('、') || candidateRegressions + ' 处回归标记'}`
        : verdict === 'insufficient-sample'
          ? `样本只有 ${taskCount} 条，少于冻结下限 ${minTasks} 条，不能据此宣布改善`
          : verdict === 'inconclusive'
            ? '有运行缺少完整尝试，成功率不可用，结论不成立'
            : '没有可归因的改善',
  };
}
