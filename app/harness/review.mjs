import { validateAssertion, assertionGuide } from './assertions.mjs';

// 对抗评审者：独立找实现的问题，但**只能输出可执行的断言**，不能输出「我觉得不行」。
// 它的价值在于把人类没想到的角度变成机器能复核的检查；判决权仍在确定性执行器。
export const REVIEW_FORMAT = 'craftmine.review/1';
export const REVIEW_SEVERITIES = Object.freeze(['blocker', 'major', 'minor']);

export function reviewPrompt({ said, acceptance = '', artifact = '', evidence = '', catalog = '' }) {
  return [
    '你是独立评审者。你看不到实现者的推理过程，也不接受任何口头解释；你只能看需求、产物和运行证据。',
    `需求原话：「${said}」`,
    acceptance ? `验收要点：${acceptance}` : null,
    '',
    '产物（场景改动或玩法源码）：',
    '```',
    String(artifact).slice(0, 12000),
    '```',
    '',
    '运行证据（真实引擎跑出来的轨迹摘要）：',
    '```',
    String(evidence).slice(0, 8000),
    '```',
    '',
    assertionGuide(),
    '',
    '输出要求：只输出 JSON 对象 {"findings":[{"claim":"一句话说明问题","severity":"blocker|major|minor","assertion":{...}}]}。',
    '- 每条 finding 必须带一条可执行断言；缺断言的评审会被整份拒绝。',
    '- 断言必须是「机器跑一遍就有客观结论」的检查，不能是主观判断。',
    '- 优先找：需求里写了但没人检查的情况、能骗过现有断言的错误实现、边界与重复操作。',
    catalog ? `\n宿主能力（超出这些的实现一定跑不起来）：\n${catalog}` : null,
  ].filter(line => line !== null).join('\n');
}

const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);

export function parseFindings(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw Error('评审没有返回 JSON 对象');
    try { value = JSON.parse(raw.slice(start, end + 1)); } catch (error) { throw Error('评审返回的不是有效 JSON：' + error.message); }
  }
  if (!isPlain(value) || !Array.isArray(value.findings)) throw Error('评审返回缺少 findings 数组');
  if (value.findings.length > 20) throw Error('评审发现太多：最多 20 条');
  const findings = [];
  for (const [index, finding] of value.findings.entries()) {
    if (!isPlain(finding)) throw Error(`第 ${index + 1} 条发现不是对象`);
    if (typeof finding.claim !== 'string' || !finding.claim.trim() || finding.claim.length > 400) throw Error(`第 ${index + 1} 条发现缺少说明`);
    if (!REVIEW_SEVERITIES.includes(finding.severity)) throw Error(`第 ${index + 1} 条发现的严重程度无效`);
    if (!isPlain(finding.assertion)) throw Error(`第 ${index + 1} 条发现没有带可执行断言：评审只能提意见，意见必须能被机器复核`);
    validateAssertion(finding.assertion);
    findings.push({ claim: finding.claim.trim(), severity: finding.severity, assertion: finding.assertion });
  }
  return findings;
}

export function findingsToAssertions(findings = []) {
  const seen = new Set();
  const assertions = [];
  for (const finding of findings) {
    const assertion = finding.assertion;
    if (!assertion || seen.has(assertion.id)) continue;
    seen.add(assertion.id);
    assertions.push({ ...assertion, fromReview: finding.claim, severity: finding.severity });
  }
  return assertions;
}

export function reviewSummary(findings = []) {
  const counts = { blocker: 0, major: 0, minor: 0 };
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  return {
    format: REVIEW_FORMAT,
    total: findings.length,
    counts,
    blocked: counts.blocker > 0,
    assertions: findingsToAssertions(findings).length,
    summary: findings.length
      ? `评审提出 ${findings.length} 条问题（阻断 ${counts.blocker}、重要 ${counts.major}、次要 ${counts.minor}），全部已转成可执行断言`
      : '评审没有提出带断言的问题',
  };
}
