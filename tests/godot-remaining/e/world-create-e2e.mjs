/**
 * E dispatch · world creation through the real product path.
 *
 * Real React world panel -> real navigation gateway (craftmine-navigation-host)
 * -> real retained plugin view (craftmineView.navigate) -> real craftmine.world
 * plugin -> real Rust core binary. Only the desktop app store and the i18n hook
 * are fixture stand-ins; no world data is invented anywhere.
 *
 * No OS input is sent: the panel is driven with page.evaluate DOM calls
 * (requestSubmit / element.click / dispatchEvent) and every page asserts that
 * requestPointerLock and focus were never called.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync, fork} from "node:child_process";
import {createRequire, register} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";
import {playwright, browserOptions} from "../../../app/browser-tools.mjs";
import {desktopRuntimePaths} from "../../helpers/desktop-runtime-paths.mjs";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
const dir = fs.mkdtempSync(path.join(root, "test-results/godot-remaining-e-create-"));
const report = {
  kind: "real-react-panel-with-real-plugin-and-rust",
  sourceCommit: null,
  engine: null,
  checks: [],
  errors: [],
  limits: [
    "Fixture stand-ins: desktop app store and react-i18next only.",
    "The host currently reports only the web voxel base as delivered, so a Godot base creation cannot be exercised here.",
    "No real model call, no installer and no visible-window composition.",
  ],
};
const check = (name, value, detail) => {
  report.checks.push({name, passed: !!value, ...(detail ? {detail} : {})});
  assert.ok(value, name);
  console.log("PASS " + name);
};

const slash = (value) => value.replaceAll("\\", "/");
const {desktop, plugin, hostEntry} = desktopRuntimePaths(dir);
if (!fs.existsSync(path.join(plugin, "main.cjs"))) {
  // The built plugin is a generated artifact; reproduce it the documented way.
  execFileSync(process.execPath, ["desktop/build-world-plugin.mjs"], {cwd: root, stdio: "inherit"});
}
// Prefer a core built in this worktree; otherwise reuse the identical release
// binary from the primary checkout and record its hash as evidence.
let binary = process.env.CRAFTMINE_CORE_BIN || path.join(root, "vendor/pi-desktop/target/release/craftmine-core.exe");
if (!fs.existsSync(binary)) {
  const fallback = "D:/Craftmine World/vendor/pi-desktop/target/release/craftmine-core.exe";
  if (!fs.existsSync(fallback)) throw new Error("craftmine-core.exe not found; build it or set CRAFTMINE_CORE_BIN");
  binary = fallback;
}
const crypto = await import("node:crypto");
report.engine = {
  coreBinary: binary,
  coreSha256: crypto.createHash("sha256").update(fs.readFileSync(binary)).digest("hex"),
};

const previousDataDir = process.env.PI_DESKTOP_DATA_DIR;
process.env.PI_DESKTOP_DATA_DIR = path.join(dir, "pi-host");
register(pathToFileURL(path.join(desktop, "test/helpers/ts-import-hooks.mjs")));
const {PluginRuntime} = await import(pathToFileURL(path.join(desktop, "electron/main/plugin-runtime.ts")).href);
const {invokeCraftmineNavigation} = await import(
  pathToFileURL(path.join(desktop, "electron/main/craftmine-navigation-host.ts")).href
);

const runtime = new PluginRuntime({
  hostEntry,
  spawnProcess: ({entry}) => {
    const child = fork(entry, [], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {...process.env, CRAFTMINE_CORE_BIN: binary},
    });
    return {
      postMessage: (message) => { if (child.connected) child.send(message); },
      onMessage: (handler) => child.on("message", handler),
      onExit: (handler) => child.on("exit", (code) => handler(code ?? 0)),
      kill: () => child.kill(),
    };
  },
});
const panel = (channel, payload = {}) => runtime.invokePanelBridge("craftmine.world", channel, payload);

// Build the real panel components. Only the desktop store and i18n hook are
// replaced, exactly as tests/batch07-desktop/layout-headless.mjs does.
const require = createRequire(path.join(desktop, "package.json"));
const {build} = createRequire(path.join(root, "vendor/pi-desktop/packages/agent-runtime/package.json"))("esbuild");
const out = path.join(dir, "panel");
fs.mkdirSync(out, {recursive: true});
const entry = path.join(out, "fixture.jsx");
fs.writeFileSync(entry, `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useCraftmineWorlds} from ${JSON.stringify(slash(path.join(desktop, "src/hooks/use-craftmine-worlds.ts")))};
import {WorldListPanel} from ${JSON.stringify(slash(path.join(desktop, "src/components/craftmine/WorldListPanel.tsx")))};
import {WorldAuxSections} from ${JSON.stringify(slash(path.join(desktop, "src/components/craftmine/WorldAuxSections.tsx")))};
import {CraftmineLayoutControls} from ${JSON.stringify(slash(path.join(desktop, "src/components/CraftmineLayoutControls.tsx")))};
function Fixture(){
  const controller=useCraftmineWorlds('zh');
  window.__controller=controller;
  const openSurface=(surface,section)=>window.dispatchEvent(new CustomEvent('craftmine-aux-open',{detail:{surface,section}}));
  return <nav className="craftmine-navigation">
    <WorldListPanel controller={controller} lang="zh" onOpenWorld={()=>{}}/>
    <WorldAuxSections controller={controller} lang="zh" onOpenSurface={openSurface}/>
    <CraftmineLayoutControls/>
  </nav>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`);
await build({
  entryPoints: [entry],
  outfile: path.join(out, "fixture.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: {
    react: require.resolve("react"),
    "react-dom/client": require.resolve("react-dom/client"),
    "react/jsx-runtime": require.resolve("react/jsx-runtime"),
  },
  plugins: [{
    name: "bounded-store-fixture",
    setup(builder) {
      builder.onResolve({filter: /stores\/app-store$/}, () => ({path: "store", namespace: "fixture"}));
      builder.onResolve({filter: /^react-i18next$/}, () => ({path: "i18n", namespace: "fixture"}));
      builder.onLoad({filter: /.*/, namespace: "fixture"}, (args) => ({
        loader: "js",
        contents: args.path === "i18n"
          ? `export const useTranslation=()=>({i18n:{language:'zh-CN'}});`
          : `import {useSyncExternalStore} from "react";const listeners=new Set();export const state={workPanelWidth:480,page:'chat',activeSessionId:'kept-session',tabs:[],setPage(value){this.page=value;},openWorkPanelTab(tab){if(!this.tabs.includes(tab.id))this.tabs.push(tab.id);},setWorkPanelWidth(width){this.workPanelWidth=width;for(const fn of listeners)fn();}};export const useAppStore=selector=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>selector(state));useAppStore.getState=()=>state;window.testStore=state;`,
      }));
    },
  }],
});
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
:root{--ds-text-secondary:#b5beb8;--ds-text-primary:#eff7f0;--ds-text-muted:#8b948f;--ds-bg-active:#284235;--ds-tile:#202020;--ds-bg:#191919;--ds-border-subtle:#333;--ds-danger:#e5534b;--ds-focus:#5aa06f;--radius-xs:6px;--text-2xs:12px;--text-md:14px;--ds-sidebar-width:260px;--ds-toolbar-height:44px}
body{margin:0;background:#191919;color:#eee;font:14px system-ui}.craftmine-navigation{width:260px;height:100vh;overflow:auto;padding:8px}
</style><style>${fs.readFileSync(path.join(desktop, "src/styles/craftmine.css"), "utf8")}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);

let browser;
try {
  await runtime.loadFromPath(plugin, ["ui.view", "agent.tool.register", "background.service"]);
  const options = await panel("world.createOptions");
  report.createOptions = options;

  const first = await panel("world.create", {title: "林间小屋"});
  check("真实插件与 Rust 登记了第一个世界", !!first?.id && first.title === "林间小屋");

  browser = await playwright().chromium.launchPersistentContext(path.join(dir, "profile"), browserOptions());
  // Both globals are installed on every page: the panel uses the world bridge,
  // the retained view uses pluginBridge. Neither sends real input.
  await browser.addInitScript(() => {
    globalThis.__inputRequests = 0;
    Element.prototype.requestPointerLock = () => { globalThis.__inputRequests++; throw Error("Pointer lock disabled"); };
    window.focus = () => { globalThis.__inputRequests++; };
    globalThis.__craftmineWorldBridge = {
      invoke: (pluginId, channel, payload) => globalThis.__hostInvoke(pluginId, channel, payload),
      onChanged: (listener) => { globalThis.__worldChanged = listener; return () => { globalThis.__worldChanged = null; }; },
    };
    globalThis.pluginBridge = {invoke: (channel, payload) => globalThis.__craftmineBridge(channel, payload)};
  });

  // Page A: the real retained plugin view. Its navigate() owns save+create+switch.
  const viewPage = await browser.newPage();
  const viewErrors = [];
  viewPage.on("pageerror", (error) => viewErrors.push(error.message));
  await viewPage.exposeBinding("__craftmineBridge", async (source, channel, payload) => {
    if (source.frame !== viewPage.mainFrame()) throw Error("Only the trusted panel may invoke the bridge");
    return panel(channel, payload);
  });
  await viewPage.goto(pathToFileURL(path.join(plugin, "views/world.html")).href);
  await viewPage.waitForFunction((id) => document.body.dataset.worldLoaded === "true" && document.body.dataset.worldId === id, first.id, {timeout: 15000});
  check("保留的世界视图已加载真实 Rust 世界", (await viewPage.evaluate(() => craftmineView.snapshot())).snapshot.player.x === 0.5);

  // Page B: the real React panel, bridged through the real navigation gateway.
  const panelPage = await browser.newPage();
  const panelErrors = [];
  panelPage.on("pageerror", (error) => panelErrors.push(error.message));
  await panelPage.exposeBinding("__hostInvoke", async (source, pluginId, channel, payload) => {
    if (source.frame !== panelPage.mainFrame()) throw Error("Only the panel page may invoke the host");
    return invokeCraftmineNavigation({pluginId, channel, payload}, {
      invoke: (channel2, payload2) => panel(channel2, payload2),
      // The production gateway routes mutations into the retained world view.
      navigate: (request) => viewPage.evaluate((value) => craftmineView.navigate(value), request),
    });
  });
  await panelPage.goto(pathToFileURL(path.join(out, "index.html")).href);
  await panelPage.waitForFunction(() => document.querySelectorAll("[data-world-id]").length > 0, {timeout: 15000});

  const rows = () => panelPage.evaluate(() => [...document.querySelectorAll("[data-world-id]")].map((row) => ({
    id: row.dataset.worldId,
    state: row.dataset.worldState,
    playable: row.dataset.worldPlayable,
    active: row.dataset.worldActive,
    disabled: row.disabled,
    text: row.textContent,
  })));
  const listed = await rows();
  check("React 面板列出真实 Rust 世界", listed.length === 1 && listed[0].text.includes("林间小屋"), listed);
  check("已初始化世界标记为可游玩", listed[0].state === "ready" && listed[0].playable === "true" && listed[0].disabled === false);
  // The core now reports the base of a created world, so the row must show the
  // host's real label instead of the "not reported" fallback.
  check("面板显示主机上报的底座标签", listed[0].text.includes("网页体素"), listed);

  // The host reports only the web base as delivered; a planned base must never
  // become selectable even if the host lists it.
  await panelPage.evaluate(() => document.querySelector("[data-action='new-world']").click());
  await panelPage.waitForFunction(() => !!document.querySelector("[data-world-create='form']"));
  const baseOptions = await panelPage.evaluate(() => [...document.querySelectorAll("[data-world-base-option]")].map((label) => ({
    id: label.dataset.worldBaseOption,
    delivered: label.dataset.worldBaseDelivered,
    disabled: label.querySelector("input").disabled,
  })));
  check("创建面板只允许已交付底座被选中", baseOptions.length > 0 && baseOptions.every((base) => base.delivered === "true" && base.disabled === false), baseOptions);
  check("创建面板不伪造未交付底座", baseOptions.every((base) => base.id === "craftmine-web/5"), baseOptions);

  // Create a second world through the real form -> gateway -> view -> plugin -> Rust.
  // React tracks input values with a native setter, so the value must be written
  // through the prototype setter for onChange to see it (no OS input involved).
  await panelPage.evaluate(() => {
    const input = document.querySelector("[data-world-create='name']");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "海边花园");
    input.dispatchEvent(new Event("input", {bubbles: true}));
    document.querySelector("[data-world-create='form']").requestSubmit();
  });
  try {
    await viewPage.waitForFunction((id) => document.body.dataset.worldLoaded === "true" && document.body.dataset.worldId !== id, first.id, {timeout: 20000});
  } catch (error) {
    const state = await panelPage.evaluate(() => ({
      error: window.__controller?.error ?? null,
      notice: window.__controller?.notice ?? null,
      title: document.querySelector("[data-world-create='name']")?.value ?? null,
      form: !!document.querySelector("[data-world-create='form']"),
    }));
    throw new Error(`create did not reach the view: ${JSON.stringify(state)} :: ${error.message}`);
  }
  const secondId = await viewPage.evaluate(() => document.body.dataset.worldId);
  await panelPage.waitForFunction((id) => [...document.querySelectorAll("[data-world-id]")].some((row) => row.dataset.worldId === id), secondId, {timeout: 15000});
  const afterCreate = await rows();
  const secondRow = afterCreate.find((row) => row.id === secondId);
  check("表单创建的世界经真实网关登记并可在面板中看到", !!secondRow && secondRow.text.includes("海边花园"), afterCreate);
  check("新建世界在真实初始化完成后才可游玩", secondRow.state === "ready" && secondRow.playable === "true", secondRow);
  check("保留视图已切换到真实新世界", (await viewPage.evaluate(() => craftmineView.snapshot())).snapshot.player.x === 0.5);
  const rustList = await panel("world.list");
  check("Rust 中确实存在两个世界", rustList.worlds.length === 2 && rustList.worlds.some((world) => world.id === secondId));
  check("新建世界写入标题与真实选择", rustList.worlds.find((world) => world.id === secondId).title === "海边花园" && rustList.activeWorldId === secondId);

  // Switch back through the panel row, not through a raw channel.
  await panelPage.evaluate((id) => {
    const row = [...document.querySelectorAll("[data-world-id]")].find((item) => item.dataset.worldId === id);
    row.click();
  }, first.id);
  await viewPage.waitForFunction((id) => document.body.dataset.worldLoaded === "true" && document.body.dataset.worldId === id, first.id, {timeout: 20000});
  await panelPage.waitForFunction((id) => [...document.querySelectorAll("[data-world-id]")].some((row) => row.dataset.worldId === id && row.dataset.worldActive === "true"), first.id, {timeout: 15000});
  const afterSwitch = await rows();
  check("面板切换世界调用真实受管理切换", afterSwitch.find((row) => row.id === first.id).active === "true");
  check("切换不改动另一个世界的真实身份", (await panel("world.list")).worlds.length === 2);

  // Layout: play/create toggle and the new reset action on real components.
  await panelPage.evaluate(() => {
    const forms = [...document.querySelectorAll(".craftmine-layout-controls form")];
    forms[1].requestSubmit();
  });
  await panelPage.waitForFunction(() => document.querySelector("[data-craftmine-layout]").dataset.craftmineLayout === "play", {timeout: 5000});
  const play = await panelPage.evaluate(() => ({
    mode: document.querySelector("[data-craftmine-layout]").dataset.craftmineLayout,
    width: testStore.workPanelWidth,
  }));
  check("游玩模式使用真实保存的宽度", play.mode === "play" && play.width === 720, play);
  await panelPage.evaluate(() => { testStore.setWorkPanelWidth(670); });
  await panelPage.evaluate(() => document.querySelector("[data-action='reset-layout']").click());
  await panelPage.waitForFunction(() => testStore.workPanelWidth === 720, {timeout: 5000});
  const reset = await panelPage.evaluate(() => ({
    mode: document.querySelector("[data-craftmine-layout]").dataset.craftmineLayout,
    width: testStore.workPanelWidth,
    stored: JSON.parse(localStorage.getItem("craftmine.desktop.layout.v1")),
  }));
  check("恢复默认布局写回文档默认值且保留当前模式", reset.mode === "play" && reset.width === 720 && reset.stored.widths.create === 480 && reset.stored.chatWidth === 400, reset);

  check("两个页面都没有请求鼠标锁定或焦点",
    (await Promise.all([viewPage, panelPage].map((page) => page.evaluate(() => globalThis.__inputRequests || 0)))).every((count) => count === 0));
  check("后台页面没有未处理异常", viewErrors.length === 0 && panelErrors.length === 0, {viewErrors, panelErrors});

  // Full plugin + core restart: the panel must list the real durable worlds.
  await viewPage.close();
  await runtime.unload("craftmine.world");
  await runtime.loadFromPath(plugin, ["ui.view", "agent.tool.register", "background.service"]);
  const restarted = await panel("world.list");
  check("插件与 Rust 重启后两个世界仍然存在", restarted.worlds.length === 2 && restarted.worlds.some((world) => world.id === secondId));
  report.evidence = {firstWorld: first.id, secondWorld: secondId, restartedActive: restarted.activeWorldId};
  await panelPage.screenshot({path: path.join(dir, "panel.png")});
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
