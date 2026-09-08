import path from 'node:path';
import { workbench } from './workbench.mjs';
import { runSelfTests, stageExtension } from '../app/harness/extension-loader.mjs';

// 端到端：真实 Worker 沙箱跑扩展源码，宿主用内核规则校验它产出的效果。
// 沙箱必须跑在游戏页里（只有它允许 blob: worker）。
const EXTENSION = {
  format: 'craftmine.extension/1', id: 'life-steal', name: '吸血', version: 1,
  description: '命中时把伤害的一部分转成自己的生命',
  requires: [], permissions: ['targets.write', 'health.write', 'hud.message'], targets: ['zombie-1'],
  provides: { commands: [{ type: 'life.steal', permission: 'targets.write', scope: '声明过的 targets', fields: [{ name: 'targetId', description: '目标 ID' }, { name: 'amount', description: '吸血量 1..50' }] }], events: [] },
  lifecycle: { register: 'onLoad', unload: 'rejectModules' },
  code: `export function apply({ command }) {
  const amount = Math.max(1, Math.min(50, command.amount | 0));
  return { effects: [
    { type: 'target.damage', id: command.targetId, amount },
    { type: 'health.add', amount },
    { type: 'hud.message', text: '吸血 +' + amount },
  ], state: { lastAmount: amount } };
}`,
  selfTests: [{
    name: '吸血同时扣目标血量并回血',
    world: { playerHealth: 50, objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true, mesh: true, health: 40, solid: true }] },
    state: {}, commands: [{ type: 'life.steal', targetId: 'zombie-1', amount: 10 }],
    expect: [
      { id: 'life.damage', kind: 'objectHealth', why: '目标真的掉血', red: '不扣血的实现', object: 'zombie-1', min: 0, max: 30, step: 'command-1' },
      { id: 'life.heal', kind: 'playerHealth', why: '自己真的回血', red: '不回血的实现', min: 51, step: 'command-1' },
    ],
  }],
};

const PROBE = `export function apply() {
  const exposed = {};
  for (const name of ['document','window','fetch','XMLHttpRequest','WebSocket','Worker','setTimeout','setInterval','importScripts','indexedDB','postMessage','localStorage']) exposed[name] = typeof globalThis[name];
  let evalBlocked = false;
  try { Function('return 1')(); } catch (error) { evalBlocked = error.name === 'EvalError'; }
  return { effects: [], state: { ...exposed, evalBlocked: String(evalBlocked) } };
}`;

const w = await workbench('extension-browser');
try {
  const game = w.game().locator('body');
  const sandbox = await game.evaluate(async (_, { extension, probe }) => {
    const { ExtensionRunner } = await import('/app/extension-runner.mjs');
    const results = [];
    const world = { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true, solid: true, health: 40 }] };
    const command = { type: 'life.steal', targetId: 'zombie-1', amount: 10 };

    // 少声明 hud.message 权限：宿主必须拒绝这条效果，而不是放行。
    const strict = new ExtensionRunner({ ...extension, permissions: ['targets.write', 'health.write'], targets: ['zombie-1'], capabilities: [] });
    try { await strict.ready; results.push({ name: '沙箱能装载扩展并导出 apply', passed: true }); }
    catch (error) { results.push({ name: '沙箱能装载扩展并导出 apply', passed: false, detail: error.message }); }
    try {
      await strict.apply({ command, world, state: {} });
      results.push({ name: '未声明的权限必须被宿主拒绝', passed: false, detail: '居然通过了' });
    } catch (error) { results.push({ name: '未声明的权限必须被宿主拒绝', passed: /权限/.test(error.message), detail: error.message }); }
    strict.dispose();

    const probeRunner = new ExtensionRunner({ ...extension, permissions: ['targets.write', 'health.write'], targets: ['zombie-1'], capabilities: [], code: probe });
    try {
      await probeRunner.ready;
      const value = await probeRunner.apply({ command, world, state: {} });
      const apis = Object.entries(value.state).filter(([key]) => key !== 'evalBlocked');
      results.push({ name: '隔离环境里没有 DOM、网络、计时器和新 Worker', passed: apis.every(([, item]) => item === 'undefined') && value.state.evalBlocked === 'true', detail: JSON.stringify(value.state) });
    } catch (error) { results.push({ name: '隔离环境里没有 DOM、网络、计时器和新 Worker', passed: false, detail: error.message }); }
    probeRunner.dispose();

    const loopRunner = new ExtensionRunner({ ...extension, permissions: ['targets.write', 'health.write'], targets: ['zombie-1'], capabilities: [], code: 'export function apply() { while (true) {} }' }, { applyTimeoutMs: 120 });
    let timerWorked = false;
    const timer = setTimeout(() => { timerWorked = true; }, 20);
    try {
      await loopRunner.apply({ command, world, state: {} });
      results.push({ name: '死循环扩展被超时终止，页面仍然可响应', passed: false, detail: '没有超时' });
    } catch (error) {
      results.push({ name: '死循环扩展被超时终止，页面仍然可响应', passed: loopRunner.closed && timerWorked && /超时/.test(error.message), detail: error.message });
    } finally { clearTimeout(timer); loopRunner.dispose(); }

    const noExport = new ExtensionRunner({ ...extension, permissions: [], targets: [], capabilities: [], code: 'export const nothing = 1;' });
    try { await noExport.ready; results.push({ name: '缺少 apply 导出的扩展不能启用', passed: false }); }
    catch (error) { results.push({ name: '缺少 apply 导出的扩展不能启用', passed: /apply/.test(error.message), detail: error.message }); }
    return results;
  }, { extension: EXTENSION, probe: PROBE });
  for (const result of sandbox) w.check(result.name, result.passed, result.detail);

  // 自带测试用真实沙箱跑一遍：Node 侧判定，沙箱只负责执行。
  const createRunner = extension => ({
    ready: game.evaluate(async (_, { code, meta }) => {
      const { ExtensionRunner } = await import('/app/extension-runner.mjs');
      globalThis.__probe?.dispose();
      globalThis.__probe = new ExtensionRunner({ ...meta, code });
      await globalThis.__probe.ready;
      return true;
    }, { code: extension.code, meta: { id: 'probe', name: 'probe', description: 'probe', permissions: extension.permissions, targets: extension.targets || [], capabilities: extension.capabilities || [] } }),
    apply: payload => game.evaluate(async (_, value) => globalThis.__probe.apply(value), payload),
    dispose: () => game.evaluate(() => { globalThis.__probe?.dispose(); globalThis.__probe = null; }),
  });

  const selfTests = await runSelfTests(EXTENSION, { createRunner });
  w.check('真实沙箱里跑通自带测试，且空实现会被打红', selfTests.passed, selfTests.summary);

  const staged = await stageExtension(EXTENSION, { createRunner, verifyWorld: async () => ({ passed: true, summary: '冻结回归 10/10 通过' }) });
  w.check('真实沙箱 + 冻结回归都通过才拿到 ready', staged.status === 'ready', staged.error || staged.checks.map(check => check.detail).join(' / '));

  w.check('沙箱测试没有抢占鼠标锁定', await game.evaluate(() => document.pointerLockElement === null));
  w.check('沙箱故障没有变成页面未处理异常', w.errors.length === 0, w.errors.join(' / '));
} catch (error) {
  w.errors.push(error.stack);
  console.error(error);
  process.exitCode = 1;
} finally {
  await w.close();
  console.log('Report: ' + path.join(w.dir, 'report.json'));
}
