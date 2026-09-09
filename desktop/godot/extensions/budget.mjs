// Performance and resource budget accounting for L3 parts.
//
// This module does not measure anything by itself: it consumes samples that a
// real run produced (engine headless timing, package size on disk, process
// memory). What it does enforce is honesty about the numbers:
//   * an undeclared budget can never be "passed", only reported as unknown;
//   * a declared budget with no matching measurement is unknown, never passed;
//   * an empty sample set is unknown, not 0 ms;
//   * the source of the measurement is recorded, so logic-only fixtures are
//     never counted as engine or release evidence.
import { PART_BUDGET_FORMAT } from './formats.mjs';

export const BUDGET_SOURCES = Object.freeze(['logic-only', 'engine-headless', 'engine-rendered', 'release-package']);

export const BUDGET_METRICS = Object.freeze(['frameMsP95', 'memoryBytes', 'packageBytes']);

export function percentile(samples, fraction) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

/**
 * @param {object} declared  { frameMsP95, memoryBytes, packageBytes, measured }
 * @param {object} measured  { samplesMs?: number[], memoryBytes?: number, packageBytes?: number, source: BUDGET_SOURCES[number] }
 */
export function measureBudget({ declared, measured = {} } = {}) {
  const reasons = [];
  const source = BUDGET_SOURCES.includes(measured.source) ? measured.source : 'logic-only';
  const samples = Array.isArray(measured.samplesMs) ? measured.samplesMs.filter(value => Number.isFinite(value)) : [];
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  const max = samples.length ? Math.max(...samples) : null;

  // Only budgets that were actually declared take part in the verdict. A budget
  // left as null is "not declared"; it neither passes nor fails.
  const declaredMetrics = [
    { key: 'frameMsP95', limit: declared?.frameMsP95 ?? null, value: p95, measured: samples.length > 0 },
    { key: 'memoryBytes', limit: declared?.memoryBytes ?? null, value: Number.isFinite(measured.memoryBytes) ? measured.memoryBytes : null, measured: Number.isFinite(measured.memoryBytes) },
    { key: 'packageBytes', limit: declared?.packageBytes ?? null, value: Number.isFinite(measured.packageBytes) ? measured.packageBytes : null, measured: Number.isFinite(measured.packageBytes) },
  ].filter(item => item.limit !== null);

  const unmeasured = declaredMetrics.filter(item => !item.measured);
  const exceeded = declaredMetrics.filter(item => item.measured && item.value > item.limit);

  for (const item of exceeded) {
    const unit = item.key === 'frameMsP95' ? 'ms' : ' 字节';
    reasons.push(`${item.key} 实测 ${item.value}${unit} 超过预算 ${item.limit}${unit}`);
  }
  for (const item of unmeasured) {
    reasons.push(`声明了 ${item.key} 预算但没有对应测量`);
  }
  if (!declaredMetrics.length) reasons.push('部件没有声明任何预算，无法判定是否达标');

  // A verdict of pass requires every declared budget to have a real measurement
  // inside its limit. Anything less is unknown — never a pass.
  const status = exceeded.length ? 'fail' : declaredMetrics.length === 0 || unmeasured.length ? 'unknown' : 'pass';

  return {
    format: PART_BUDGET_FORMAT,
    status,
    source,
    declared: {
      frameMsP95: declared?.frameMsP95 ?? null,
      memoryBytes: declared?.memoryBytes ?? null,
      packageBytes: declared?.packageBytes ?? null,
      measured: declared?.measured === true,
    },
    measured: {
      samples: samples.length,
      p50, p95, max,
      memoryBytes: Number.isFinite(measured.memoryBytes) ? measured.memoryBytes : null,
      packageBytes: Number.isFinite(measured.packageBytes) ? measured.packageBytes : null,
    },
    headroomMs: declared?.frameMsP95 !== null && declared?.frameMsP95 !== undefined && p95 !== null
      ? Number((declared.frameMsP95 - p95).toFixed(3)) : null,
    unmeasured: unmeasured.map(item => item.key),
    reasons,
    summary: status === 'pass'
      ? `在 ${source} 证据下满足全部 ${declaredMetrics.length} 项声明预算（帧时间 p95 ${p95}ms / 预算 ${declared.frameMsP95}ms）`
      : status === 'fail'
        ? exceeded.map(item => reasons.find(reason => reason.startsWith(item.key))).join('；')
        : '未测量：不能算通过（' + (reasons.join('；') || '没有可用样本') + '）',
  };
}

export function summarizeBudgets(reports) {
  const list = Array.isArray(reports) ? reports : [];
  const passed = list.filter(report => report.status === 'pass');
  const failed = list.filter(report => report.status === 'fail');
  const unknown = list.filter(report => report.status === 'unknown');
  return {
    format: PART_BUDGET_FORMAT,
    total: list.length,
    passed: passed.length,
    failed: failed.length,
    unknown: unknown.length,
    unknownParts: unknown.length,
    summary: `${list.length} 项预算：通过 ${passed.length}、失败 ${failed.length}、未测量 ${unknown.length}（未测量不等于通过）`,
  };
}
