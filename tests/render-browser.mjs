import path from 'node:path';
import { workbench } from './workbench.mjs';

// 端到端：真实 Worker 沙箱跑渲染扩展源码，宿主用 ABI 校验它产出的 drawable。
// 全程没有鼠标/键盘输入：只用页面脚本调用模块，验证可观察结果。
const PARTICLES = {
  format: 'craftmine.render-extension/1', id: 'spark-particles', name: '火花粒子', version: 1,
  description: '在可见对象头顶冒火花，只影响画面',
  code: `export function emit({ world, time }) {
  return (world.objects || []).filter(object => object.visible).map((object, index) => ({
    kind: 'particle',
    position: { x: object.position.x, y: object.position.y + 1 + Math.sin(time * 4 + index) * 0.2, z: object.position.z },
    size: 0.12,
    ttl: 0.6,
    color: '#ffcc33',
  }));
}`,
  selfTests: [{
    name: '可见对象头顶真的冒出粒子',
    world: { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true }] },
    time: 1.5, dt: 0.016,
    expect: [{ id: 'spark.count', kind: 'step', why: '这一帧真的产出了粒子', red: '什么都不画的实现', label: 'emit-1', minCommands: 1 }],
  }],
};

const w = await workbench('render-browser');
try {
  const game = w.game().locator('body');
  const results = await game.evaluate(async (_, { extension }) => {
    const { RenderRunner } = await import('/app/render-runner.mjs');
    const { NOOP_RENDER_CODE, RenderExtensionRegistry, validateDrawables } = await import('/app/harness/render-extension.mjs');
    const results = [];
    const check = (name, passed, detail) => results.push({ name, passed: passed === true, detail: detail === undefined ? '' : String(detail).slice(0, 300) });
    const world = { objects: [{ id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true, solid: true }] };

    // (a) 真实粒子扩展在 Worker 里装载并产出合法 drawable
    const runner = new RenderRunner(extension, { emitTimeoutMs: 800 });
    try { await runner.ready; check('粒子渲染扩展能在真实 Worker 里装载', true); }
    catch (error) { check('粒子渲染扩展能在真实 Worker 里装载', false, error.message); }
    const drawables = await runner.emit({ world, time: 0.5, dt: 0.016 });
    check('真实沙箱产出的 drawable 通过宿主校验', Array.isArray(drawables) && drawables.length >= 1 && drawables.every(drawable => drawable.kind === 'particle'), JSON.stringify(drawables));

    const noopRunner = new RenderRunner({ ...extension, code: NOOP_RENDER_CODE }, { emitTimeoutMs: 800 });
    await noopRunner.ready;
    const none = await noopRunner.emit({ world, time: 0.5, dt: 0.016 });
    check('空实现在同一份世界快照下产出零个 drawable', Array.isArray(none) && none.length === 0, JSON.stringify(none));
    noopRunner.dispose();

    // 缺 emit 导出必须装载失败，并且中文报错点名 emit
    const brokenRunner = new RenderRunner({ ...extension, code: 'export const nothing = 1;' }, { emitTimeoutMs: 800 });
    let brokenMessage = '';
    try { await brokenRunner.ready; } catch (error) { brokenMessage = error.message; }
    check('缺少 emit 导出的渲染扩展不能启用', /emit/.test(brokenMessage) && brokenRunner.disabled === true, brokenMessage);

    // (b) 死循环 emit：单次超时不杀沙箱，到达 maxFailures 才停用，页面保持可响应
    const loopRunner = new RenderRunner({ ...extension, maxFailures: 2, code: 'export function emit() { while (true) {} }' }, { emitTimeoutMs: 150 });
    let timerWorked = false;
    const timer = setTimeout(() => { timerWorked = true; }, 20);
    try { await loopRunner.ready; } catch (error) { check('死循环扩展的装载本身不应失败', false, error.message); }
    const first = await loopRunner.emit({ world, time: 1, dt: 0.016 });
    check('第一次超时只记一次失败，没有立刻停用', loopRunner.failures === 1 && loopRunner.disabled === false && Array.isArray(first) && first.length === 0, `failures=${loopRunner.failures} disabled=${loopRunner.disabled}`);
    const second = await loopRunner.emit({ world, time: 2, dt: 0.016 });
    const third = await loopRunner.emit({ world, time: 3, dt: 0.016 });
    clearTimeout(timer);
    check('到达失败上限后自动停用，之后每次 emit 都返回空数组', loopRunner.disabled === true && second.length === 0 && third.length === 0, `failures=${loopRunner.failures} disabled=${loopRunner.disabled}`);
    check('死循环期间页面仍然可响应，也没有抢占鼠标锁定', timerWorked && document.pointerLockElement === null, `timer=${timerWorked}`);
    loopRunner.dispose();

    // (c) 越界 drawable 被 validateDrawables 拒绝
    let rejected = '';
    try { validateDrawables([{ kind: 'particle', position: { x: 100, y: 6, z: 0 }, size: 0.1, ttl: 1, color: '#ffffff' }]); }
    catch (error) { rejected = error.message; }
    const badRunner = new RenderRunner({ ...extension, maxFailures: 1, code: "export function emit() { return [{ kind: 'particle', position: { x: 100, y: 6, z: 0 }, size: 0.1, ttl: 1, color: '#ffffff' }]; }" }, { emitTimeoutMs: 800 });
    await badRunner.ready;
    const bad = await badRunner.emit({ world, time: 1, dt: 0.016 });
    check('越界 drawable 被宿主拒绝并停用该扩展', /超出世界范围/.test(rejected) && badRunner.disabled === true && bad.length === 0, rejected);
    badRunner.dispose();

    // (d) 注册表：装载两个版本后回退到 v1
    const registry = new RenderExtensionRegistry({ createRunner: item => new RenderRunner(item, { emitTimeoutMs: 800 }), verifyWorld: async () => ({ passed: true, summary: '冻结回归通过' }) });
    const v1 = await registry.stage(extension);
    if (v1.status === 'ready') registry.activate(v1);
    const v2 = await registry.stage({ ...extension, version: 2, name: '火花粒子·改', code: extension.code.replace('#ffcc33', '#33ccff') });
    if (v2.status === 'ready') registry.activate(v2);
    const rolled = registry.rollback('spark-particles');
    check('注册表装载两个版本后能回退到 v1', v1.status === 'ready' && v2.status === 'ready' && rolled.activated === 'render:spark-particles@1' && registry.loaded[0].version === 1, `${v1.status}/${v2.status}/${rolled.activated}`);

    // 世界运行时集成：drawable 真的变成网格
    const { makeWorldRuntime } = await import('/app/world-runtime.mjs');
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const Runtime = makeWorldRuntime({ send: () => {}, inform: () => {}, enter: document.getElementById('enter') });
    const engine = new Runtime(canvas, {});
    engine.setActive(false);
    engine.objects = new Map([['zombie-1', { id: 'zombie-1', position: { x: 0, y: 6, z: 0 }, visible: true }]]);
    engine.primitives = [];
    const meshRunner = new RenderRunner(extension, { emitTimeoutMs: 800 });
    await meshRunner.ready;
    engine.setRenderExtensions([{ id: 'spark-particles', runner: meshRunner }]);
    engine.render(1);
    let mesh = null;
    for (let i = 0; i < 40 && !mesh; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 25));
      mesh = engine.meshes.get('ext:spark-particles') || null;
    }
    check('世界运行时把渲染扩展的 drawable 上传成网格', Boolean(mesh) && mesh.count > 0, JSON.stringify({ count: mesh?.count ?? null, failures: engine.partFailures || [], extensionErrors: engine.renderExtensionErrors || [] }));
    engine.render(2);
    check('渲染扩展没有变成碰撞体或存档内容', (engine.primitives || []).length === 0 && !engine.play);
    engine.dispose();
    canvas.remove();

    runner.dispose();
    return results;
  }, { extension: PARTICLES });
  for (const result of results) w.check(result.name, result.passed, result.detail);

  w.check('渲染扩展验证没有抢占鼠标锁定', await game.evaluate(() => document.pointerLockElement === null));
  w.check('渲染扩展故障没有变成页面未处理异常', w.errors.length === 0, w.errors.join(' / '));
} catch (error) {
  w.errors.push(error.stack);
  console.error(error);
  process.exitCode = 1;
} finally {
  await w.close();
  console.log('Report: ' + path.join(w.dir, 'report.json'));
}
