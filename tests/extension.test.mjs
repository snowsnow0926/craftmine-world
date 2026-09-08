import test from 'node:test';
import assert from 'node:assert/strict';
import { HOST_EFFECTS, extensionCatalog, extensionRequirement, validateExtension } from '../app/harness/extension.mjs';
import { NOOP_CODE, ExtensionRegistry, applyEffects, prepareExtension, runSelfTests, stageExtension } from '../app/harness/extension-loader.mjs';
import { validateExtensionResult } from '../app/harness/extension-effects.mjs';
import { compileScene } from '../app/scene.mjs';

const lifeSteal = (version = 1, overrides = {}) => ({
  format: 'craftmine.extension/1', id: 'life-steal', name: '吸血', version,
  description: '命中时把伤害的一部分转成自己的生命',
  requires: [], permissions: ['targets.write', 'health.write'], targets: ['zombie-1'],
  provides: {
    commands: [{
      type: 'life.steal', permission: 'targets.write', scope: '声明过的 targets',
      fields: [{ name: 'targetId', description: '目标对象 ID' }, { name: 'amount', description: '吸血量 1..50' }],
    }],
    events: [],
  },
  lifecycle: { register: 'onLoad', unload: 'rejectModules' },
  code: 'export function apply({ command }) { const amount = Math.max(1, Math.min(50, command.amount | 0)); return { effects: [{ type: \'target.damage\', id: command.targetId, amount }, { type: \'health.add\', amount }], state: {} }; }',
  selfTests: [{
    name: '吸血同时扣目标血量并回血',
    world: { playerHealth: 50, objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true, mesh: true, health: 40, solid: true }] },
    state: {}, commands: [{ type: 'life.steal', targetId: 'zombie-1', amount: 10 }],
    expect: [
      { id: 'life.damage', kind: 'objectHealth', why: '目标真的掉血', red: '不扣血的实现', object: 'zombie-1', min: 0, max: 30, step: 'command-1' },
      { id: 'life.heal', kind: 'playerHealth', why: '自己真的回血', red: '不回血的实现', min: 51, step: 'command-1' },
    ],
  }],
  ...overrides,
});

// 假执行器：只跑测试用例里声明的那条扩展逻辑；换成空实现时返回空效果，用来验证反造假。
const fakeRunner = handler => extension => ({
  ready: Promise.resolve(),
  async apply({ command, world, state }) {
    if (extension.code === NOOP_CODE) return { effects: [], state: state || {} };
    return handler({ command, world, state });
  },
  dispose() {},
});
const stealHandler = ({ command }) => command.type === 'status.poison'
  ? { effects: [{ type: 'target.damage', id: command.targetId, amount: 5 }], state: {} }
  : { effects: [{ type: 'target.damage', id: command.targetId, amount: command.amount }, { type: 'health.add', amount: command.amount }], state: {} };
const createRunner = fakeRunner(stealHandler);
const approveReview = async () => ({ passed: true, summary: '评审没有提出阻断问题', findings: [] });

test('扩展格式：合法的吸血扩展通过校验，并能生成目录', () => {
  const extension = validateExtension(lifeSteal());
  assert.equal(extension.id, 'life-steal');
  const catalog = extensionCatalog([extension]);
  assert.equal(catalog[0].commands[0].type, 'life.steal');
  assert.match(catalog[0].commands[0].fields.join('；'), /吸血量/);
  assert.equal(extensionRequirement('life-steal', 1), 'ext:life-steal@1');
  assert.ok(Object.hasOwn(HOST_EFFECTS, 'target.damage'));
  assert.ok(Object.hasOwn(HOST_EFFECTS, 'health.add'));
});

test('扩展不能越权：格式、命令名、权限、自带测试都要合规', () => {
  const broken = (patch, pattern) => assert.throws(() => validateExtension(lifeSteal(1, patch)), pattern);
  broken({ format: 'craftmine.extension/2' }, /格式不兼容/);
  broken({ id: 'Life_Steal' }, /扩展 ID 无效/);
  broken({ version: 0 }, /版本号无效/);
  broken({ code: 'export function step() {}' }, /必须导出 apply/);
  broken({ provides: { commands: [{ type: 'object.patch', permission: 'objects.write', fields: [{ name: 'id', description: 'x' }] }], events: [] } }, /不能覆盖宿主命令/);
  broken({ permissions: [], provides: { commands: [{ type: 'life.steal', permission: 'targets.write', fields: [{ name: 'id', description: 'x' }] }], events: [] } }, /需要声明权限/);
  broken({ permissions: ['targets.write', 'health.write', 'magic.write'] }, /不存在的权限/);
  broken({ selfTests: [{ name: 'x', world: { objects: [] }, commands: [{ type: 'other.thing' }], expect: [{ id: 'a', kind: 'noErrors', why: '不报错', red: '抛错' }] }] }, /必须来自本扩展/);
  broken({ selfTests: [{ name: 'x', world: { objects: [] }, commands: [{ type: 'life.steal' }], expect: [{ id: 'a', kind: '感觉对', why: '看着对', red: '不对就红' }] }] }, /不支持的断言类型/);
  broken({ selfTests: [] }, /自带测试/);
  broken({ extra: 1 }, /不支持的字段/);
  broken({ requires: ['life-steal@1'] }, /依赖格式无效/);
  broken({ requires: ['ext:life-steal@1'] }, /不能依赖自己/);
});

test('效果校验复用内核规则：越权或未声明的目标一律拒绝', () => {
  const extension = validateExtension(lifeSteal());
  const world = { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true, solid: true, health: 40 }] };
  const ok = validateExtensionResult({ effects: [{ type: 'target.damage', id: 'zombie-1', amount: 5 }], state: {} }, extension, world);
  assert.equal(ok.effects.length, 1);
  assert.throws(() => validateExtensionResult({ effects: [{ type: 'target.damage', id: 'other-1', amount: 5 }], state: {} }, extension, world), /未授权/);
  assert.throws(() => validateExtensionResult({ effects: [{ type: 'hud.message', text: 'hi' }], state: {} }, extension, world), /权限/);
  assert.throws(() => validateExtensionResult({ effects: [{ type: 'inventory.add', item: 'wood', count: 1 }], state: {} }, extension, world), /权限/);
  assert.throws(() => validateExtensionResult({ effects: [], state: {}, extra: 1 }, extension, world), /不支持的字段/);
  assert.throws(() => validateExtensionResult({ effects: 'nope', state: {} }, extension, world), /必须是数组/);
});

test('自带测试必须真的能跑，并且对空实现变红', async () => {
  const extension = validateExtension(lifeSteal());
  const report = await runSelfTests(extension, { createRunner });
  assert.equal(report.passed, true, report.summary);
  assert.equal(report.results[0].real.passed, true);
  assert.equal(report.results[0].noop.passed, false);
  assert.match(report.results[0].detail, /空实现会被打红/);
});

test('自带测试造假的扩展必须被拒：对空实现也通过的测试证明不了任何事', async () => {
  const fake = lifeSteal(1, { selfTests: [{
    name: '随便断言一下',
    world: { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, health: 40 }] },
    state: {}, commands: [{ type: 'life.steal', targetId: 'zombie-1', amount: 10 }],
    expect: [{ id: 'fake.ok', kind: 'noErrors', why: '只要不报错就算过', red: '抛错的实现' }],
  }] });
  const report = await runSelfTests(validateExtension(fake), { createRunner });
  assert.equal(report.passed, false);
  assert.match(report.summary, /对空实现也通过/);
  const staged = await stageExtension(fake, { createRunner });
  assert.equal(staged.status, 'rejected');
  assert.match(staged.error, /空实现/);
});

test('装载前必须过冻结回归；回归失败一律拒绝', async () => {
  const good = await stageExtension(lifeSteal(), { createRunner, review: approveReview, verifyWorld: async () => ({ passed: true, summary: '冻结回归 10/10 通过' }) });
  assert.equal(good.status, 'ready');
  assert.deepEqual(good.checks.map(check => check.name), ['自带测试与反造假', '对抗评审', '冻结回归']);
  const bad = await stageExtension(lifeSteal(), { createRunner, review: approveReview, verifyWorld: async () => ({ passed: false, summary: '冻结回归 8/10 通过' }) });
  assert.equal(bad.status, 'rejected');
  assert.match(bad.error, /冻结回归 8\/10/);
  const crashed = await stageExtension(lifeSteal(), { createRunner, review: approveReview, verifyWorld: async () => { throw Error('浏览器挂了'); } });
  assert.equal(crashed.status, 'rejected');
  assert.match(crashed.error, /浏览器挂了/);
});

test('注册表：启用、依赖、历史回退、卸载语义都必须是显式的', async () => {
  const registry = new ExtensionRegistry({ createRunner, review: approveReview, verifyWorld: async () => ({ passed: true }) });
  const v1 = await registry.stage(lifeSteal(1));
  assert.equal(v1.status, 'ready');
  const activated = registry.activate(v1);
  assert.equal(activated.activated, 'ext:life-steal@1');
  assert.equal(registry.has('ext:life-steal@1'), true);
  assert.equal(registry.require('ext:life-steal@1').name, '吸血');
  assert.throws(() => registry.require('ext:poison@1'), /扩展没有装载/);

  const v2 = await registry.stage(lifeSteal(2, { name: '吸血·改' }));
  registry.activate(v2);
  assert.equal(registry.has('ext:life-steal@1'), false, '旧版本在升级后必须显式失效');
  assert.equal(registry.has('ext:life-steal@2'), true);
  const rolled = registry.rollback('life-steal');
  assert.equal(rolled.activated, 'ext:life-steal@1');
  assert.equal(registry.require('ext:life-steal@1').name, '吸血');

  // 依赖方存在时不许卸载，错误里要点名是谁依赖它。
  const poison = await registry.stage({
    ...lifeSteal(), id: 'poison', name: '中毒', version: 1, requires: ['ext:life-steal@1'],
    provides: { commands: [{ type: 'status.poison', permission: 'targets.write', fields: [{ name: 'targetId', description: '目标' }] }], events: [] },
    selfTests: [{ name: '中毒扣血', world: { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, health: 40 }] }, state: {}, commands: [{ type: 'status.poison', targetId: 'zombie-1' }], expect: [{ id: 'poison.damage', kind: 'objectHealth', why: '目标掉血', red: '不扣血的实现', object: 'zombie-1', max: 39, step: 'command-1' }] }],
  });
  assert.equal(poison.status, 'ready', poison.error);
  registry.activate(poison);
  assert.throws(() => registry.unload('life-steal'), /poison 依赖它/);
  assert.equal(registry.unload('poison').unloaded, 'ext:poison@1');
  assert.equal(registry.unload('life-steal').unloaded, 'ext:life-steal@1');
  assert.throws(() => registry.require('ext:life-steal@1'), /扩展没有装载/);
  assert.throws(() => registry.unload('life-steal'), /没有装载/);
  assert.throws(() => registry.rollback('poison'), /没有可以回退/);
});

test('命令名冲突在装载前就被发现，不会等到运行期', async () => {
  const registry = new ExtensionRegistry({ createRunner, review: approveReview });
  registry.activate(await registry.stage(lifeSteal()));
  const clash = await registry.stage({ ...lifeSteal(), id: 'other-mod', name: '另一个吸血' });
  assert.equal(clash.status, 'rejected');
  assert.match(clash.error, /已经被 life-steal 占用/);
  assert.throws(() => prepareExtension({ ...lifeSteal(), id: 'x', name: 'x' }, { loaded: registry.loaded }), /占用/);
});

test('世界模型落地：原子效果真的改变可观察事实', () => {
  const world = { playerHealth: 50, objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true, mesh: true, health: 40, solid: true }], inventory: {}, resources: { 'system-stamina': { value: 10, max: 100 } }, panels: {} };
  const after = applyEffects(world, [
    { type: 'target.damage', id: 'zombie-1', amount: 40 },
    { type: 'health.add', amount: 20 },
    { type: 'inventory.add', item: 'wood', count: 2 },
    { type: 'resource.add', id: 'system-stamina', amount: 5 },
    { type: 'hud.panel', key: 'shop', panel: { title: '商店', lines: ['木头 2'] } },
  ]);
  assert.equal(after.objects[0].health, 0);
  assert.equal(after.objects[0].mesh, false);
  assert.equal(after.playerHealth, 70);
  assert.equal(after.inventory.wood, 2);
  assert.equal(after.resources['system-stamina'].value, 15);
  assert.equal(after.panels.shop.title, '商店');
  assert.equal(world.objects[0].health, 40, '原始世界不能被就地修改');
  assert.equal(applyEffects(world, [{ type: 'resource.add', id: 'system-stamina', amount: 999 }]).resources['system-stamina'].value, 100);
});

test('没有对抗评审就不允许进入候选状态；评审的阻断意见是建议，不阻止装载', async () => {
  const noReview = await stageExtension(lifeSteal(), { createRunner });
  assert.equal(noReview.status, 'rejected');
  assert.match(noReview.error, /必须先过对抗评审/);
  // 真实运行证明评审会不断提出新的设计意见（等量治疗、白名单、冷却……）：把它当硬门槛会让改稿循环永不收敛。
  // 因此评审必须真的跑过，但严重程度只作为建议随候选留档，硬门槛只保留机器能复核的检查。
  const blocked = await stageExtension(lifeSteal(), { createRunner, review: async () => ({ passed: false, blocked: true, summary: '评审发现阻断问题：重复吸血没有冷却', findings: [{ claim: '重复吸血没有冷却', severity: 'blocker' }], assertions: [] }) });
  assert.equal(blocked.status, 'ready');
  assert.equal(blocked.reviewBlocked, true);
  assert.equal(blocked.reviewRan, true);
  assert.deepEqual(blocked.reviewFindings, [{ claim: '重复吸血没有冷却', severity: 'blocker' }]);
  assert.match(blocked.checks.find(check => check.name === '对抗评审').detail, /属于建议/);
  const broken = await stageExtension(lifeSteal(), { createRunner, review: async () => { throw Error('评审模型不可用'); } });
  assert.equal(broken.status, 'rejected', '评审跑不起来仍然是硬失败');
  assert.match(broken.error, /评审模型不可用/);
});

test('玩法模块可以声明扩展依赖：装载了才通过，卸载后显式失败', () => {
  const scene = {
    format: 'craftmine.scene/3', title: '吸血试验场', night: false, systems: [],
    objects: [{ id: 'zombie-1', name: '怪物', position: { x: 0, y: 6, z: 8 }, source: null, components: { health: 0, contactDamage: 0 }, parts: [{ shape: 'box', offset: { x: 0, y: 0, z: 0 }, size: { x: .6, y: 1.5, z: .6 }, material: 'solid', color: '#7d9b63', solid: true }] }],
    behaviors: [{
      format: 'craftmine.behavior/3', id: 'steal-mod', name: '吸血玩法', description: '依赖吸血扩展',
      code: 'export function step({ state }) { return { state, commands: [] }; }', stateVersion: 1, initialState: {}, params: {},
      targets: ['zombie-1'], permissions: [], capabilities: [], requires: ['ext:life-steal@1'], binding: null,
    }],
  };
  assert.throws(() => compileScene(scene), /扩展没有装载：ext:life-steal@1/);
  const build = compileScene(scene, { extensions: new Set(['ext:life-steal@1']) });
  assert.equal(build.behaviors.length, 1);
  assert.deepEqual(build.behaviors[0].definition.requires, ['ext:life-steal@1']);
});

test('自带测试的轨迹真的算出变化字段，change 断言才有意义', async () => {
  const extension = validateExtension(lifeSteal(1, { selfTests: [{
    ...lifeSteal().selfTests[0],
    expect: [
      { id: 'e1', kind: 'objectHealth', why: '目标掉血', red: '不扣血的实现', object: 'zombie-1', max: 30, step: 'command-1' },
      { id: 'e2', kind: 'step', why: '这一步确实改动了目标与玩家血量', red: '什么都没做的实现', label: 'command-1', change: { minFields: 2, fields: ['object:zombie-1', 'player'] } },
    ],
  }] }));
  // 假执行器：真实代码产出效果，空实现（NOOP_CODE）什么都不产出，让反造假能变红。
  const createRunner = extension => ({
    ready: Promise.resolve(true),
    apply: async ({ command, state }) => (extension.code.includes('target.damage')
      ? { effects: [{ type: 'target.damage', id: command.targetId, amount: 10 }, { type: 'health.add', amount: 10 }], state }
      : { effects: [], state }),
    dispose: async () => {},
  });
  const report = await runSelfTests(extension, { createRunner });
  assert.equal(report.passed, true, report.summary);
  assert.match(report.results[0].real.detail, /2 条断言全部通过/);
});

test('沙箱代理把载荷原样传给页面函数（page.evaluate 的第一个参数就是值）', async () => {
  const { sandboxRunner } = await import('../app/harness/extension-sandbox-browser.mjs');
  const seen = [];
  const page = { evaluate: async (pageFunction, argument) => { seen.push(argument); return 'ok'; } };
  const runner = sandboxRunner(page)(validateExtension(lifeSteal()));
  await runner.ready;
  const payload = { command: { type: 'life.steal', targetId: 'zombie-1', amount: 10 }, world: { objects: [] }, state: {} };
  assert.equal(await runner.apply(payload), 'ok');
  assert.deepEqual(seen[1], payload, '第二个调用的第一个参数必须是完整载荷，否则页面里 command 会是 undefined');
  assert.equal(seen[0].meta.id, 'life-steal');
  assert.equal(seen[0].code, lifeSteal().code);
  await runner.dispose();
  assert.equal(seen.length, 3);
});

test('沙箱已经关闭时释放失败不会变成未处理拒绝（真实端到端曾因此让服务退出）', async () => {
  const extension = validateExtension(lifeSteal());
  let disposed = 0;
  const createRunner = () => ({
    ready: Promise.resolve(true),
    apply: async ({ command, state }) => ({ effects: [{ type: 'target.damage', id: command.targetId, amount: 10 }, { type: 'health.add', amount: 10 }], state }),
    dispose: async () => { disposed += 1; throw Error('Target page, context or browser has been closed'); },
  });
  const report = await runSelfTests(extension, { createRunner });
  assert.equal(report.format, 'craftmine.extension-selftest/1');
  assert.equal(disposed, 2, '真实实现与空实现各释放一次');
  // 假执行器对空实现也返回同样效果，反造假必须把它打红——释放失败不能改变这个判定。
  assert.equal(report.passed, false);
  assert.match(report.summary, /空实现/);
});
