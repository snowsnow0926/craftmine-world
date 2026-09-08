export const METRICS_FORMAT = 'craftmine.metrics/1';

// 指标只从任务日志派生，不另存一份，避免与真实记录不一致。
const stageLabels = {
  provider: '模型接入', response: '回复格式', scene: '场景构建',
  behavior: '源码运行', progress: '已有进度', commit: '应用',
};

export function taskRecord(task = {}) {
  const attempts = task.attempts || [];
  const first = attempts[0] || null;
  const failed = attempts.filter(attempt => attempt.status === 'failed');
  const lastFailed = failed[failed.length - 1] || null;
  const durationMs = Number.isFinite(task.started) && Number.isFinite(task.finished) ? task.finished - task.started : null;
  return {
    id: task.id, status: task.status ?? 'unknown', base: task.base ?? null, kind: task.intent || 'execute',
    attempts: attempts.length,
    firstPass: first?.status === 'passed',
    repaired: attempts.length > 1 && attempts[attempts.length - 1]?.status === 'passed',
    durationMs,
    inputTokens: task.usage?.input_tokens ?? null,
    outputTokens: task.usage?.output_tokens ?? null,
    failureClass: lastFailed ? (lastFailed.diagnostic?.stage || 'unknown') : null,
    failureLabel: lastFailed ? (stageLabels[lastFailed.diagnostic?.stage] || '未知阶段') : null,
    failureMessage: lastFailed?.diagnostic?.message ?? null,
  };
}

export function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}

export function summarizeTasks(tasks = []) {
  const records = tasks.map(taskRecord);
  const ran = records.filter(record => record.attempts > 0);
  const counts = {};
  for (const record of records) counts[record.status] = (counts[record.status] || 0) + 1;
  const failureClasses = {};
  for (const record of records) if (record.failureClass) failureClasses[record.failureClass] = (failureClasses[record.failureClass] || 0) + 1;
  const durations = ran.map(record => record.durationMs);
  const outputs = ran.map(record => record.outputTokens);
  return {
    format: METRICS_FORMAT,
    tasks: records.length,
    ran: ran.length,
    counts,
    firstPassRate: ran.length ? Number((ran.filter(record => record.firstPass).length / ran.length).toFixed(3)) : null,
    repairedRate: ran.length ? Number((ran.filter(record => record.repaired).length / ran.length).toFixed(3)) : null,
    failureClasses,
    durationMs: { median: percentile(durations, 0.5), p90: percentile(durations, 0.9) },
    outputTokens: { median: percentile(outputs, 0.5), p90: percentile(outputs, 0.9) },
    records,
  };
}
