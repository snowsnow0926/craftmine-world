// L3 candidate gate: decide whether a proposed low-level part is allowed to
// become real work.
//
// The plan's rule is "choose a small number of L3 extensions from actual
// high-frequency gaps", and the dispatch forbids rewriting the engine for
// show. This module turns that rule into a check: a candidate dossier is only
// `evidence-ready` when it carries a reproducible frozen input, at least one
// real evidence reference whose hash resolves, a measured current baseline, an
// explicit budget, a rollback path and a kill criterion. Anything less stays a
// hypothesis and must not be implemented.
import { BUDGET_SOURCES } from './budget.mjs';
import { PART_KINDS, isPlain, need } from './formats.mjs';
import { normalizeContentHash } from './content-ref.mjs';

export const L3_CANDIDATE_FORMAT = 'craftmine.godot-l3-candidate/1';
export const CANDIDATE_STATUSES = Object.freeze(['hypothesis', 'evidence-ready', 'implemented', 'rejected']);

function checkEvidence(evidence, resolveEvidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return { passed: false, detail: '没有证据引用' };
  const entries = evidence.map((item, index) => {
    if (!isPlain(item)) return { index, ok: false, detail: `evidence[${index}] 必须是对象` };
    const hash = normalizeContentHash(item.sha256);
    if (!hash) return { index, ok: false, detail: `evidence[${index}] 缺少可校验的 sha256` };
    if (typeof item.ref !== 'string' || item.ref.trim().length === 0) return { index, ok: false, detail: `evidence[${index}] 缺少 ref` };
    if (typeof item.quote !== 'string' || item.quote.trim().length === 0) return { index, ok: false, detail: `evidence[${index}] 缺少原始引文` };
    const resolution = typeof resolveEvidence === 'function' ? resolveEvidence({ ...item, sha256: hash }) : { ok: false, detail: '没有证据解析器' };
    return { index, ok: resolution.ok === true, detail: resolution.ok ? `${item.ref} 已按哈希确认` : resolution.detail || '证据无法确认' };
  });
  const failed = entries.filter(entry => !entry.ok);
  return { passed: failed.length === 0, entries, detail: failed.length ? failed.map(entry => entry.detail).join('；') : `${entries.length} 条证据均可确认` };
}

/**
 * @param {object} dossier  see docs/dispatch-reports/godot-remaining/J/J_L3_CANDIDATES.md
 * @param {object} options  { resolveEvidence(item) -> {ok, detail} }
 */
export function evaluateCandidate(dossier, { resolveEvidence = null } = {}) {
  const checks = [];
  const add = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });

  add('候选格式', isPlain(dossier) && dossier.format === L3_CANDIDATE_FORMAT, `format=${dossier?.format}`);
  add('候选 ID', typeof dossier?.candidateId === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(dossier.candidateId), `candidateId=${dossier?.candidateId}`);
  add('部件类型', PART_KINDS.includes(dossier?.partKind), `partKind=${dossier?.partKind}`);
  add('状态合法', CANDIDATE_STATUSES.includes(dossier?.status), `status=${dossier?.status}`);

  const problem = dossier?.problem;
  add('问题描述', isPlain(problem) && typeof problem.summary === 'string' && problem.summary.trim().length > 0 && Array.isArray(problem.affectedBases) && problem.affectedBases.length > 0,
    isPlain(problem) ? `影响底座 ${(problem.affectedBases || []).join('、')}` : '缺少 problem');

  const evidence = checkEvidence(dossier?.evidence, resolveEvidence);
  add('证据可确认', evidence.passed, evidence.detail);

  const frozen = dossier?.frozenInput;
  add('冻结输入', isPlain(frozen) && normalizeContentHash(frozen.inputHash) !== null && typeof frozen.reproduce === 'string' && frozen.reproduce.trim().length > 0,
    isPlain(frozen) ? `inputHash=${frozen.inputHash ? '已给出' : '缺失'}，复现命令=${frozen.reproduce ? '已给出' : '缺失'}` : '缺少 frozenInput');

  const baseline = dossier?.currentBaseline;
  const baselineOk = isPlain(baseline) && Number.isFinite(baseline.value) && BUDGET_SOURCES.includes(baseline.source);
  add('当前基线实测', baselineOk, isPlain(baseline)
    ? `metric=${baseline.metric} value=${baseline.value} source=${baseline.source}`
    : '缺少 currentBaseline（必须来自真实测量，不能填零）');

  const budget = dossier?.budget;
  const budgetOk = isPlain(budget) && ['frameMsP95', 'memoryBytes', 'packageBytes'].some(key => Number.isFinite(budget[key]));
  add('预算声明', budgetOk, isPlain(budget) ? '已声明预算' : '缺少 budget');

  const rollback = dossier?.rollback;
  add('回退方案', isPlain(rollback) && typeof rollback.strategy === 'string' && rollback.strategy.trim().length > 0,
    isPlain(rollback) ? `strategy=${rollback.strategy}` : '缺少 rollback');

  add('止损条件', typeof dossier?.killCriterion === 'string' && dossier.killCriterion.trim().length > 0, '没有止损条件就不能开工');
  add('下一步入口', typeof dossier?.nextStep === 'string' && dossier.nextStep.trim().length > 0, '缺少 nextStep');

  const failed = checks.filter(item => !item.passed);
  const ready = failed.length === 0 && dossier?.status !== 'rejected';
  return {
    format: L3_CANDIDATE_FORMAT,
    candidateId: dossier?.candidateId ?? null,
    status: ready ? 'evidence-ready' : dossier?.status === 'rejected' ? 'rejected' : 'not-ready',
    checks,
    summary: ready
      ? '候选材料齐全，可以在 GD7 基线与冻结评测就绪后开工'
      : `还不能开工：${failed.map(item => `${item.name}（${item.detail}）`).join('；')}`,
  };
}

export function assertCandidateReady(dossier, options) {
  const report = evaluateCandidate(dossier, options);
  need(report.status === 'evidence-ready', report.summary);
  return report;
}
