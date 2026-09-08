import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOOP_RENDER_CODE, RENDER_EXTENSION_FORMAT, RENDER_LIMITS, RenderExtensionRegistry, prepareRenderExtension,
  renderExtensionDigest, renderExtensionRequirement, runRenderSelfTests, stageRenderExtension, validateDrawables, validateRenderExtension,
} from '../app/harness/render-extension.mjs';

const particle = (position, overrides = {}) => ({ kind: 'particle', position, size: 0.12, ttl: 0.6, color: '#ffcc33', ...overrides });

const sparkParticles = (version = 1, overrides = {}) => ({
  format: RENDER_EXTENSION_FORMAT, id: 'spark-particles', name: '火花粒子', version,
  description: '在可见对象头顶冒一圈火花，只影响画面',
  code: `export function emit({ world }) {
  return (world.objects || []).filter(object => object.visible).map(object => ({ kind: 'particle', position: { x: object.position.x, y: object.position.y + 1, z: object.position.z }, size: 0.12, ttl: 0.6, color: '#ffcc33' }));
}`,
  selfTests: [{
    name: '可见对象头顶真的冒出粒子',
    world: { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true }] },
    time: 1.5, dt: 0.016,
    expect: [{ id: 'spark.count', kind: 'step', why: '这一帧真的产出了粒子', red: '什么都不画的实现', label: 'emit-1', minCommands: 1 }],
  }],
  ...overrides,
});

// 假沙箱：只跑测试用例声明的那条逻辑；换成空实现时返回空数组，用来验证反造假。
const fakeRunner = handler => extension => ({
  ready: Promise.resolve(),
  async emit({ world, time, dt }) {
    if (extension.code === NOOP_RENDER_CODE) return [];
    return handler({ world, time, dt });
  },
  dispose() {},
});
const createRunner = fakeRunner(({ world }) => (world.objects || []).filter(object => object.visible).map(object => particle({ x: object.position.x, y: object.position.y + 1, z: object.position.z })));

test('渲染扩展格式：合法扩展通过校验，默认预算与失败上限被补齐', () => {
  const extension = validateRenderExtension(sparkParticles());
  assert.equal(extension.id, 'spark-particles');
  assert.equal(extension.budgetMs, 4);
  assert.equal(extension.maxFailures, 3);
  assert.equal(RENDER_LIMITS.drawables, 256);
  assert.equal(renderExtensionRequirement('spark-particles', 2), 'render:spark-particles@2');
  const prepared = prepareRenderExtension(sparkParticles());
  assert.equal(prepared.requirement, 'render:spark-particles@1');
  assert.equal(prepared.hash, renderExtensionDigest(validateRenderExtension(sparkParticles())));
  assert.ok(prepared.hash.includes('spark-particles'));
});

test('渲染扩展指纹与键顺序无关，因此同一份数据必然同一串', () => {
  assert.equal(renderExtensionDigest({ b: 1, a: { d: 2, c: [3, 4] } }), renderExtensionDigest({ a: { c: [3, 4], d: 2 }, b: 1 }));
  assert.notEqual(renderExtensionDigest({ a: 1 }), renderExtensionDigest({ a: 2 }));
});

test('渲染扩展不能越界：格式、字段、预算、自带测试都要合规', () => {
  const broken = (patch, pattern) => assert.throws(() => validateRenderExtension(sparkParticles(1, patch)), pattern);
  broken({ format: 'craftmine.render-extension/2' }, /格式不兼容/);
  broken({ id: 'Spark_Particles' }, /ID 无效/);
  broken({ name: '' }, /名称无效/);
  broken({ version: 0 }, /版本号无效/);
  broken({ description: 'x'.repeat(1001) }, /说明无效/);
  broken({ code: 'export const nothing = 1;' }, /必须导出 emit/);
  broken({ code: 'export function emit() { return []; }' + 'x'.repeat(RENDER_LIMITS.code) }, /代码无效或过长/);
  broken({ budgetMs: 0 }, /单帧预算/);
  broken({ budgetMs: 17 }, /单帧预算/);
  broken({ maxFailures: 0 }, /失败上限/);
  broken({ maxFailures: 11 }, /失败上限/);
  broken({ selfTests: [] }, /自带测试/);
  broken({ selfTests: [{ name: 'x', world: {}, time: 0, dt: 0.016, expect: [{ id: 'a', kind: 'noErrors', why: '不报错', red: '抛错' }] }] }, /world.objects/);
  broken({ selfTests: [{ name: 'x', world: { objects: [] }, time: 'later', dt: 0.016, expect: [{ id: 'a', kind: 'noErrors', why: '不报错', red: '抛错' }] }] }, /time 必须是数字/);
  broken({ selfTests: [{ name: 'x', world: { objects: [] }, time: 0, dt: 2, expect: [{ id: 'a', kind: 'noErrors', why: '不报错', red: '抛错' }] }] }, /dt 必须是 0–1/);
  broken({ selfTests: [{ name: 'x', world: { objects: [] }, time: 0, dt: 0.016, expect: [{ id: 'a', kind: '感觉对', why: '看着对', red: '不对就红' }] }] }, /不支持的断言类型/);
  broken({ selfTests: [{ name: 'x', world: { objects: [] }, time: 0, dt: 0.016, expect: [] }] }, /需要 expect 断言/);
  broken({ extra: 1 }, /不支持的字段/);
});

test('drawable 校验：位置、数量、尺寸、颜色、盒子范围都必须落在世界里', () => {
  const ok = validateDrawables([
    particle({ x: 0, y: 6, z: 0 }),
    particle({ x: 46, y: 38, z: -46 }),
    { kind: 'box', min: { x: -1, y: 6, z: -1 }, max: { x: 1, y: 8, z: 1 }, color: '#33ffaa' },
  ]);
  assert.equal(ok.length, 3);

  assert.throws(() => validateDrawables('nope'), /必须返回 drawable 数组/);
  assert.throws(() => validateDrawables(Array.from({ length: RENDER_LIMITS.drawables + 1 }, () => particle({ x: 0, y: 6, z: 0 }))), /最多产出 256 个 drawable/);
  assert.throws(() => validateDrawables([{ ...particle({ x: 0, y: 6, z: 0 }), kind: 'sprite' }]), /类型无效/);
  assert.throws(() => validateDrawables([particle({ x: 47, y: 6, z: 0 })]), /水平位置超出世界范围/);
  assert.throws(() => validateDrawables([particle({ x: 0, y: 6, z: -47 })]), /水平位置超出世界范围/);
  assert.throws(() => validateDrawables([particle({ x: 0, y: 5.9, z: 0 })]), /高度必须在 6–38/);
  assert.throws(() => validateDrawables([particle({ x: 0, y: 38.1, z: 0 })]), /高度必须在 6–38/);
  assert.throws(() => validateDrawables([particle({ x: 0, y: 6, z: 0 }, { size: 0.01 })]), /size 必须在/);
  assert.throws(() => validateDrawables([particle({ x: 0, y: 6, z: 0 }, { size: 1.5 })]), /size 必须在/);
  assert.throws(() => validateDrawables([particle({ x: 0, y: 6, z: 0 }, { ttl: 0.01 })]), /ttl 必须在/);
  assert.throws(() => validateDrawables([particle({ x: 0, y: 6, z: 0 }, { ttl: 6 })]), /ttl 必须在/);
  assert.throws(() => validateDrawables([particle({ x: 0, y: 6, z: 0 }, { color: 'red' })]), /颜色必须是 #RRGGBB/);
  assert.throws(() => validateDrawables([particle({ x: 0, y: 6, z: 0 }, { power: 9 })]), /不支持的字段/);
  assert.throws(() => validateDrawables([{ kind: 'box', min: { x: 1, y: 6, z: 0 }, max: { x: 1, y: 8, z: 1 }, color: '#ffffff' }]), /min 必须小于 max/);
  assert.throws(() => validateDrawables([{ kind: 'box', min: { x: -47, y: 6, z: 0 }, max: { x: -46, y: 8, z: 1 }, color: '#ffffff' }]), /水平位置超出世界范围/);
  assert.throws(() => validateDrawables([{ kind: 'box', min: { x: 0, y: 4, z: 0 }, max: { x: 1, y: 8, z: 1 }, color: '#ffffff' }]), /超出世界范围/);
});

test('自带测试必须真的能跑，并且对空实现变红', async () => {
  const extension = validateRenderExtension(sparkParticles());
  const report = await runRenderSelfTests(extension, { createRunner });
  assert.equal(report.passed, true, report.summary);
  assert.equal(report.results[0].real.passed, true);
  assert.equal(report.results[0].noop.passed, false);
  assert.match(report.results[0].detail, /空实现会被打红/);
  assert.deepEqual(report.results[0].real.drawables, ['particle']);
});

test('自带测试造假的渲染扩展必须被拒：对空实现也通过的测试证明不了任何事', async () => {
  const fake = sparkParticles(1, {
    selfTests: [{
      name: '随便断言一下', world: { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true }] },
      time: 1, dt: 0.016,
      expect: [{ id: 'fake.ok', kind: 'noErrors', why: '只要不报错就算过', red: '抛错的实现' }],
    }],
  });
  const report = await runRenderSelfTests(validateRenderExtension(fake), { createRunner });
  assert.equal(report.passed, false);
  assert.match(report.summary, /对空实现也通过/);
  const staged = await stageRenderExtension({ extension: fake, createRunner });
  assert.equal(staged.status, 'rejected');
  assert.match(staged.error, /空实现/);
});

test('自带测试真过不了就拒绝，冻结回归失败也拒绝', async () => {
  const wrong = sparkParticles(1, {
    selfTests: [{
      name: '要求两个粒子', world: { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true }] },
      time: 1, dt: 0.016,
      expect: [{ id: 'spark.two', kind: 'step', why: '这一帧要产出两个粒子', red: '只产出一个的实现', label: 'emit-1', minCommands: 2 }],
    }],
  });
  const rejected = await stageRenderExtension({ extension: wrong, createRunner });
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.error, /自带测试没有通过/);

  const good = await stageRenderExtension({ extension: sparkParticles(), createRunner, verifyWorld: async () => ({ passed: true, summary: '冻结回归 12/12 通过' }) });
  assert.equal(good.status, 'ready');
  assert.deepEqual(good.checks.map(check => check.name), ['自带测试与反造假', '冻结回归']);
  const bad = await stageRenderExtension({ extension: sparkParticles(), createRunner, verifyWorld: async () => ({ passed: false, summary: '冻结回归 10/12 通过' }) });
  assert.equal(bad.status, 'rejected');
  assert.match(bad.error, /冻结回归 10\/12/);
  const crashed = await stageRenderExtension({ extension: sparkParticles(), createRunner, verifyWorld: async () => { throw Error('浏览器挂了'); } });
  assert.equal(crashed.status, 'rejected');
  assert.match(crashed.error, /浏览器挂了/);
  const noRunner = await stageRenderExtension({ extension: sparkParticles() });
  assert.equal(noRunner.status, 'rejected');
  assert.match(noRunner.error, /沙箱执行器/);
});

test('注册表：启用、历史回退、卸载语义都必须是显式的', async () => {
  const registry = new RenderExtensionRegistry({ createRunner, verifyWorld: async () => ({ passed: true }) });
  const v1 = await registry.stage(sparkParticles(1));
  assert.equal(v1.status, 'ready', v1.error);
  const activated = registry.activate(v1);
  assert.equal(activated.activated, 'render:spark-particles@1');
  assert.equal(activated.previous, null);
  assert.equal(registry.has('spark-particles', 1), true);
  assert.throws(() => registry.activate({ status: 'rejected' }), /只有通过全部检查/);

  const v2 = await registry.stage(sparkParticles(2, { name: '火花粒子·改' }));
  assert.equal(v2.status, 'ready', v2.error);
  registry.activate(v2);
  assert.equal(registry.has('spark-particles', 1), false);
  assert.equal(registry.has('spark-particles', 2), true);
  assert.deepEqual(registry.history.get('spark-particles').map(extension => extension.version), [1]);

  const rolled = registry.rollback('spark-particles');
  assert.equal(rolled.activated, 'render:spark-particles@1');
  assert.equal(rolled.rolledBack, true);
  assert.equal(registry.loaded[0].version, 1);
  assert.throws(() => registry.rollback('spark-particles'), /没有可以回退/);

  assert.equal(registry.unload('spark-particles').unloaded, 'render:spark-particles@1');
  assert.throws(() => registry.unload('spark-particles'), /没有装载/);
  const report = registry.report();
  assert.equal(report.format, 'craftmine.render-load/1');
  assert.ok(report.rejected.every(entry => entry.error));
});

test('空实现常量确实是合法的渲染扩展源码骨架', () => {
  assert.match(NOOP_RENDER_CODE, /export\s+function\s+emit/);
  assert.deepEqual(validateDrawables([]), []);
});
