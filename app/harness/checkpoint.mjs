// 检查点与压缩事务（P4）：机器事实由宿主生成，摘要模型只能写「解释」那一半。
// 压缩必须是可回退的：先落盘、再核对、最后原子换 manifest；任何一步失败都保留旧的可用版本。
export const CHECKPOINT_FORMAT = 'craftmine.checkpoint/1';
export const COMPACTION_FORMAT = 'craftmine.compaction/1';
export const CHECKPOINT_REQUIRED_REFS = Object.freeze(['baseBuild', 'draftHead', 'acceptanceRef', 'budgetRef']);

const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw Error(message); };
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// 机器事实：全部来自已落盘的宿主记录，摘要模型无权修改。
export function machineCheckpoint(input) {
  need(isPlain(input), '检查点必须是对象');
  need(text(input.taskId, 120), '检查点缺少 taskId');
  need(Number.isInteger(input.intentRevision) && input.intentRevision >= 0, '检查点缺少 intentRevision');
  need(text(input.baseBuild, 120), '检查点缺少 baseBuild');
  need(text(input.draftHead, 120), '检查点缺少 draftHead');
  need(text(input.acceptanceRef, 120), '检查点缺少验收引用');
  need(text(input.budgetRef, 120), '检查点缺少预算引用');
  need(Number.isInteger(input.journalThrough) && input.journalThrough >= 0, '检查点缺少日志水位 journalThrough');
  for (const key of ['completedSteps', 'pendingSteps', 'openToolCalls', 'artifactRefs']) {
    need(Array.isArray(input[key]), `检查点的 ${key} 必须是数组`);
  }
  need(input.candidateRef === null || text(input.candidateRef, 120), '检查点的候选引用无效');
  need(input.narrativeRef === undefined || text(input.narrativeRef, 120), '检查点的解释引用无效');
  return {
    format: CHECKPOINT_FORMAT,
    taskId: input.taskId, intentRevision: input.intentRevision,
    baseBuild: input.baseBuild, draftHead: input.draftHead,
    acceptanceRef: input.acceptanceRef, budgetRef: input.budgetRef,
    completedSteps: input.completedSteps.map(step => isPlain(step) ? { ...step } : step),
    pendingSteps: [...input.pendingSteps], openToolCalls: [...input.openToolCalls],
    candidateRef: input.candidateRef ?? null,
    progressObservationRef: input.progressObservationRef ?? null,
    journalThrough: input.journalThrough,
    artifactRefs: [...input.artifactRefs],
    ...(input.narrativeRef ? { narrativeRef: input.narrativeRef } : {}),
    projectRulesRevision: Number.isInteger(input.projectRulesRevision) ? input.projectRulesRevision : null,
  };
}

export function validateCheckpoint(checkpoint) {
  need(isPlain(checkpoint) && checkpoint.format === CHECKPOINT_FORMAT, '检查点格式不兼容');
  for (const key of CHECKPOINT_REQUIRED_REFS) need(checkpoint[key] !== undefined && checkpoint[key] !== null, `检查点缺少机器事实：${key}`);
  need(checkpoint.journalThrough >= 0, '检查点日志水位无效');
  return checkpoint;
}

// 压缩计划：哪些事件保留、哪些可以转成解释、必须保留哪些引用。
export function compactionPlan({ checkpoint, events = [], keepRecent = 8, waterline = null } = {}) {
  validateCheckpoint(checkpoint);
  need(Array.isArray(events), '压缩计划需要事件数组');
  const through = waterline === null ? checkpoint.journalThrough : waterline;
  const covered = events.filter(event => event.sequence <= through);
  const after = events.filter(event => event.sequence > through);
  const recent = covered.slice(-Math.max(0, keepRecent));
  const summarize = covered.slice(0, Math.max(0, covered.length - recent.length));
  return {
    format: COMPACTION_FORMAT,
    taskId: checkpoint.taskId, through,
    keep: recent.map(event => event.sequence),
    summarize: summarize.map(event => event.sequence),
    after: after.map(event => event.sequence),
    mustKeepRefs: [...CHECKPOINT_REQUIRED_REFS.map(key => checkpoint[key]), ...(checkpoint.artifactRefs || [])],
  };
}

// 一次压缩事务：先写 started，再检查摘要，最后原子提交 completed 并换 manifest。
export function compactionTransaction({ journal = [], checkpoint, plan, summary } = {}) {
  const entries = [...journal];
  const id = `compact:${checkpoint.taskId}:${plan.through}`;
  const push = (type, data) => entries.push({ type, id, at: entries.length + 1, ...data });
  push('compaction.started', { through: plan.through, summarize: plan.summarize.length, keep: plan.keep.length });
  need(isPlain(summary), '压缩必须给出一份解释摘要');
  if (summary.truncated === true) {
    push('compaction.failed', { reason: 'truncated' });
    return { format: COMPACTION_FORMAT, committed: false, journal: entries, error: '解释摘要被输出上限截断，拒绝使用', checkpoint };
  }
  if (!text(summary.text, 4000)) {
    push('compaction.failed', { reason: 'empty' });
    return { format: COMPACTION_FORMAT, committed: false, journal: entries, error: '解释摘要为空或过长，拒绝使用', checkpoint };
  }
  const missing = (plan.mustKeepRefs || []).filter(ref => !String(summary.text).includes(String(ref)) && !(summary.refs || []).includes(ref));
  if (missing.length) {
    push('compaction.failed', { reason: 'missing-refs', missing });
    return { format: COMPACTION_FORMAT, committed: false, journal: entries, error: `摘要缺少关键引用：${missing.join('、')}。拒绝替换上下文。`, checkpoint };
  }
  const next = {
    ...checkpoint,
    journalThrough: plan.through,
    ...(summary.narrativeRef ? { narrativeRef: summary.narrativeRef } : {}),
  };
  push('compaction.completed', { manifest: plan.through, summaryHash: summary.hash || null, kept: plan.keep.length });
  return {
    format: COMPACTION_FORMAT, committed: true, journal: entries, checkpoint: next,
    manifest: { coversThrough: plan.through, summaryHash: summary.hash || null, kept: plan.keep, dropped: plan.summarize },
    detail: `压缩提交：${plan.summarize.length} 条事件转成解释，保留最近 ${plan.keep.length} 条与全部机器事实`,
  };
}

// 重启后核对：未闭合的 started 不算成功，必须以实际 manifest 为准。
export function reconcileCompaction({ journal = [], manifest = null } = {}) {
  const starts = journal.filter(entry => entry.type === 'compaction.started');
  const completed = journal.filter(entry => entry.type === 'compaction.completed');
  const lastStart = starts[starts.length - 1] || null;
  const lastComplete = completed[completed.length - 1] || null;
  const open = Boolean(lastStart) && (!lastComplete || lastComplete.at < lastStart.at);
  return {
    format: COMPACTION_FORMAT, open, lastStart, lastComplete, manifest,
    detail: open ? '发现未闭合的压缩：以磁盘上的 manifest 为准，重新评估是否需要压缩' : '压缩记录闭合',
  };
}

export function checkpointText(checkpoint) {
  return [
    `任务 ${checkpoint.taskId} · 目标版本 ${checkpoint.intentRevision}`,
    `基准 ${checkpoint.baseBuild} · 草稿 ${checkpoint.draftHead} · 日志水位 ${checkpoint.journalThrough}`,
    `已完成 ${checkpoint.completedSteps.length} 步 · 待完成 ${checkpoint.pendingSteps.length} 项 · 产物 ${checkpoint.artifactRefs.length} 个`,
    `候选 ${checkpoint.candidateRef || '无'} · 验收 ${checkpoint.acceptanceRef} · 预算 ${checkpoint.budgetRef}`,
  ].join('\n');
}
