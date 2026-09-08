import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FROZEN_KERNEL, FROZEN_KERNEL_HASHES, PART_NOOP_CODE, PartRegistry, REPLACEABLE_PARTS,
  assertKernelIntact, loadPart, partDigest, verifyKernel,
} from '../app/harness/kernel.mjs';
import { PART_KINDS, getPart, listParts, registerPart, unregisterPart, usePart } from '../app/harness/parts.mjs';

const renderPassPart = (version = 1, overrides = {}) => ({
  id: 'outline-pass', kind: 'renderPass', version,
  code: 'export function run({ objects }) { return objects.map(object => ({ type: \'outline\', id: object.id })); }',
  selfTests: [{
    name: '对每个对象产出一条轮廓命令',
    world: { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 } }] },
    expect: [{ id: 'outline.count', kind: 'step', why: '这一帧真的产出了轮廓命令', red: '什么都不做的实现', label: 'run-1', minCommands: 1 }],
  }],
  ...overrides,
});
const approvals = [{ id: 'outline-pass', by: '人类评审', at: '2026-09-09T00:00:00.000Z' }];

// 假沙箱：只跑测试用例声明的那条逻辑；空实现返回 null，轨迹里就是零条命令。
const createRunner = part => ({
  ready: Promise.resolve(),
  async run({ world }) {
    if (part.code === PART_NOOP_CODE[part.kind]) return null;
    return (world.objects || []).map(object => ({ type: 'outline', id: object.id }));
  },
  dispose() {},
});

test('冻结内核：当前仓库的规则文件哈希全部对得上', () => {
  const report = verifyKernel();
  assert.equal(report.format, 'craftmine.kernel-check/1');
  assert.equal(report.passed, true, report.summary);
  assert.equal(report.entries.length, FROZEN_KERNEL.length);
  assert.ok(report.entries.every(entry => entry.ok));
  assert.ok(FROZEN_KERNEL.every(relative => FROZEN_KERNEL_HASHES[relative]));
  assert.match(report.summary, /都没有被改动/);
  assert.equal(assertKernelIntact().passed, true);
});

test('冻结内核：注入被改动的文件内容必须点名报错，并说明只有人能改清单', () => {
  const tampered = verifyKernel({ files: { 'app/canonical.mjs': 'export const canonicalJSON = value => String(value);\n' } });
  assert.equal(tampered.passed, false);
  const entry = tampered.entries.find(item => item.path === 'app/canonical.mjs');
  assert.equal(entry.ok, false);
  assert.equal(entry.expected, FROZEN_KERNEL_HASHES['app/canonical.mjs']);
  assert.notEqual(entry.actual, entry.expected);
  assert.match(tampered.summary, /app\/canonical\.mjs/);
  assert.match(tampered.summary, /只有人能更新冻结清单/);
  assert.throws(() => assertKernelIntact({ files: { 'app/store.mjs': 'tampered' } }), /app\/store\.mjs/);

  // 注入未改动的内容不能误报。
  const same = verifyKernel({ files: { 'app/canonical.mjs': fs.readFileSync('app/canonical.mjs', 'utf8') } });
  assert.equal(same.passed, true);
});

test('装载内核部件：没有人工审批就一步都不许走', async () => {
  await assert.rejects(() => loadPart({ kind: 'renderPass', part: renderPassPart(), approvals: [], createRunner }), /改动内核部件必须有人审一次/);
  await assert.rejects(() => loadPart({ kind: 'renderPass', part: renderPassPart(), approvals: [{ id: 'outline-pass', by: '', at: 'x' }], createRunner }), /必须有人审一次/);
  await assert.rejects(() => loadPart({ kind: 'spritePass', part: renderPassPart(), approvals, createRunner }), /内核部件类型无效/);
  await assert.rejects(() => loadPart({ kind: 'renderPass', part: renderPassPart(1, { kind: 'hudWidget' }), approvals, createRunner }), /kind 必须是 renderPass/);
  await assert.rejects(() => loadPart({ kind: 'renderPass', part: renderPassPart(1, { code: 'export const nothing = 1;' }), approvals, createRunner }), /必须导出 run/);
});

test('装载内核部件：审批齐全、自带测试通过且空实现变红，才拿到 ready', async () => {
  const candidate = await loadPart({ kind: 'renderPass', part: renderPassPart(), approvals, createRunner });
  assert.equal(candidate.status, 'ready', candidate.error);
  assert.equal(candidate.part.digest, partDigest(renderPassPart()));
  assert.equal(candidate.part.entry, 'run');
  assert.deepEqual(candidate.checks.map(check => check.name), ['人工审批', '冻结内核', '自带测试与反造假']);
  assert.equal(candidate.selfTests.passed, true, candidate.selfTests.summary);
  assert.equal(candidate.selfTests.results[0].noop.passed, false);
});

test('装载内核部件：自带测试真过不了就拒绝，对空实现也通过同样拒绝', async () => {
  const wrong = renderPassPart(1, {
    selfTests: [{
      name: '要求两条命令', world: { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 } }] },
      expect: [{ id: 'outline.two', kind: 'step', why: '这一帧要两条轮廓命令', red: '只产出一条的实现', label: 'run-1', minCommands: 2 }],
    }],
  });
  const rejected = await loadPart({ kind: 'renderPass', part: wrong, approvals, createRunner });
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.error, /自带测试没有通过/);

  const fake = renderPassPart(1, {
    selfTests: [{
      name: '随便断言一下', world: { objects: [] },
      expect: [{ id: 'fake.ok', kind: 'noErrors', why: '只要不报错就算过', red: '抛错的实现' }],
    }],
  });
  const faked = await loadPart({ kind: 'renderPass', part: fake, approvals, createRunner });
  assert.equal(faked.status, 'rejected');
  assert.match(faked.error, /对空实现也通过/);
});

test('装载内核部件：冻结内核被改动时连自带测试都不跑', async () => {
  let called = 0;
  const spy = part => { called += 1; return createRunner(part); };
  await assert.rejects(
    () => loadPart({ kind: 'renderPass', part: renderPassPart(), approvals, createRunner: spy, verifyKernel: () => ({ passed: false, summary: '冻结内核被改动：app/store.mjs' }) }),
    /冻结内核被改动/,
  );
  assert.equal(called, 0);
});

test('部件注册表：激活、历史、回退到上一个版本再回退到内置默认', async () => {
  const registry = new PartRegistry({ createRunner, approvals });
  const v1 = await registry.load(renderPassPart(1));
  assert.equal(v1.status, 'ready', v1.error);
  assert.deepEqual(registry.loaded, []);
  const activated = registry.activate(v1);
  assert.equal(activated.activated, 'renderPass:outline-pass@1');
  assert.equal(activated.previous, null);
  assert.equal(registry.current('renderPass').version, 1);
  assert.throws(() => registry.activate({ status: 'rejected' }), /只有通过全部检查/);

  const v2 = await registry.load(renderPassPart(2));
  registry.activate(v2);
  assert.equal(registry.current('renderPass').version, 2);
  assert.deepEqual(registry.history('renderPass').map(part => part.version), [1]);

  const fell = registry.fallback('renderPass');
  assert.equal(fell.fallback, 'renderPass:outline-pass@1');
  assert.equal(fell.builtin, false);
  assert.equal(registry.current('renderPass').version, 1);

  const builtin = registry.fallback('renderPass');
  assert.equal(builtin.fallback, 'renderPass:default');
  assert.equal(builtin.builtin, true);
  assert.equal(registry.current('renderPass'), null);
  assert.throws(() => registry.fallback('renderPass'), /没有可回退的版本/);
  assert.throws(() => registry.current('spritePass'), /内核部件类型无效/);
  assert.throws(() => registry.history('spritePass'), /内核部件类型无效/);
  assert.deepEqual(REPLACEABLE_PARTS.renderPass.builtin.id, 'default');
  assert.deepEqual(Object.keys(REPLACEABLE_PARTS), PART_KINDS);
});

test('部件注册表：不合格候选会进拒绝记录，不会悄悄变成当前部件', async () => {
  const registry = new PartRegistry({ createRunner, approvals });
  const fake = renderPassPart(1, {
    selfTests: [{ name: '随便断言一下', world: { objects: [] }, expect: [{ id: 'fake.ok', kind: 'noErrors', why: '不报错就算过', red: '抛错' }] }],
  });
  const candidate = await registry.load(fake);
  assert.equal(candidate.status, 'rejected');
  assert.equal(registry.current('renderPass'), null);
  assert.equal(registry.rejected.length, 1);
  assert.match(registry.rejected[0].error, /空实现/);
});

test('浏览器侧部件表：注册、取用、重复、未知类型和回退默认都是显式的', () => {
  assert.deepEqual(PART_KINDS, ['renderPass', 'hudWidget', 'postProcess']);
  assert.equal(getPart('renderPass').run(), null);
  assert.equal(getPart('hudWidget').render(), null);
  assert.equal(getPart('postProcess')(7), 7);

  let calls = 0;
  const registered = registerPart('renderPass', 'counter-pass', () => ({ id: 'counter-pass', kind: 'renderPass', run() { calls += 1; return null; } }));
  assert.equal(registered.active, true);
  const part = getPart('renderPass');
  assert.equal(part.id, 'counter-pass');
  part.run();
  assert.equal(calls, 1);
  assert.equal(getPart('renderPass'), part, '工厂只应该被调用一次');
  assert.ok(listParts('renderPass').some(entry => entry.id === 'counter-pass' && entry.active));
  assert.throws(() => registerPart('renderPass', 'counter-pass', () => ({})), /已经注册/);
  assert.throws(() => registerPart('spritePass', 'x', () => ({})), /未知的部件类型/);
  assert.throws(() => registerPart('renderPass', 'Bad_ID', () => ({})), /部件 ID 无效/);
  assert.throws(() => registerPart('renderPass', 'no-factory'), /需要一个工厂函数/);
  assert.throws(() => getPart('spritePass'), /未知的部件类型/);
  assert.throws(() => usePart('renderPass', 'nope'), /没有注册/);

  const removed = unregisterPart('renderPass', 'counter-pass');
  assert.equal(removed.active, 'default');
  assert.equal(getPart('renderPass').run(), null, '卸载自定义部件后必须回退到内置默认');
  assert.throws(() => unregisterPart('renderPass', 'counter-pass'), /没有注册/);
  assert.throws(() => unregisterPart('renderPass', 'default'), /不允许卸载/);
  assert.equal(usePart('renderPass', 'default').active, true);
});
