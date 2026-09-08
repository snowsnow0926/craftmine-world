import { evaluateAssertions } from './assertions.mjs';
import { REQUIREMENTS, requirementsHash } from './requirements.mjs';
import { traceDigest, validateTrace } from './trace.mjs';
import { mutateTrace } from './injection.mjs';
import { percentile } from './metrics.mjs';

// 裁判：只吃轨迹和冻结断言，输出通过 / 不通过。没有模型参与，因此同一份轨迹永远同一结论。
export const JUDGMENT_FORMAT = 'craftmine.judgment/1';
export const REDNESS_FORMAT = 'craftmine.redness/1';

export function judgeRequirement(requirement, trace, { hash = requirementsHash() } = {}) {
  if (!requirement?.assertions?.length) throw Error('这条需求没有断言，无法判定');
  validateTrace(trace);
  const report = evaluateAssertions(requirement.assertions, trace);
  return {
    format: JUDGMENT_FORMAT,
    requirement: requirement.id,
    index: requirement.index,
    said: requirement.said,
    scenario: requirement.scenario,
    passed: report.passed,
    skipped: report.skipped,
    assertions: report.results,
    summary: report.summary,
    trace: traceDigest(trace),
    requirementsHash: hash,
  };
}

export function judgeSet({ traces = {}, requirements = REQUIREMENTS, hash } = {}) {
  const items = requirements.map(requirement => {
    const trace = traces[requirement.id];
    if (!trace) return {
      format: JUDGMENT_FORMAT, requirement: requirement.id, index: requirement.index, said: requirement.said,
      passed: false, skipped: true, assertions: [], summary: '没有这条需求的轨迹，判为未通过', trace: null, requirementsHash: hash || requirementsHash(),
    };
    return judgeRequirement(requirement, trace, { hash });
  });
  const passed = items.filter(item => item.passed).length;
  return {
    format: JUDGMENT_FORMAT,
    requirements: items.length,
    passed,
    passRate: items.length ? Number((passed / items.length).toFixed(3)) : null,
    items,
    summary: `${passed} / ${items.length} 条需求通过`,
  };
}

// 断言有效性：每条需求声明的「故意写错的实现」都必须被打红。
export function verifyRedness({ traces = {}, requirements = REQUIREMENTS, mutate = mutateTrace } = {}) {
  const results = [];
  for (const requirement of requirements) {
    const trace = traces[requirement.id];
    if (!trace) { results.push({ requirement: requirement.id, mutation: null, passed: false, detail: '缺少基准轨迹，无法验证断言有效性' }); continue; }
    const base = judgeRequirement(requirement, trace);
    results.push({ requirement: requirement.id, mutation: '(基准)', passed: base.passed, detail: base.passed ? '正确实现通过' : `正确实现也没通过：${base.summary}` });
    for (const red of requirement.reds || []) {
      let outcome;
      try { outcome = judgeRequirement(requirement, mutate(trace, red.mutation)); }
      catch (error) { results.push({ requirement: requirement.id, mutation: red.mutation, passed: false, detail: '注入失败：' + error.message }); continue; }
      results.push({
        requirement: requirement.id, mutation: red.mutation, passed: !outcome.passed,
        detail: outcome.passed
          ? `坏实现（${red.note}）居然通过了，说明断言太松，不算数`
          : `坏实现被打红：${outcome.assertions.filter(assertion => !assertion.passed).map(assertion => assertion.id).join('、')}`,
      });
    }
  }
  const failed = results.filter(result => !result.passed);
  return {
    format: REDNESS_FORMAT,
    passed: failed.length === 0,
    checks: results.length,
    results,
    summary: failed.length ? `${failed.length} 项没有达到要求：${failed.map(result => `${result.requirement}/${result.mutation || '基准'}`).join('、')}` : `${results.length} 项断言有效性检查全部通过`,
  };
}

// 指标：只从判定记录派生，不另存一份，避免和真实记录不一致。
export function summarizeJudgments(records = []) {
  const ran = records.filter(record => record && record.requirement);
  const passed = ran.filter(record => record.passed);
  const durations = ran.map(record => record.durationMs).filter(Number.isFinite);
  const inputs = ran.map(record => record.inputTokens).filter(Number.isFinite);
  const outputs = ran.map(record => record.outputTokens).filter(Number.isFinite);
  const failureClasses = {};
  for (const record of ran) if (!record.passed && record.failureClass) failureClasses[record.failureClass] = (failureClasses[record.failureClass] || 0) + 1;
  return {
    format: 'craftmine.judgment-metrics/1',
    runs: ran.length,
    passed: passed.length,
    passRate: ran.length ? Number((passed.length / ran.length).toFixed(3)) : null,
    firstPassRate: ran.length ? Number((ran.filter(record => record.firstPass === true).length / ran.length).toFixed(3)) : null,
    repairedRate: ran.length ? Number((ran.filter(record => record.repaired === true).length / ran.length).toFixed(3)) : null,
    durationMs: { median: percentile(durations, 0.5), p90: percentile(durations, 0.9) },
    inputTokens: { median: percentile(inputs, 0.5), p90: percentile(inputs, 0.9) },
    outputTokens: { median: percentile(outputs, 0.5), p90: percentile(outputs, 0.9) },
    reviewFindings: ran.reduce((total, record) => total + (record.reviewFindings || 0), 0),
    failureClasses,
  };
}

// 可复现签名：只包含「谁通过、第几次通过、失败在哪一类」，不含耗时和 token，用于比对两次影子运行。
export function judgmentSignature(records = []) {
  return records
    .filter(record => record && record.requirement)
    .map(record => [record.requirement, record.passed ? 'pass' : 'fail', record.firstPass ? 'first' : 'retry', record.failureClass || '-'].join(':'))
    .sort()
    .join('|');
}

export function assertionInventory(requirements = REQUIREMENTS) {
  const items = requirements.flatMap(requirement => requirement.assertions.map(assertion => ({
    requirement: requirement.id, id: assertion.id, kind: assertion.kind, why: assertion.why, red: assertion.red,
  })));
  const byKind = {};
  for (const item of items) byKind[item.kind] = (byKind[item.kind] || 0) + 1;
  return { format: 'craftmine.assertion-inventory/1', total: items.length, byKind, items };
}
