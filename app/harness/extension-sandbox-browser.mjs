import { playwright, browserOptions } from '../browser-tools.mjs';

// 在隔离的游戏页里开一个扩展沙箱，Node 侧把每次 apply 代理进去。
// 只有游戏页的 CSP 允许 blob: worker，因此这里直接打开 /game，不依赖玩家窗口。
export async function withExtensionSandbox(origin, fn, { deadline = Date.now() + 120000 } = {}) {
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('缺少本机隔离检查地址');
  const { viewport, ...options } = browserOptions();
  let browser, timedOut = false, timer;
  const close = () => browser?.close().catch(() => {});
  try {
    timer = setTimeout(() => { timedOut = true; close(); }, Math.max(1, deadline - Date.now()));
    browser = await playwright().chromium.launch({ ...options, timeout: Math.max(1, deadline - Date.now()) });
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => { Element.prototype.requestPointerLock = () => { throw Error('后台验证禁止鼠标锁定'); }; window.focus = () => {}; });
    const page = await context.newPage();
    await page.goto(origin + '/game', { timeout: Math.max(1, deadline - Date.now()) });
    await page.waitForFunction(() => typeof window !== 'undefined', { timeout: Math.max(1, deadline - Date.now()) });

    const createRunner = extension => ({
      ready: page.evaluate(async ({ code, meta }) => {
        const { ExtensionRunner } = await import('/app/extension-runner.mjs');
        globalThis.__sandbox?.dispose();
        globalThis.__sandbox = new ExtensionRunner({ ...meta, code });
        await globalThis.__sandbox.ready;
        return true;
      }, { code: extension.code, meta: { id: extension.id, name: extension.name, description: extension.description || '', permissions: extension.permissions, targets: extension.targets || [], capabilities: extension.capabilities || [] } }),
      apply: payload => page.evaluate(async (_, value) => globalThis.__sandbox.apply(value), payload),
      dispose: () => page.evaluate(() => { globalThis.__sandbox?.dispose(); globalThis.__sandbox = null; }),
    });
    return await fn({ createRunner, page });
  } catch (error) {
    throw Error(timedOut ? '扩展沙箱启动超时' : `扩展沙箱失败：${error.message}`);
  } finally {
    clearTimeout(timer);
    await close();
  }
}
