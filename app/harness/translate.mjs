import { createHash } from 'node:crypto';
import { canonicalJSON } from '../canonical.mjs';
import { ASSERTION_KINDS, assertionGuide, evaluateAssertions, validateAssertion } from './assertions.mjs';
import { mutateTrace } from './injection.mjs';

// 测试翻译官：把玩家的一句话翻译成机器能跑的断言。
// 关键约束——它只能「提意见」，产出物必须能被机器复核（哈希 + 红性检查），不能自己下判决。
export const TRANSLATION_FORMAT = 'craftmine.assertion-set/1';

export function translationPrompt({ said, shape = '', acceptance = '', scenario = '', catalog = '' }) {
  return [
    '你把玩家的需求翻译成可执行的验收断言。你不是裁判，只能提意见：产出物会被确定性执行器跑一遍，并被「故意写错的实现」检验。',
    `需求原话：「${said}」`,
    shape ? `需求形状：${shape}` : null,
    acceptance ? `人写的验收要点（可能不完整）：${acceptance}` : null,
    scenario ? `测试场景（世界与事件序列）：${scenario}` : null,
    '',
    assertionGuide(),
    '',
    '输出要求：只输出 JSON 对象 {"assertions":[...]}，不要任何解释。',
    '- 每条断言必须有 id（形如 需求号.短名）、kind、why（在检查什么玩家能看见的事实）、red（哪种错误实现会打红它）。',
    '- 至少 2 条；必须包含至少一条检查「世界真的变了」的断言，不能只有 noErrors。',
    '- 只检查玩家能看见的事实：位置、可见、模型、血量、背包、资源、面板、命令字段。不要检查代码长什么样、不要检查日志文字。',
    '- 不要把「实现了就行」当断言；每条都要能被一个故意写错的实现打红。',
    catalog ? `\n当前宿主能力（只能用这些）：\n${catalog}` : null,
  ].filter(line => line !== null).join('\n');
}

const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);

export function parseAssertions(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw Error('模型没有返回 JSON 对象');
    try { value = JSON.parse(raw.slice(start, end + 1)); } catch (error) { throw Error('模型返回的不是有效 JSON：' + error.message); }
  }
  if (!isPlain(value) || !Array.isArray(value.assertions)) throw Error('模型返回缺少 assertions 数组');
  if (value.assertions.length < 2) throw Error('断言太少：至少需要 2 条');
  if (value.assertions.length > 40) throw Error('断言太多：最多 40 条');
  const seen = new Set(), parsed = [];
  for (const assertion of value.assertions) {
    validateAssertion(assertion);
    if (seen.has(assertion.id)) throw Error(`断言 id 重复：${assertion.id}`);
    seen.add(assertion.id);
    if (!ASSERTION_KINDS.includes(assertion.kind)) throw Error(`不支持的断言类型：${assertion.kind}`);
    parsed.push(assertion);
  }
  if (parsed.every(assertion => assertion.kind === 'noErrors')) throw Error('只有 noErrors：必须至少有一条检查世界真的变了');
  return parsed;
}

// 红性检查：这些断言必须能被某个「故意写错的实现」打红，否则太松。
export function assertionRedness(assertions, trace, mutations = ['noop', 'dropCommands']) {
  const baseline = evaluateAssertions(assertions, trace);
  const results = [];
  for (const name of mutations) {
    let outcome;
    try { outcome = evaluateAssertions(assertions, mutateTrace(trace, name)); }
    catch (error) { results.push({ mutation: name, passed: false, detail: '注入失败：' + error.message }); continue; }
    results.push({
      mutation: name, passed: !outcome.passed,
      detail: outcome.passed ? `断言太松：对「${name}」这种错误实现仍然通过` : `被打红：${outcome.results.filter(item => !item.passed).map(item => item.id).join('、')}`,
    });
  }
  return { format: 'craftmine.assertion-redness/1', baseline, passed: results.every(result => result.passed), results };
}

export function freezeAssertionSet({ requirement, assertions, reviewedBy, trace }) {
  if (!requirement) throw Error('冻结断言需要需求');
  if (!reviewedBy) throw Error('断言冻结前必须有人审一次，并记录审阅人');
  const parsed = parseAssertions({ assertions });
  const redness = trace ? assertionRedness(parsed, trace) : null;
  if (redness && !redness.passed) throw Error('断言太松，不能冻结：' + redness.results.filter(result => !result.passed).map(result => result.detail).join('；'));
  const body = { format: TRANSLATION_FORMAT, requirement: requirement.id || requirement, reviewedBy, assertions: parsed };
  return { ...body, hash: createHash('sha256').update(canonicalJSON(body)).digest('hex') };
}

export function verifyFrozenAssertionSet(set) {
  const body = { format: set.format, requirement: set.requirement, reviewedBy: set.reviewedBy, assertions: set.assertions };
  const actual = createHash('sha256').update(canonicalJSON(body)).digest('hex');
  if (actual !== set.hash) throw Error(`冻结断言被改动过：期望 ${set.hash}，实际 ${actual}`);
  return actual;
}
