/**
 * R2 · the left column's auxiliary entries reach the real world panel.
 *
 * Real navigation gateway (craftmine-navigation-host) -> real retained plugin
 * view (craftmineView.showSurface) -> real craftmine.world plugin -> real Rust
 * core. No OS input; the page is driven with page.evaluate only, and pointer
 * lock plus focus are audited on every page.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync, fork} from "node:child_process";
import {register} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";
import {playwright, browserOptions} from "../../../app/browser-tools.mjs";
import {desktopRuntimePaths} from "../../helpers/desktop-runtime-paths.mjs";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
const dir = fs.mkdtempSync(path.join(root, "test-results/godot-round2-r2-surface-"));
const report = {kind: "real-gateway-and-retained-view-surface-navigation", sourceCommit: null, checks: [], errors: [],
  limits: ["Panel surfaces only; no candidate build, no model call, no visible-window composition."]};
const check = (name, value, detail) => {
  report.checks.push({name, passed: !!value, ...(detail ? {detail} : {})});
  assert.ok(value, name);
  console.log("PASS " + name);
};

const {desktop, plugin, hostEntry} = desktopRuntimePaths(dir);
if (!fs.existsSync(path.join(plugin, "main.cjs"))) {
  execFileSync(process.execPath, ["desktop/build-world-plugin.mjs"], {cwd: root, stdio: "inherit"});
}
let binary = process.env.CRAFTMINE_CORE_BIN || path.join(root, "vendor/pi-desktop/target/release/craftmine-core.exe");
if (!fs.existsSync(binary)) throw new Error("build craftmine-core first or set CRAFTMINE_CORE_BIN");
const crypto = await import("node:crypto");
report.engine = {coreSha256: crypto.createHash("sha256").update(fs.readFileSync(binary)).digest("hex")};

const previousDataDir = process.env.PI_DESKTOP_DATA_DIR;
process.env.PI_DESKTOP_DATA_DIR = path.join(dir, "pi-host");
register(pathToFileURL(path.join(desktop, "test/helpers/ts-import-hooks.mjs")));
const {PluginRuntime} = await import(pathToFileURL(path.join(desktop, "electron/main/plugin-runtime.ts")).href);
const {invokeCraftmineNavigation} = await import(
  pathToFileURL(path.join(desktop, "electron/main/craftmine-navigation-host.ts")).href
);
const {createCraftminePanelGateway} = await import(
  pathToFileURL(path.join(desktop, "electron/main/craftmine-panel-gateway.ts")).href
);

// The real main-process panel gateway. Only the session-bound operations are
// stubbed: this scenario has no chat task, so they must never run.
let pluginRuntime;
const craftminePanelRequest = createCraftminePanelGateway({
  viewingSession: () => null,
  session: async () => null,
  activeTurn: () => undefined,
  domain: (method, params) => pluginRuntime.requestCraftmineHost(method, params),
  begin: async () => { throw new Error("HOST_SESSION_REQUIRED"); },
  end: async () => { throw new Error("HOST_SESSION_REQUIRED"); },
  stop: async () => { throw new Error("HOST_SESSION_REQUIRED"); },
  resume: async () => { throw new Error("HOST_SESSION_REQUIRED"); },
  interrupt: async () => { throw new Error("HOST_SESSION_REQUIRED"); },
  backup: async () => { throw new Error("BACKUP_UNAVAILABLE"); },
  diagnostics: async () => { throw new Error("DIAGNOSTICS_UNAVAILABLE"); },
});

const runtime = new PluginRuntime({
  hostEntry,
  craftminePanelRequest,
  spawnProcess: ({entry}) => {
    const child = fork(entry, [], {windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {...process.env, CRAFTMINE_CORE_BIN: binary}});
    return {
      postMessage: (message) => { if (child.connected) child.send(message); },
      onMessage: (handler) => child.on("message", handler),
      onExit: (handler) => child.on("exit", (code) => handler(code ?? 0)),
      kill: () => child.kill(),
    };
  },
});
pluginRuntime = runtime;
const panel = (channel, payload = {}) => runtime.invokePanelBridge("craftmine.world", channel, payload);

let browser;
try {
  await runtime.loadFromPath(plugin, ["ui.view", "agent.tool.register", "background.service"]);
  const world = await panel("world.create", {title: "界面接线世界"});

  browser = await playwright().chromium.launchPersistentContext(path.join(dir, "profile"), browserOptions());
  await browser.addInitScript(() => {
    globalThis.__inputRequests = 0;
    Element.prototype.requestPointerLock = () => { globalThis.__inputRequests++; throw Error("Pointer lock disabled"); };
    window.focus = () => { globalThis.__inputRequests++; };
    globalThis.pluginBridge = {invoke: (channel, payload) => globalThis.__craftmineBridge(channel, payload)};
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.exposeBinding("__craftmineBridge", async (source, channel, payload) => {
    if (source.frame !== page.mainFrame()) throw Error("Only the trusted panel may invoke the bridge");
    return panel(channel, payload);
  });
  await page.goto(pathToFileURL(path.join(plugin, "views/world.html")).href);
  await page.waitForFunction((id) => document.body.dataset.worldLoaded === "true" && document.body.dataset.worldId === id, world.id, {timeout: 15000});

  const gateway = (channel, payload) => invokeCraftmineNavigation({pluginId: "craftmine.world", channel, payload}, {
    invoke: (name, params) => panel(name, params),
    navigate: (request) => page.evaluate((value) => craftmineView.navigate(value), request),
    showSurface: (request) => page.evaluate((value) => craftmineView.showSurface(value), request),
  });

  const workbench = await gateway("world.surface", {surface: {kind: "workbench", tab: "library"}, section: "works"});
  check("作品入口打开真实工作台标签", workbench.ok === true && workbench.tab === "library", workbench);
  check("工作台标签在真实页面中被选中",
    await page.evaluate(() => document.querySelector('[data-workbench-tab="library"]').getAttribute("aria-selected") === "true"));
  check("打开工作台时原生世界视图被隐藏",
    await page.evaluate(() => document.getElementById("workbench-panel").hidden === false));

  const checks = await gateway("world.surface", {surface: {kind: "checks"}, section: "checks"});
  check("检查入口切回检查视图", checks.ok === true && checks.shown === "checks", checks);
  check("检查视图在真实页面中可见", await page.evaluate(() => !document.getElementById("checks-panel").hidden));

  const back = await gateway("world.surface", {surface: {kind: "world"}, section: "assets"});
  check("世界入口回到世界视图", back.ok === true && back.shown === "world", back);
  check("世界视图恢复显示", await page.evaluate(() => document.getElementById("checks-panel").hidden === true));

  await assert.rejects(gateway("world.surface", {surface: {kind: "workbench", tab: "not-a-tab"}}), /UNKNOWN_WORKBENCH_TAB/);
  check("未知标签被真实拒绝而不是打开别的面板",
    await page.evaluate(() => document.querySelector('[data-workbench-tab="library"]').getAttribute("aria-selected") === "false"));
  await assert.rejects(gateway("world.surface", {surface: {kind: "workbench", tab: "../evil"}}), /INVALID_SURFACE_REQUEST/);
  await assert.rejects(gateway("world.surface", {surface: {kind: "nope"}}), /INVALID_SURFACE_REQUEST/);
  await assert.rejects(gateway("task.resume", {taskId: "t"}), /PERMISSION_DENIED/);
  check("渲染进程仍不能直接调用任务恢复", true);
  const recoverable = await gateway("task.recoverable", {worldId: world.id});
  check("任务行可以读取真实可接续草稿", Array.isArray(recoverable.items), recoverable);

  // Asset reads pass the navigation allowlist and the main-process panel
  // gateway; the plugin service that answers them is R6's still-unregistered
  // half, so the real host refuses with its own code instead of a fake list.
  const asset = await gateway("asset.search", {worldId: world.id, scope: "local-library", offset: 0, limit: 5})
    .then((value) => ({ok: true, value}))
    .catch((error) => ({ok: false, code: error.code ?? "", message: String(error.message)}));
  check("素材读取到达插件服务层并报告真实未注册", asset.ok === false
    && /UNKNOWN_WORKBENCH_CHANNEL|PLUGIN_CALL_FAILED/.test(`${asset.code} ${asset.message}`), asset);

  check("没有请求鼠标锁定或焦点", await page.evaluate(() => __inputRequests === 0));
  check("页面没有未处理异常", pageErrors.length === 0, pageErrors);
  await page.screenshot({path: path.join(dir, "surface.png")});
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser?.close();
  for (const loaded of runtime.listLoaded()) await runtime.unload(loaded.manifest.id);
  if (previousDataDir === undefined) delete process.env.PI_DESKTOP_DATA_DIR;
  else process.env.PI_DESKTOP_DATA_DIR = previousDataDir;
  report.sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log("Evidence: " + dir);
}
