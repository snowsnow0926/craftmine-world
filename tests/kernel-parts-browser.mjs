import path from 'node:path';
import { workbench } from './workbench.mjs';
import { EMPTY_SCENE, INITIAL_SNAPSHOT, compileScene } from '../app/scene.mjs';

// 端到端：游戏页里真的注册一个渲染通道，world-runtime 每帧调用它；卸载后回到内置默认。
// 只用页面脚本和模块 API 验证，没有鼠标/键盘输入，也没有抢占指针锁。
const w = await workbench('kernel-parts-browser');
let probe;
try {
  const build = compileScene(EMPTY_SCENE);
  probe = await w.page.context().newPage();
  probe.on('pageerror', error => w.errors.push(error.message));
  await probe.goto(new URL('/verify', w.page.url()).href);
  const results = await probe.frameLocator('iframe').locator('body').evaluate(async (_, { build, spawn }) => {
    const { makeWorldRuntime } = await import('/app/world-runtime.mjs');
    const parts = await import('/app/harness/parts.mjs');
    const results = [];
    const check = (name, passed, detail) => results.push({ name, passed: passed === true, detail: detail === undefined ? '' : String(detail).slice(0, 300) });
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const Runtime = makeWorldRuntime({ send: () => {}, inform: () => {}, enter: document.getElementById('enter') });
    const engine = new Runtime(canvas, {});
    try {
      engine.setActive(false);
      await engine.generateBuild(build, spawn);
      check('内置默认渲染通道什么都不做', parts.getPart('renderPass').run() === null && parts.getPart('hudWidget').render() === null && parts.getPart('postProcess')(5) === 5);

      let passCalls = 0;
      parts.registerPart('renderPass', 'counter-pass', () => ({
        id: 'counter-pass', kind: 'renderPass',
        run({ primitives, objects }) { passCalls += 1; return { primitives: primitives.length, objects: objects.length }; },
      }));
      engine.render(1);
      engine.render(2);
      check('游戏页注册的渲染通道被世界运行时每帧调用', passCalls >= 2, `calls=${passCalls}`);

      let widgetCalls = 0;
      parts.registerPart('hudWidget', 'counter-widget', () => ({ id: 'counter-widget', kind: 'hudWidget', render() { widgetCalls += 1; return null; } }));
      engine.updateHud();
      check('HUD 更新路径调用注册的 HUD 部件', widgetCalls >= 1, `calls=${widgetCalls}`);

      const beforePass = passCalls, beforeWidget = widgetCalls;
      parts.unregisterPart('renderPass', 'counter-pass');
      parts.unregisterPart('hudWidget', 'counter-widget');
      engine.render(3);
      engine.updateHud();
      check('卸载部件后恢复默认、不再调用且没有报错', passCalls === beforePass && widgetCalls === beforeWidget && parts.getPart('renderPass').run() === null && !(engine.partFailures || []).length, JSON.stringify({ passCalls, widgetCalls, failures: engine.partFailures || [] }));

      let injected = 0;
      engine.useRenderPass({ run() { injected += 1; } });
      engine.render(4);
      engine.useRenderPass(null);
      check('useRenderPass 显式注入的通道优先被调用', injected === 1, `calls=${injected}`);

      engine.useRenderPass({ run() { throw Error('坏通道'); } });
      engine.render(5);
      engine.useRenderPass(null);
      check('坏掉的渲染通道被记录，但不会打断画面', (engine.partFailures || []).includes('坏通道'), JSON.stringify(engine.partFailures || []));
      return results;
    } finally { engine.dispose(); canvas.remove(); }
  }, { build, spawn: INITIAL_SNAPSHOT });
  for (const result of results) w.check(result.name, result.passed, result.detail);
  w.check('内核部件验证没有抢占鼠标锁定', await probe.frameLocator('iframe').locator('body').evaluate(() => document.pointerLockElement === null));
  w.check('内核部件验证没有产生页面异常', w.errors.length === 0, w.errors.join(' / '));
} catch (error) {
  w.errors.push(error.stack);
  console.error(error);
  process.exitCode = 1;
} finally {
  await probe?.close();
  await w.close();
  console.log('Report: ' + path.join(w.dir, 'report.json'));
}
