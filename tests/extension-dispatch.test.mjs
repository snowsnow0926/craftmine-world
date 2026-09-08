import test from 'node:test';
import assert from 'node:assert/strict';
import { compileScene } from '../app/scene.mjs';
import { GameplaySession } from '../app/gameplay.mjs';
import { BehaviorSession } from '../app/behavior-session.mjs';
import { part } from './scene-fixtures.mjs';

// 扩展命令派发（E2 的最后一环）：玩法只提出调用，效果由扩展沙箱算出来，宿主按扩展声明的权限落地。
const scene = () => ({
  format: 'craftmine.scene/3', title: '吸血试验场', night: false, systems: [],
  objects: [{ id: 'zombie-1', name: '怪物', position: { x: 0, y: 6, z: 8 }, source: null, components: { health: 40, contactDamage: 0 }, parts: [part([0, 0, 0], [.6, 1.5, .6], '#7d9b63', 'box', true)] }],
  behaviors: [{
    format: 'craftmine.behavior/3', id: 'steal-mod', name: '吸血玩法', description: '按 G 吸血',
    code: 'export function step({ state }) { return { state, commands: [] }; }', stateVersion: 1, initialState: {}, params: {},
    targets: ['zombie-1'], permissions: ['targets.write', 'health.write'], capabilities: [], requires: ['ext:life-steal@1'], binding: null, keys: ['KeyG'],
  }],
});

// 假 Worker：只按模块意图返回扩展命令；派发路径本身才是被测对象。
const fakeRunner = definition => ({
  ready: Promise.resolve(), closed: false,
  async step(frame) { return { state: {}, commands: frame?.event?.type === 'key' && definition.id === 'steal-mod' ? [{ type: 'life.steal', targetId: 'zombie-1', amount: 10 }] : [] }; },
  dispose() { this.closed = true; },
});

const extensionTable = runner => new Map([['life.steal', {
  extensionId: 'life-steal', version: 1, permission: 'targets.write',
  permissions: ['targets.write', 'health.write'], targets: ['zombie-1'], capabilities: [], runner,
}]]);

const run = async ({ extensions, key = 'KeyG', strict = true } = {}) => {
  const build = compileScene(scene(), { extensions: new Set(['ext:life-steal@1']) });
  const play = new GameplaySession([], build.scene.objects, null);
  const effects = [], commands = [];
  const session = new BehaviorSession(build, null, {
    context: () => ({ player: { position: { x: 0, y: 6, z: 14 }, grounded: true, health: 100 }, objects: build.scene.objects.map(object => ({ id: object.id, position: object.position, visible: true, solid: true, health: 40 })) }),
    apply: applied => effects.push(...(applied?.effects || [])),
    gameplay: play.state, extensions, runnerFactory: fakeRunner,
    onStep: ({ result }) => commands.push(...result.commands),
  });
  await session.start();
  await session.execute({ type: 'key', targetId: null, code: key }, 0.1, strict);
  return { session, effects, commands, play };
};

test('玩法发出的扩展命令会被派发到扩展沙箱，产出的内核效果落到世界', async () => {
  const seen = [];
  const runner = { apply: async ({ command, state }) => { seen.push(command); return { effects: [{ type: 'target.damage', id: command.targetId, amount: command.amount }, { type: 'health.add', amount: command.amount }], state: { count: (state?.count || 0) + 1 } }; } };
  const { session, effects, commands } = await run({ extensions: extensionTable(runner) });
  assert.equal(commands.length, 1, '玩法模块确实发出了扩展命令');
  assert.deepEqual(seen, [{ type: 'life.steal', targetId: 'zombie-1', amount: 10 }]);
  assert.deepEqual(effects.map(effect => effect.type), ['target.damage', 'health.add'], '扩展产出的内核效果由宿主落地');
  assert.deepEqual(session.extensionStates.get('life-steal'), { count: 1 }, '扩展状态按扩展 ID 保留，供下一步继续');
  session.dispose();
});

test('扩展状态跨步累积，不会每步重置', async () => {
  const runner = { apply: async ({ state }) => ({ effects: [], state: { count: (state?.count || 0) + 1 } }) };
  const { session } = await run({ extensions: extensionTable(runner) });
  await session.execute({ type: 'key', targetId: null, code: 'KeyG' }, 0.1, true);
  assert.deepEqual(session.extensionStates.get('life-steal'), { count: 2 });
  session.dispose();
});

test('没有装载扩展时，同一条命令仍然被拒绝，错误不会变模糊', async () => {
  await assert.rejects(() => run({ extensions: null }), /不支持的玩法命令/);
  await assert.rejects(() => run({ extensions: new Map() }), /不支持的玩法命令/);
});

test('权限与依赖两道门都必须过：缺依赖或缺权限都不许发出扩展命令', async () => {
  const runner = { apply: async () => ({ effects: [], state: {} }) };
  // 缺 requires：把扩展表里的依赖要求改成别的版本，模块声明就对不上。
  const wrongVersion = new Map([['life.steal', { ...extensionTable(runner).get('life.steal'), version: 2 }]]);
  await assert.rejects(() => run({ extensions: wrongVersion }), /没有声明所需的扩展依赖：ext:life-steal@2/);
  // 缺权限：扩展命令声明的权限必须在模块 permissions 里。
  const wrongPermission = new Map([['life.steal', { ...extensionTable(runner).get('life.steal'), permission: 'inventory.write' }]]);
  await assert.rejects(() => run({ extensions: wrongPermission }), /没有声明所需权限：inventory.write/);
});

test('扩展越权产出的效果被宿主拒绝，模块随即停止并留下可读错误', async () => {
  const rogue = { apply: async () => ({ effects: [{ type: 'inventory.add', item: 'wood', count: 1 }], state: {} }) };
  const { session } = await run({ extensions: extensionTable(rogue), strict: false });
  assert.match(session.data.value.modules['steal-mod'].error || '', /权限/);
  assert.equal(session.failures.length, 1);
  session.dispose();
});
