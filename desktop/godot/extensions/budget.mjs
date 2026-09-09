// Performance and resource budget accounting for L3 parts.
//
// This module does not measure anything by itself: it consumes samples that a
// real run produced (engine headless timing, package size on disk, process
// memory). What it does enforce is honesty about the numbers:
//   * an undeclared budget can never be "passed", only reported as unknown;
//   * an empty sample set is unknown, not 0 ms;
//   * the source of the measurement is recorded, so logic-only fixtures are
//     never counted as engine or release evidence.
import { PART_BUDGET_FORMAT } from './formats.mjs';

export const BUDGET_SOURCES = Object.freeze(['logic-only', 'engine-headless', 'engine-rendered', 'release-package']);

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

  const frameBudget = declared?.frameMsP95 ?? null;
  const memoryBudget = declared?.memoryBytes ?? null;
  const packageBudget = declared?.packageBytes ?? null;

  if (frameBudget === null && memoryBudget === null && packageBudget === null) {
    reasons.push('部件没有声明任何预算，无法判定是否达标');
  }
  if (frameBudget !== null && samples.length === 0) {
    reasons.push('没有帧时间样本，帧预算保持未测量');
  }
  if (frameBudget !== null && p95 !== null && p95 > frameBudget) {
    reasons.push(`帧时间 p95 ${p95}ms 超过预算 ${frameBudget}ms`);
  }
  if (memoryBudget !== null && Number.isFinite(measured.memoryBytes) && measured.memoryBytes > memoryBudget) {
    reasons.push(`内存 ${measured.memoryBytes} 字节超过预算 ${memoryBudget} 字节`);
  }
  if (packageBudget !== null && Number.isFinite(measured.packageBytes) && measured.packageBytes > packageBudget) {
    reasons.push(`包体 ${measured.packageBytes} 字节超过预算 ${packageBudget} 字节`);
  }

  const hasComparison = (frameBudget !== null && samples.length > 0)
    || (memoryBudget !== null && Number.isFinite(measured.memoryBytes))
    || (packageBudget !== null && Number.isFinite(measured.packageBytes));
  const exceeded = reasons.some(reason => reason.includes('超过预算'));
  const status = !hasComparison ? 'unknown' : exceeded ? 'fail' : 'pass';

  return {
    format: PART_BUDGET_FORMAT,
    status,
    source,
    declared: { frameMsP95: frameBudget, memoryBytes: memoryBudget, packageBytes: packageBudget, measured: declared?.measured === true },
    measured: {
      samples: samples.length,
      p50, p95, max,
      memoryBytes: Number.isFinite(measured.memoryBytes) ? measured.memoryBytes : null,
      packageBytes: Number.isFinite(measured.packageBytes) ? measured.packageBytes : null,
    },
    headroomMs: frameBudget !== null && p95 !== null ? Number((frameBudget - p95).toFixed(3)) : null,
    reasons,
    summary: status === 'pass'
      ? `在 ${source} 证据下满足预算（p95 ${p95}ms / 预算 ${frameBudget}ms）`
      : status === 'fail'
        ? reasons.join('；')
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
