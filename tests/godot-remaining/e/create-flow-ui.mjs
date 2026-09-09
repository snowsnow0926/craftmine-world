/**
 * E dispatch · creation-flow UI behavior for states the current host cannot yet
 * produce (planned bases, staged initialization, failed initialization and the
 * recovery actions it reports).
 *
 * The components under test are the real ones. Only the host is a fixture that
 * speaks the documented panel contract and records every channel call, so the
 * test can prove what the UI sends and, more importantly, what it refuses to
 * send (no switch into an unfinished world, no invented progress or base).
 *
 * No OS input: the page is driven with requestSubmit / element.click /
 * dispatchEvent inside page.evaluate, and pointer lock plus focus are audited.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";
import {playwright, browserOptions} from "../../../app/browser-tools.mjs";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const desktop = path.join(root, "vendor/pi-desktop/apps/desktop");
const require = createRequire(path.join(desktop, "package.json"));
const {build} = createRequire(path.join(root, "vendor/pi-desktop/packages/agent-runtime/package.json"))("esbuild");
fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
const out = fs.mkdtempSync(path.join(root, "test-results/godot-remaining-e-create-ui-"));
const slash = (value) => value.replaceAll("\\", "/");
const report = {
  kind: "real-react-creation-panel-with-contract-fixture-host",
  sourceCommit: null,
  checks: [],
  errors: [],
  limits: [
    "Fixture host: exercises the documented contract, not the real plugin or Rust core.",
    "The real create/switch path is covered by tests/godot-remaining/e/world-create-e2e.mjs.",
    "No real model call and no visible-window composition.",
  ],
};
const check = (name, value, detail) => {
  report.checks.push({name, passed: !!value, ...(detail ? {detail} : {})});
  assert.ok(value, name);
  console.log("PASS " + name);
};

const entry = path.join(out, "fixture.jsx");
fs.writeFileSync(entry, `
import React from 'react';import {createRoot} from 'react-dom/client';
import {useCraftmineWorlds} from ${JSON.stringify(slash(path.join(desktop, "src/hooks/use-craftmine-worlds.ts")))};
import {WorldListPanel} from ${JSON.stringify(slash(path.join(desktop, "src/components/craftmine/WorldListPanel.tsx")))};
import {WorldAuxSections} from ${JSON.stringify(slash(path.join(desktop, "src/components/craftmine/WorldAuxSections.tsx")))};
import {CraftmineLayoutControls} from ${JSON.stringify(slash(path.join(desktop, "src/components/CraftmineLayoutControls.tsx")))};
function Fixture(){
  const controller=useCraftmineWorlds('zh');
  window.__controller=controller;
  const openSurface=(surface,section)=>window.dispatchEvent(new CustomEvent('craftmine-aux-open',{detail:{surface,section}}));
  return <nav className="craftmine-navigation">
    <WorldListPanel controller={controller} lang="zh" onOpenWorld={()=>{window.__opened=(window.__opened||0)+1;}}/>
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

// The fixture host lives in the page so the whole scenario stays deterministic.
const host = `
window.__calls=[];
window.__worlds=[];
window.__capabilities={create:true,switch:true,createActions:true,
  bases:[
    {id:'craftmine-web/5',label:'网页体素',description:'现有网页体素世界',delivered:true},
    {id:'godot.top-down',label:'Godot 俯视',description:'瓦片地图与 NPC 交互',delivered:false},
    {id:'godot.side-view',label:'Godot 横版',description:'重力、跳跃与平台',delivered:false}],
  starters:[
    {id:'blank',label:'空白',description:'只有基本控制',delivered:true},
    {id:'town',label:'小镇示例',description:'一条街、一间商店、一位 NPC',delivered:false}]};
window.__nextCreate=null;
window.__creationActions=[];
function stageList(current){
  const stages=[['materialize','复制底座文件'],['register','登记世界'],['import','导入资源'],['build','首次构建']];
  return stages.map(([id,label],index)=>({id,label,status:index<current?'passed':index===current?'running':'pending'}));
}
window.__fixtureInvoke=async(channel,payload={})=>{
  window.__calls.push({channel,payload});
  if(channel==='world.list')return {worlds:window.__worlds.map(world=>({...world})),activeWorldId:window.__activeWorldId??null};
  if(channel==='world.createOptions')return {...window.__capabilities};
  if(channel==='workbench.capabilities')return {channels:['task.current','library.search']};
  if(channel==='world.create'){
    if(!window.__nextCreate)throw Error('UNEXPECTED_CREATE');
    const next=window.__nextCreate;window.__nextCreate=null;
    if(next.throw)throw Error(next.throw);
    const record={id:next.id,title:payload.title,state:next.state??'ready',creation:next.creation??null};
    window.__worlds.push({id:record.id,title:record.title,revision:0,updatedAt:Date.now(),state:record.state,creation:record.creation});
    return record;
  }
  if(channel==='world.switch'){
    const target=window.__worlds.find(world=>world.id===payload.id);
    if(!target)return {ok:false};
    window.__activeWorldId=target.id;
    return {ok:true,activeWorldId:target.id};
  }
  if(channel==='world.creationAction'){window.__creationActions.push({worldId:payload.worldId,action:payload.action});return {ok:true};}
  if(channel==='task.current')return {};
  return {};
};
globalThis.__craftmineWorldBridge={invoke:(pluginId,channel,payload)=>window.__fixtureInvoke(channel,payload),onChanged:()=>()=>{}};
`;
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
:root{--ds-text-secondary:#b5beb8;--ds-text-primary:#eff7f0;--ds-text-muted:#8b948f;--ds-bg-active:#284235;--ds-tile:#202020;--ds-bg:#191919;--ds-border-subtle:#333;--ds-danger:#e5534b;--ds-focus:#5aa06f;--radius-xs:6px;--text-2xs:12px;--text-md:14px}
body{margin:0;background:#191919;color:#eee;font:14px system-ui}.craftmine-navigation{width:300px;min-height:100vh;padding:8px;box-sizing:border-box}
</style><style>${fs.readFileSync(path.join(desktop, "src/styles/craftmine.css"), "utf8")}</style></head><body><div id="root"></div><script>${host}</script><script src="fixture.js"></script></body></html>`);

let browser;
const calls = (page, channel) => page.evaluate((name) => window.__calls.filter((call) => call.channel === name), channel);
const rows = (page) => page.evaluate(() => [...document.querySelectorAll("[data-world-id]")].map((row) => ({
  id: row.dataset.worldId,
  state: row.dataset.worldState,
  playable: row.dataset.worldPlayable,
  active: row.dataset.worldActive,
  disabled: row.disabled,
  stage: row.querySelector("[data-world-creation-stage]")?.dataset.worldCreationStage ?? "",
  text: (row.closest(".craftmine-world-item-wrap") ?? row).textContent,
})));
const openForm = async (page) => {
  await page.evaluate(() => document.querySelector("[data-action='new-world']").click());
  await page.waitForFunction(() => !!document.querySelector("[data-world-create='form']"));
};
const fillName = (page, value) => page.evaluate((text) => {
  const input = document.querySelector("[data-world-create='name']");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", {bubbles: true}));
}, value);
const submitForm = (page) => page.evaluate(() => document.querySelector("[data-world-create='form']").requestSubmit());

try {
  browser = await playwright().chromium.launchPersistentContext(path.join(out, "profile"), {...browserOptions(), viewport: {width: 900, height: 900}});
  await browser.addInitScript(() => {
    window.__audit = {lock: 0, focus: 0};
    Element.prototype.requestPointerLock = () => { window.__audit.lock++; throw Error("Pointer lock disabled"); };
    window.focus = () => { window.__audit.focus++; };
    HTMLElement.prototype.focus = function () { window.__audit.focus++; };
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(pathToFileURL(path.join(out, "index.html")).href);
  await page.waitForFunction(() => document.querySelector("[data-world-list-state]").dataset.worldListState === "ready");

  // 1. Planned bases and start points are visible but never selectable or sent.
  await openForm(page);
  const baseOptions = await page.evaluate(() => [...document.querySelectorAll("[data-world-base-option]")].map((label) => ({
    id: label.dataset.worldBaseOption,
    delivered: label.dataset.worldBaseDelivered,
    disabled: label.querySelector("input").disabled,
  })));
  const starterOptions = await page.evaluate(() => [...document.querySelectorAll("[data-world-starter-option]")].map((label) => ({
    id: label.dataset.worldStarterOption,
    delivered: label.dataset.worldStarterDelivered ?? "true",
    disabled: label.querySelector("input").disabled,
  })));
  check("规划中的底座显示但不可选", baseOptions.length === 3 && baseOptions[0].disabled === false
    && baseOptions.slice(1).every((base) => base.delivered === "false" && base.disabled), baseOptions);
  check("规划中的起点显示但不可选", starterOptions.find((item) => item.id === "town").disabled
    && starterOptions.find((item) => item.id === "blank").disabled === false, starterOptions);
  check("底座带主机说明文字", await page.evaluate(() => document.querySelector("[data-world-base-option='godot.top-down']").textContent.includes("瓦片地图")));

  // 2. Empty name is rejected locally; no channel call leaves the page.
  await submitForm(page);
  check("空名称不会发出创建请求", (await calls(page, "world.create")).length === 0
    && (await page.evaluate(() => !!document.querySelector("[data-world-create='validation']"))));

  // 3. A base that needs initialization registers the world but is not switched into.
  await page.evaluate(() => {
    window.__nextCreate = {
      id: "w-init",
      state: "initializing",
      creation: {operationId: "op-init", stage: "import", progress: 40, stages: stageList(2), actions: []},
    };
  });
  await fillName(page, "海边小镇");
  await submitForm(page);
  await page.waitForFunction(() => !document.querySelector("[data-world-create='form']"));
  const initializing = (await rows(page)).find((row) => row.id === "w-init");
  check("初始化中的世界登记后立即出现在列表中", !!initializing && initializing.text.includes("海边小镇"), initializing);
  check("初始化中的世界显示主机步骤与进度", initializing.state === "initializing" && initializing.stage === "import"
    && initializing.text.includes("导入资源") && initializing.text.includes("40%"), initializing);
  check("初始化中的世界不可游玩", initializing.playable === "false");
  check("初始化中的世界不会被切换进去", (await calls(page, "world.switch")).length === 0);

  // 4. Polling reflects the host turning the world ready, still without a switch.
  await page.evaluate(() => {
    const world = window.__worlds.find((item) => item.id === "w-init");
    world.state = "ready";
    world.creation = null;
    world.updatedAt = Date.now();
  });
  await page.waitForFunction(() => {
    const row = document.querySelector("[data-world-id='w-init']");
    return row && row.dataset.worldPlayable === "true";
  }, {timeout: 15000});
  check("轮询到主机完成初始化后才变为可游玩", (await rows(page)).find((row) => row.id === "w-init").playable === "true");
  check("完成初始化后仍不自动切换世界", (await calls(page, "world.switch")).length === 0);

  // 5. A failed create keeps the form open with the real host error.
  await openForm(page);
  await page.evaluate(() => { window.__nextCreate = {id: "w-fail", throw: "WORLD_BASE_UNAVAILABLE"}; });
  await fillName(page, "坏世界");
  await submitForm(page);
  await page.waitForFunction(() => !!document.querySelector("[data-world-notice='error']"));
  check("创建失败时保留表单并显示主机错误", await page.evaluate(() => !!document.querySelector("[data-world-create='form']")
    && document.querySelector("[data-world-notice='error']").textContent.includes("WORLD_BASE_UNAVAILABLE")));
  check("创建失败不会登记世界", (await rows(page)).every((row) => row.id !== "w-fail"));
  await page.evaluate(() => document.querySelector("[data-world-create='form'] button[type='button']").click());

  // 6. A failed initialization row shows the host error and only host actions.
  await page.evaluate(() => {
    window.__worlds.push({
      id: "w-broken", title: "未完成的世界", revision: 0, updatedAt: Date.now(), state: "failed",
      creation: {
        operationId: "op-broken", stage: "build", progress: 75, stages: stageList(3),
        error: {code: "GODOT_EXECUTION_UNAVAILABLE", message: "没有可用的构建执行器", stage: "build", recoverable: true},
        actions: ["retry", "discard-draft", "details"],
      },
    });
  });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("craftmine-world-changed")));
  await page.waitForFunction(() => !!document.querySelector("[data-world-id='w-broken']"));
  const broken = (await rows(page)).find((row) => row.id === "w-broken");
  check("初始化失败的世界显示失败原因", broken.state === "failed" && broken.text.includes("没有可用的构建执行器"), broken);
  const recovery = await page.evaluate(() => ({
    actions: [...document.querySelectorAll("[data-world-recovery='w-broken'] [data-world-recovery-action]")].map((button) => button.dataset.worldRecoveryAction),
    error: document.querySelector("[data-world-recovery='w-broken'] [data-world-recovery-error]")?.textContent ?? "",
  }));
  check("恢复按钮只来自主机报告的动作", JSON.stringify(recovery.actions) === JSON.stringify(["retry", "discard-draft", "details"]), recovery);
  await page.evaluate(() => document.querySelector("[data-world-recovery-action='retry']").click());
  await page.waitForFunction(() => window.__creationActions.length === 1);
  check("重试初始化调用真实恢复通道", JSON.stringify(await page.evaluate(() => window.__creationActions)) === JSON.stringify([{worldId: "w-broken", action: "retry"}]));
  await page.evaluate(() => document.querySelector("[data-world-recovery-action='details']").click());
  await page.waitForFunction(() => !!document.querySelector("[data-world-creation-detail]"));
  check("详情展开主机报告的阶段与错误码", await page.evaluate(() => {
    const detail = document.querySelector("[data-world-creation-detail]");
    const steps = [...detail.querySelectorAll("[data-creation-step]")].map((item) => `${item.dataset.creationStep}:${item.dataset.creationStepStatus}`);
    return steps.includes("build:running") && detail.textContent.includes("GODOT_EXECUTION_UNAVAILABLE");
  }));

  // 7. Without the host reporting recovery support, no buttons are invented.
  await page.evaluate(() => {
    window.__capabilities = {...window.__capabilities, createActions: false};
    window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
  });
  await page.waitForFunction(() => !document.querySelector("[data-world-recovery='w-broken'] [data-world-recovery-action]"));
  check("主机不支持恢复动作时不显示按钮", await page.evaluate(() => !document.querySelector("[data-world-recovery='w-broken'] [data-world-recovery-action]")));

  // 8. Clicking a non-playable row neither switches nor opens anything.
  const before = await page.evaluate(() => window.__calls.filter((call) => call.channel === "world.switch").length);
  await page.evaluate(() => document.querySelector("[data-world-id='w-broken']").click());
  await page.waitForFunction(() => !!document.querySelector("[data-world-notice='info']"));
  check("点击未完成的世界只提示不切换", (await page.evaluate(() => window.__calls.filter((call) => call.channel === "world.switch").length)) === before
    && (await page.evaluate(() => document.querySelector("[data-world-notice='info']").textContent.includes("不能进入游玩"))));

  // 9. A playable world is still switchable and the task marker stays honest.
  await page.evaluate(() => { window.__worlds.push({id: "w-ok", title: "林间小屋", revision: 0, updatedAt: Date.now(), state: "ready"}); });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("craftmine-world-changed")));
  await page.waitForFunction(() => !!document.querySelector("[data-world-id='w-ok']"));
  await page.evaluate(() => document.querySelector("[data-world-id='w-ok']").click());
  await page.waitForFunction(() => document.querySelector("[data-world-id='w-ok']").dataset.worldActive === "true");
  check("可游玩世界仍通过受管理切换打开", (await calls(page, "world.switch")).some((call) => call.payload.id === "w-ok"));

  // 10. Long Chinese titles, narrow width, light theme and no input requests.
  await page.evaluate(() => {
    const world = window.__worlds.find((item) => item.id === "w-ok");
    world.title = "海边小镇：第三章·潮汐祭典与远方旅人的委托（含中文标点、English 与 123）";
    window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
  });
  await page.waitForFunction(() => document.querySelector("[data-world-id='w-ok']").textContent.includes("潮汐祭典"));
  await page.setViewportSize({width: 300, height: 900});
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; document.body.style.background = "#ffffff"; });
  const narrow = await page.evaluate(() => {
    const row = document.querySelector("[data-world-id='w-ok']");
    const rect = row.getBoundingClientRect();
    return {width: rect.width, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      resetVisible: !!document.querySelector("[data-action='reset-layout']")};
  });
  check("窄窗下长中文标题不撑破列宽", narrow.width <= 300 && narrow.overflow <= 0, narrow);
  check("窄窗下布局与恢复默认入口仍可达", narrow.resetVisible);
  await page.setViewportSize({width: 900, height: 900});
  await page.evaluate(() => { document.body.style.zoom = "1.5"; });
  const zoomed = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rows: document.querySelectorAll("[data-world-id]").length,
    reset: !!document.querySelector("[data-action='reset-layout']"),
  }));
  await page.evaluate(() => { document.body.style.zoom = ""; });
  check("150% 缩放下列表与入口仍完整", zoomed.overflow <= 0 && zoomed.rows >= 2 && zoomed.reset, zoomed);
  check("没有请求鼠标锁定或焦点", await page.evaluate(() => __audit.lock === 0 && __audit.focus === 0));
  check("页面没有未处理异常", pageErrors.length === 0, pageErrors);
  await page.screenshot({path: path.join(out, "creation-flow.png")});
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser?.close();
  report.sourceCommit = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log("Evidence: " + out);
}
