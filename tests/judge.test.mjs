import test from 'node:test';
import assert from 'node:assert/strict';
import { observableChange, worldSnapshot } from '../app/harness/acceptance.mjs';
import { buildTrace } from '../app/harness/trace.mjs';
import { ASSERTION_KINDS, evaluateAssertions, validateAssertion } from '../app/harness/assertions.mjs';
import { REQUIREMENTS, requirementsHash, assertFrozenIntegrity } from '../app/harness/requirements.mjs';
import { judgeRequirement, judgeSet, verifyRedness, summarizeJudgments, judgmentSignature, assertionInventory } from '../app/harness/judge.mjs';
import { MUTATION_NAMES, mutateTrace } from '../app/harness/injection.mjs';
import { assertionRedness, freezeAssertionSet, parseAssertions, translationPrompt, verifyFrozenAssertionSet } from '../app/harness/translate.mjs';
import { findingsToAssertions, parseFindings, reviewPrompt, reviewSummary } from '../app/harness/review.mjs';

const snap = ({ health = 100, resources = {}, objects = [], inventory = {}, items = {}, panels = {} } = {}) =>
  worldSnapshot({ playerHealth: health, resources, objects, inventory, items, panels });
const obj = (id, { x = 0, y = 6, z = 0, visible = true, mesh = true, health = 0, solid = true, color = '#ffffff' } = {}) =>
  ({ id, position: { x, y, z }, visible, mesh, health, solid, color });
const step = (label, event, before, after, { commands = [], effects = [] } = {}) =>
  ({ label, event, player: { x: 0, y: 6, z: 20 }, commands, effects, before, after, change: observableChange(before, after), error: null });
const trace = (requirement, start, steps) => buildTrace({ requirement, start, steps, final: steps[steps.length - 1].after });
const at = (objects, id, patch) => objects.map(object => object.id === id ? { ...object, ...patch } : object);

// 每条需求一份「正确实现」的轨迹。轨迹是判定的唯一输入，因此这里就是「什么算对」的具体形状。
const TRACES = {};

TRACES['r01-plant-three-trees'] = (() => {
  const start = snap({ objects: [obj('rock-1', { x: 12, z: 12 })] });
  const planted = [...start.objects, obj('tree-a', { x: -2, z: 14 }), obj('tree-b', { x: 0, z: 15 }), obj('tree-c', { x: 2, z: 14 })];
  const steps = [step('start', { type: 'start', targetId: null }, start, start), step('idle', { type: 'tick', targetId: null }, start, snap({ objects: planted }))];
  return trace('r01-plant-three-trees', start, steps);
})();

TRACES['r02-taller-tree'] = (() => {
  const start = snap({ objects: [obj('tree-1', { x: -6, z: 6 }), obj('tree-1-crown', { x: -6, y: 9, z: 6, solid: false }), obj('tree-2', { x: 6, z: 6 })] });
  const raised = at(start.objects, 'tree-1-crown', { position: { x: -6, y: 11, z: 6 } });
  return trace('r02-taller-tree', start, [step('start', { type: 'start', targetId: null }, start, start), step('idle', { type: 'tick', targetId: null }, start, snap({ objects: raised }))]);
})();

TRACES['r03-door-costs-wood'] = (() => {
  const start = snap({ objects: [obj('door-1', { x: 2, z: 8 }), obj('door-2', { x: -2, z: 8 })], inventory: { wood: 1 } });
  const opened = snap({ objects: at(start.objects, 'door-1', { visible: false, mesh: false }), inventory: {} });
  const refused = opened;
  return trace('r03-door-costs-wood', start, [
    step('start', { type: 'start', targetId: null }, start, start),
    step('idle', { type: 'tick', targetId: null }, start, start),
    step('open-1', { type: 'interact', targetId: 'door-1' }, start, opened, { commands: [{ type: 'object.patch', id: 'door-1', visible: false }, { type: 'inventory.add', item: 'wood', count: -1 }] }),
    step('open-2', { type: 'interact', targetId: 'door-2' }, opened, refused, { commands: [{ type: 'hud.message', text: '木头不够' }] }),
  ]);
})();

TRACES['r04-chop-tree-drop-wood'] = (() => {
  const start = snap({ objects: [obj('tree-1', { z: 8 })] });
  const chopped = snap({ objects: at(start.objects, 'tree-1', { visible: false, mesh: false }), inventory: { wood: 3 } });
  return trace('r04-chop-tree-drop-wood', start, [
    step('start', { type: 'start', targetId: null }, start, start),
    step('idle', { type: 'tick', targetId: null }, start, start),
    step('hit-1', { type: 'attack', targetId: 'tree-1' }, start, chopped, { commands: [{ type: 'inventory.add', item: 'wood', count: 3 }, { type: 'object.patch', id: 'tree-1', visible: false }] }),
    step('hit-2', { type: 'attack', targetId: 'tree-1' }, chopped, chopped, { commands: [{ type: 'hud.message', text: '树已经倒了' }] }),
  ]);
})();

TRACES['r05-craft-door-from-three-wood'] = (() => {
  const hidden = snap({ objects: [obj('door-3', { x: 2, z: 8, visible: false, mesh: false }), obj('door-4', { x: -2, z: 8, visible: false, mesh: false })], inventory: { wood: 3 } });
  const crafted = snap({ objects: at(hidden.objects, 'door-3', { visible: true, mesh: true }), inventory: {} });
  return trace('r05-craft-door-from-three-wood', hidden, [
    step('start', { type: 'start', targetId: null }, hidden, hidden),
    step('idle', { type: 'tick', targetId: null }, hidden, hidden),
    step('craft-1', { type: 'key', targetId: null, code: 'KeyB' }, hidden, crafted, { commands: [{ type: 'inventory.add', item: 'wood', count: -3 }, { type: 'object.patch', id: 'door-3', visible: true }] }),
    step('craft-2', { type: 'key', targetId: null, code: 'KeyB' }, crafted, crafted, { commands: [{ type: 'hud.message', text: '木头不够' }] }),
    step('craft-3', { type: 'key', targetId: null, code: 'KeyB' }, crafted, crafted, { commands: [{ type: 'hud.message', text: '木头不够' }] }),
    step('restore', { type: 'restore', targetId: null }, crafted, crafted),
  ]);
})();

TRACES['r06-revive-monsters'] = (() => {
  const dead = snap({ objects: [obj('zombie-1', { x: 2, z: 8, visible: false, mesh: false, health: 0 }), obj('zombie-2', { x: -2, z: 8, visible: false, mesh: false, health: 0 })] });
  const alive = snap({ objects: [obj('zombie-1', { x: 2, z: 8, health: 40 }), obj('zombie-2', { x: -2, z: 8, health: 40 })] });
  return trace('r06-revive-monsters', dead, [
    step('start', { type: 'start', targetId: null }, dead, dead),
    step('idle', { type: 'tick', targetId: null }, dead, dead),
    step('revive', { type: 'key', targetId: null, code: 'KeyG' }, dead, alive, { commands: [{ type: 'target.revive', id: 'zombie-1' }, { type: 'target.revive', id: 'zombie-2' }] }),
  ]);
})();

TRACES['r07-stamina-bar'] = (() => {
  const start = snap({ resources: { 'system-stamina': { value: 100, max: 100 } } });
  const ran = snap({ resources: { 'system-stamina': { value: 96, max: 100 } } });
  const rested = snap({ resources: { 'system-stamina': { value: 99, max: 100 } } });
  return trace('r07-stamina-bar', start, [
    step('start', { type: 'start', targetId: null }, start, start),
    step('idle-1', { type: 'tick', targetId: null }, start, start),
    step('run-1', { type: 'tick', targetId: null }, start, ran, { commands: [{ type: 'resource.add', id: 'system-stamina', amount: -4 }] }),
    step('rest-1', { type: 'tick', targetId: null }, ran, rested, { commands: [{ type: 'resource.add', id: 'system-stamina', amount: 3 }] }),
  ]);
})();

TRACES['r08-monster-ai'] = (() => {
  const start = snap({ objects: [obj('melee-1', { z: 20, health: 40 }), obj('ranged-1', { z: 40, health: 40 })] });
  const closed = snap({ health: 90, objects: [obj('melee-1', { z: 22, health: 40 }), obj('ranged-1', { z: 36, health: 40 })] });
  return trace('r08-monster-ai', start, [
    step('start', { type: 'start', targetId: null }, start, start),
    step('idle', { type: 'tick', targetId: null }, start, start),
    ...['tick-1', 'tick-2', 'tick-3', 'tick-4'].map((label, index) => step(label, { type: 'tick', targetId: null }, index === 0 ? start : closed, closed, { commands: [{ type: 'object.patch', id: 'melee-1', position: { x: 0, y: 6, z: 22 } }] })),
  ]);
})();

TRACES['r09-hit-feedback'] = (() => {
  const base = { x: 0, y: 6, z: 10, health: 0 };
  const start = snap({ objects: [obj('zombie-1', { ...base, color: '#7d9b63' })] });
  const flashed = snap({ objects: [obj('zombie-1', { ...base, z: 11, color: '#ff4444' })] });
  const knocked = snap({ objects: [obj('zombie-1', { ...base, z: 12, color: '#7d9b63' })] });
  const dead = snap({ objects: [obj('zombie-1', { ...base, z: 12, visible: false, mesh: false })] });
  return trace('r09-hit-feedback', start, [
    step('start', { type: 'start', targetId: null }, start, start),
    step('idle', { type: 'tick', targetId: null }, start, start),
    step('hit-1', { type: 'attack', targetId: 'zombie-1' }, start, flashed, { commands: [{ type: 'object.patch', id: 'zombie-1', color: '#ff4444', position: { x: 0, y: 6, z: 11 }, duration: .15 }, { type: 'audio.play', sound: 'hit' }] }),
    step('hit-2', { type: 'attack', targetId: 'zombie-1' }, flashed, knocked, { commands: [{ type: 'object.patch', id: 'zombie-1', color: '#7d9b63', position: { x: 0, y: 6, z: 12 }, duration: .15 }] }),
    step('hit-3', { type: 'attack', targetId: 'zombie-1' }, knocked, dead, { commands: [{ type: 'object.patch', id: 'zombie-1', visible: false }] }),
  ]);
})();

TRACES['r10-shop-panel'] = (() => {
  const panel = lines => ({ 'shop-mod:shop': { title: '商店', lines } });
  const start = snap({ inventory: { wood: 5 }, panels: panel(['木头 5', '血瓶 0', '按 C 用 2 木头换 1 血瓶']) });
  const once = snap({ inventory: { wood: 3, potion: 1 }, panels: panel(['木头 3', '血瓶 1', '按 C 用 2 木头换 1 血瓶']) });
  const twice = snap({ inventory: { wood: 1, potion: 2 }, panels: panel(['木头 1', '血瓶 2', '按 C 用 2 木头换 1 血瓶']) });
  return trace('r10-shop-panel', start, [
    step('start', { type: 'start', targetId: null }, start, start),
    step('idle', { type: 'tick', targetId: null }, start, start),
    step('buy-1', { type: 'key', targetId: null, code: 'KeyC' }, start, once, { commands: [{ type: 'inventory.add', item: 'wood', count: -2 }, { type: 'inventory.add', item: 'potion', count: 1 }, { type: 'hud.panel', key: 'shop', panel: { title: '商店', lines: ['木头 3', '血瓶 1'] } }] }),
    step('buy-2', { type: 'key', targetId: null, code: 'KeyC' }, once, twice, { commands: [{ type: 'inventory.add', item: 'wood', count: -2 }, { type: 'inventory.add', item: 'potion', count: 1 }] }),
    step('buy-3', { type: 'key', targetId: null, code: 'KeyC' }, twice, twice, { commands: [{ type: 'hud.message', text: '木头不够' }] }),
  ]);
})();

test('冻结需求集：10 条需求，每条都有原话、形状和可执行断言', () => {
  assert.equal(REQUIREMENTS.length, 10);
  assert.equal(assertFrozenIntegrity(), requirementsHash());
  for (const requirement of REQUIREMENTS) {
    assert.ok(requirement.said.length > 0, requirement.id);
    assert.ok(requirement.shape.length > 0, requirement.id);
    assert.ok(requirement.assertions.length >= 2, requirement.id);
    assert.ok((requirement.reds || []).length >= 1, requirement.id);
    for (const assertion of requirement.assertions) {
      validateAssertion(assertion);
      assert.ok(ASSERTION_KINDS.includes(assertion.kind));
      assert.ok(assertion.why.length > 4 && assertion.red.length > 4, assertion.id);
      assert.match(assertion.id, new RegExp('^' + requirement.id.slice(0, 3)));
    }
  }
  const inventory = assertionInventory();
  assert.equal(inventory.total, REQUIREMENTS.reduce((total, requirement) => total + requirement.assertions.length, 0));
  assert.ok(inventory.total >= 50);
});

test('冻结需求集被改动时哈希会变，实现者偷改断言必须被发现', () => {
  const tampered = REQUIREMENTS.map((requirement, index) => index === 0
    ? { ...requirement, assertions: [{ ...requirement.assertions[0], kind: 'noErrors', why: '随便写的', red: '随便写的' }] }
    : requirement);
  assert.notEqual(requirementsHash(tampered), requirementsHash());
  assert.throws(() => assertFrozenIntegrity(requirementsHash(tampered)), /被改动过/);
});

test('正确实现的轨迹：10 条需求全部通过，且没有断言被跳过', () => {
  for (const requirement of REQUIREMENTS) {
    const report = judgeRequirement(requirement, TRACES[requirement.id]);
    assert.equal(report.passed, true, `${requirement.id}：${report.summary}`);
    assert.equal(report.skipped, false);
    assert.equal(report.assertions.length, requirement.assertions.length);
  }
  const set = judgeSet({ traces: TRACES });
  assert.equal(set.passed, 10);
  assert.equal(set.passRate, 1);
});

test('每条需求都有一个「故意写错的实现」能把它打红，否则断言不算数', () => {
  const redness = verifyRedness({ traces: TRACES });
  assert.equal(redness.passed, true, redness.summary);
  assert.ok(redness.checks >= REQUIREMENTS.length * 2);
  for (const result of redness.results) assert.equal(result.passed, true, `${result.requirement}/${result.mutation}：${result.detail}`);
});

test('历史 bug 回归：命令有效但世界没变（刷新怪物）必须判失败', () => {
  const requirement = REQUIREMENTS.find(item => item.id === 'r06-revive-monsters');
  const frozen = verifyRedness({ traces: { 'r06-revive-monsters': TRACES['r06-revive-monsters'] }, requirements: [requirement] });
  const noop = frozen.results.find(result => result.mutation === 'noop');
  assert.equal(noop.passed, true);
  assert.match(noop.detail, /被打红/);
  const broken = judgeRequirement(requirement, { ...TRACES['r06-revive-monsters'] });
  assert.equal(broken.passed, true);
});

test('注入器本身：每种注入都能真的改坏某条轨迹，未知名报错', () => {
  for (const name of MUTATION_NAMES) {
    const changedSome = REQUIREMENTS.some(requirement => JSON.stringify(mutateTrace(TRACES[requirement.id], name)) !== JSON.stringify(TRACES[requirement.id]));
    assert.equal(changedSome, true, `${name} 没有改变任何轨迹`);
  }
  assert.notEqual(JSON.stringify(mutateTrace(TRACES['r03-door-costs-wood'], 'repeatCost')), JSON.stringify(TRACES['r03-door-costs-wood']));
  assert.notEqual(JSON.stringify(mutateTrace(TRACES['r09-hit-feedback'], 'teleport')), JSON.stringify(TRACES['r09-hit-feedback']));
  assert.throws(() => mutateTrace(TRACES['r03-door-costs-wood'], '乱写的'), /没有名为/);
  const missing = judgeSet({ traces: { 'r03-door-costs-wood': TRACES['r03-door-costs-wood'] }, requirements: REQUIREMENTS.slice(0, 2) });
  assert.equal(missing.items[1].passed, false);
  assert.match(missing.items[1].summary, /没有这条需求的轨迹/);
});

test('断言 DSL 拒绝未知类型和缺 why/red 的断言', () => {
  assert.throws(() => validateAssertion({ id: 'x', kind: '感觉不对', why: '看着不对', red: '错就红' }), /不支持的断言类型/);
  assert.throws(() => validateAssertion({ id: 'x', kind: 'noErrors', red: '错就红' }), /why/);
  assert.throws(() => validateAssertion({ id: 'x', kind: 'noErrors', why: '检查', red: '' }), /red/);
  assert.throws(() => validateAssertion({ id: 'x', kind: 'objectField', why: '检查', red: '错就红', object: 'a', field: 'position' }), /value/);
  assert.throws(() => validateAssertion({ id: 'x', kind: 'newObjects', why: '检查', red: '错就红', min: 0 }), /min/);
  const report = evaluateAssertions([{ id: 'bad', kind: 'noErrors', why: '检查', red: '错就红', extra: 1 }], TRACES['r01-plant-three-trees']);
  assert.equal(report.passed, false);
  assert.match(report.results[0].detail, /不支持的字段/);
  assert.equal(evaluateAssertions([], {}).skipped, true);
});

test('指标与影子运行签名：同一批判定给出同一签名，耗时和 token 不参与', () => {
  const records = REQUIREMENTS.map((requirement, index) => ({
    requirement: requirement.id, passed: index < 8, firstPass: index < 8, repaired: index === 8,
    failureClass: index < 8 ? null : 'assertion', durationMs: 1000 + index * 100,
    inputTokens: 500 + index, outputTokens: 100 + index, reviewFindings: index === 0 ? 2 : 0,
  }));
  const metrics = summarizeJudgments(records);
  assert.equal(metrics.runs, 10);
  assert.equal(metrics.passed, 8);
  assert.equal(metrics.passRate, 0.8);
  assert.equal(metrics.firstPassRate, 0.8);
  assert.equal(metrics.repairedRate, 0.1);
  assert.equal(metrics.reviewFindings, 2);
  assert.deepEqual(metrics.failureClasses, { assertion: 2 });
  assert.ok(metrics.durationMs.median >= 1000 && metrics.durationMs.p90 >= metrics.durationMs.median);
  const signature = judgmentSignature(records);
  const shuffled = [...records].reverse().map(record => ({ ...record, durationMs: 9, outputTokens: 9 }));
  assert.equal(judgmentSignature(shuffled), signature);
  const changed = records.map((record, index) => index === 0 ? { ...record, passed: false } : record);
  assert.notEqual(judgmentSignature(changed), signature);
  assert.equal(summarizeJudgments([]).passRate, null);
});

// —— 需求 → 断言翻译 与 对抗评审 ——
const TRANSLATION_CASES = {
  good: { assertions: [
    { id: 'r03.charges-wood', kind: 'inventoryDelta', why: '开门要扣一块木头', red: '开门不扣料的实现', item: 'wood', delta: -1, step: 'open-1' },
    { id: 'r03.door-opens', kind: 'objectField', why: '门要真的打开', red: '扣了料不开门的实现', object: 'door-1', field: 'visible', value: false, step: 'open-1' },
  ] },
  onlyErrors: { assertions: [{ id: 'r03.no-errors', kind: 'noErrors', why: '不能崩', red: '抛错的实现' }, { id: 'r03.no-errors-2', kind: 'noErrors', why: '不能崩', red: '抛错的实现' }] },
  duplicate: { assertions: [
    { id: 'r03.a', kind: 'noErrors', why: '不能崩', red: '抛错的实现' },
    { id: 'r03.a', kind: 'noErrors', why: '不能崩', red: '抛错的实现' },
  ] },
};

test('翻译提示词把需求原话和断言清单一起给模型，模型只能在这套 DSL 里选', () => {
  const prompt = translationPrompt({ said: '开门要消耗一块木头', shape: '条件 + 扣料', acceptance: '不足不开', scenario: '两扇木门' });
  assert.match(prompt, /开门要消耗一块木头/);
  assert.match(prompt, /noErrors/);
  assert.match(prompt, /stepCommandField/);
  assert.match(prompt, /不要检查代码长什么样/);
});

test('翻译输出必须成组通过校验：至少两条、要有世界变化、id 不重复', () => {
  assert.equal(parseAssertions(TRANSLATION_CASES.good).length, 2);
  assert.equal(parseAssertions(JSON.stringify(TRANSLATION_CASES.good)).length, 2);
  assert.throws(() => parseAssertions(TRANSLATION_CASES.onlyErrors), /只有 noErrors/);
  assert.throws(() => parseAssertions(TRANSLATION_CASES.duplicate), /id 重复/);
  assert.throws(() => parseAssertions({ assertions: [] }), /断言太少/);
  assert.throws(() => parseAssertions('我觉得没问题'), /没有返回 JSON/);
  assert.throws(() => parseAssertions({ assertions: [{ id: 'x', kind: '感觉对', why: '看着对', red: '不对就红' }, { id: 'y', kind: 'noErrors', why: '不能崩', red: '抛错的实现' }] }), /不支持的断言类型/);
});

test('断言太松会被红性检查挡住，不能冻结', () => {
  const trace = TRACES['r03-door-costs-wood'];
  const loose = [{ id: 'r03.no-errors', kind: 'noErrors', why: '不能崩', red: '抛错的实现' }, { id: 'r03.no-op', kind: 'step', why: '开门这一步要发命令', red: '什么都不做的实现', label: 'open-1', minCommands: 0 }];
  const looseReport = assertionRedness(loose, trace);
  assert.equal(looseReport.passed, false);
  assert.match(looseReport.results[0].detail, /断言太松/);
  assert.throws(() => freezeAssertionSet({ requirement: REQUIREMENTS[2], assertions: loose, reviewedBy: '人类', trace }), /断言太松/);

  const tight = TRANSLATION_CASES.good.assertions;
  assert.equal(assertionRedness(tight, trace).passed, true);
  const frozen = freezeAssertionSet({ requirement: REQUIREMENTS[2], assertions: tight, reviewedBy: '人类', trace });
  assert.equal(frozen.format, 'craftmine.assertion-set/1');
  assert.equal(verifyFrozenAssertionSet(frozen), frozen.hash);
  const tampered = { ...frozen, assertions: [{ ...frozen.assertions[0], delta: 0 }] };
  assert.throws(() => verifyFrozenAssertionSet(tampered), /被改动过/);
  assert.throws(() => freezeAssertionSet({ requirement: REQUIREMENTS[2], assertions: tight }), /必须有人审一次/);
});

test('评审只能提意见：没有可执行断言的发现会让整份评审被拒绝', () => {
  const prompt = reviewPrompt({ said: '开门要消耗一块木头', artifact: 'object.patch ...', evidence: 'open-1 扣了 1 块' });
  assert.match(prompt, /看不到实现者的推理过程/);
  assert.match(prompt, /只输出 JSON/);
  const findings = parseFindings(JSON.stringify({ findings: [
    { claim: '重复开门会重复扣料', severity: 'blocker', assertion: { id: 'r03.no-double', kind: 'inventoryDelta', why: '第二次不能再扣', red: '重复扣料的实现', item: 'wood', delta: 0, step: 'open-2' } },
  ] }));
  assert.equal(findings.length, 1);
  const summary = reviewSummary(findings);
  assert.equal(summary.total, 1);
  assert.equal(summary.counts.blocker, 1);
  assert.equal(summary.blocked, true);
  assert.equal(summary.assertions, 1);
  assert.equal(findingsToAssertions(findings)[0].fromReview, '重复开门会重复扣料');
  assert.throws(() => parseFindings({ findings: [{ claim: '我觉得这段代码写得不好', severity: 'minor' }] }), /没有带可执行断言/);
  assert.throws(() => parseFindings({ findings: [{ claim: '不好', severity: '致命', assertion: { id: 'x', kind: 'noErrors', why: '不能崩', red: '抛错的实现' } }] }), /严重程度无效/);
  assert.equal(reviewSummary([]).total, 0);
});
