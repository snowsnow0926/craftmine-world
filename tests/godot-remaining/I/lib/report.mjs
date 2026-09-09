// Report builder for task I. A report must never turn "not run" into "passed":
// the headline numbers are always paired with the per-round verdicts and the
// per-story ledger, and blocked rounds are listed with the command to run later.
import fs from 'node:fs';
import path from 'node:path';

export const REPORT_FORMAT = 'craftmine.i.report/1';

export function buildReport({ mode, identity, freeze, rounds, ledger, metrics = {}, generatedAt = new Date().toISOString(), notes = [] }) {
  const verdictCounts = rounds.reduce((acc, round) => ({ ...acc, [round.verdict]: (acc[round.verdict] ?? 0) + 1 }), {});
  const hardFailures = rounds.flatMap(round => (round.failures ?? []).map(failure => ({ round: round.id, ...failure })));
  const pending = rounds.filter(round => round.verdict === 'not-run' || round.verdict === 'blocked').map(round => ({ id: round.id, category: round.categoryId, blockedBy: round.blockedBy ?? [], command: round.command ?? null }));
  return {
    format: REPORT_FORMAT,
    generatedAt,
    mode,
    identity,
    freeze: { ok: freeze.ok, reason: freeze.reason, lockedAt: freeze.lockedAt ?? null, mismatched: freeze.mismatched, missing: freeze.missing, changedSources: freeze.changedSources },
    headline: {
      rounds: rounds.length,
      passed: verdictCounts.passed ?? 0,
      failed: verdictCounts.failed ?? 0,
      insufficient: verdictCounts.insufficient ?? 0,
      notRun: (verdictCounts['not-run'] ?? 0) + (verdictCounts.blocked ?? 0),
      modelCalls: metrics.modelCalls ?? 0,
      unknownUsageCalls: metrics.unknownUsageCalls ?? 0,
      humanInterventions: metrics.humanInterventions ?? 0,
      verifiedStories: Object.values(ledger.items).filter(item => item.status === '已证实').length,
      failedStories: Object.values(ledger.items).filter(item => item.status === '失败').length,
      notRunStories: Object.values(ledger.items).filter(item => item.status === '尚未执行').length,
      insufficientStories: Object.values(ledger.items).filter(item => item.status === '证据不足').length,
    },
    rounds: rounds.map(round => ({
      id: round.id,
      categoryId: round.categoryId,
      phase: round.phase,
      verdict: round.verdict,
      reasons: round.reasons ?? [],
      evidenceDir: round.evidenceDir ?? null,
      assertions: round.assertions ?? [],
      failures: round.failures ?? [],
      blockedBy: round.blockedBy ?? [],
      command: round.command ?? null,
    })),
    hardFailures,
    pending,
    metrics,
    ledger: Object.values(ledger.items),
    notes,
  };
}

export function reportMarkdown(report) {
  if (report.refused) {
    return `# 真实模型验收报告（任务 I）\n\n- 生成时间：${report.generatedAt}\n- 模式：${report.mode}\n- 结果：拒绝执行\n\n## 原因\n\n${report.reasons.map(reason => `- ${reason}`).join('\n')}\n`;
  }
  const { headline: h } = report;
  const lines = [
    '# 真实模型验收报告（任务 I）',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 模式：${report.mode}`,
    `- 冻结校验：${report.freeze.ok ? '通过' : '失败'}（${report.freeze.reason}）`,
    `- 身份摘要：product=${report.identity?.product?.version ?? 'unknown'} engine=${report.identity?.engine?.version ?? 'unknown'} base=${report.identity?.base?.version ?? 'unknown'} model=${report.identity?.model?.modelId ?? 'unknown'}`,
    '',
    '## 汇总（不得只看通过数）',
    '',
    `- 轮次：${h.rounds}，通过 ${h.passed}，失败 ${h.failed}，证据不足 ${h.insufficient}，尚未执行 ${h.notRun}`,
    `- 真实模型调用：${h.modelCalls}；用量未知调用：${h.unknownUsageCalls}`,
    `- 人工介入：${h.humanInterventions}`,
    `- 故事台账：已证实 ${h.verifiedStories}，失败 ${h.failedStories}，尚未执行 ${h.notRunStories}，证据不足 ${h.insufficientStories}`,
    '',
    '## 逐轮结果',
    '',
    '| 轮次 | 类别 | 判定 | 原因 | 证据 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const round of report.rounds) lines.push(`| ${round.id} | ${round.categoryId} | ${round.verdict} | ${(round.reasons ?? []).join('; ')} | ${round.evidenceDir ?? '—'} |`);
  if (report.hardFailures.length) {
    lines.push('', '## 硬失败（不能被其他通过抵消）', '');
    for (const failure of report.hardFailures) lines.push(`- ${failure.round} · ${failure.class}: ${failure.message}`);
  }
  if (report.pending.length) {
    lines.push('', '## 尚未执行 / 被依赖阻断', '');
    for (const item of report.pending) lines.push(`- ${item.id}（依赖：${(item.blockedBy ?? []).join(', ') || '未接通'}）${item.command ? ` → \`${item.command}\`` : ''}`);
  }
  lines.push('', '## 台账', '', '| 编号 | 状态 | 关联轮次 | 原因 |', '| --- | --- | --- | --- |');
  for (const item of report.ledger) lines.push(`| ${item.id} | ${item.status} | ${(item.rounds ?? []).join(' ') || '—'} | ${item.reason ?? ''} |`);
  if (report.notes.length) lines.push('', '## 备注', '', ...report.notes.map(note => `- ${note}`));
  return `${lines.join('\n')}\n`;
}

export function writeReport(dir, report) {
  fs.mkdirSync(dir, { recursive: true });
  const json = path.join(dir, 'report.json');
  const md = path.join(dir, 'report.md');
  fs.writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(md, reportMarkdown(report));
  return { json, md };
}
