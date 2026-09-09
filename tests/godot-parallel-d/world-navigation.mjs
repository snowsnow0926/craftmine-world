// Headless acceptance for the left-column world navigation (task D).
//
// Real React components run against the real craftmine.world plugin and the
// real Rust core. No mouse, keyboard, focus or pointer-lock input is used:
// state is driven through page scripts, DOM events and the panel bridge, in an
// independent headless process with an independent data directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { playwright, browserOptions } from "../../app/browser-tools.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = fs.mkdtempSync(path.join(root, "test-results/godot-parallel-d-worlds-"));
const evidence = path.join(root, "docs/evidence/godot-parallel-d");
fs.mkdirSync(evidence, { recursive: true });
process.env.PI_DESKTOP_DATA_DIR = path.join(dir, "pi-host");
register(pathToFileURL(path.join(root, "vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs")));
const { PluginRuntime } = await import(pathToFileURL(path.join(root, "vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts")).href);
const pluginDir = path.join(root, "desktop/build/craftmine.world");
const hostEntry = path.join(root, "vendor/pi-desktop/apps/desktop/electron/main/plugin-host-process.mjs");
const binary = process.env.CRAFTMINE_CORE_BIN || path.join(root, "vendor/pi-desktop/target/release/craftmine-core.exe");
const desktop = path.join(root, "vendor/pi-desktop/apps/desktop");
const require = createRequire(path.join(root, "vendor/pi-desktop/packages/agent-runtime/package.json"));
const { build } = require("esbuild");

const checks = [];
const errors = [];
const check = (name, value) => {
  checks.push({ name, passed: !!value });
  assert.ok(value, name);
  console.log("PASS " + name);
};

const TITLE_ONE = "\u6797\u95f4\u5c0f\u5c4b";
const TITLE_LONG = "\u8fd9\u662f\u4e00\u4e2a\u540d\u5b57\u975e\u5e38\u957f\u7684\u4e16\u754c\u7528\u6765\u9a8c\u8bc1\u7a84\u7a97\u53e3\u4e0b\u7684\u6362\u884c\u4e0e\u622a\u65ad\u884c\u4e3a\u4ee5\u53ca\u8fb9\u754c\u60c5\u51b5";
const TITLE_THREE = "\u6d77\u8fb9\u82b1\u56ed";
const TASK_STAYS = "\u4efb\u52a1\u4ecd\u5c5e\u4e8e\u539f\u4e16\u754c";
const UNAVAILABLE = "\u4e16\u754c\u5217\u8868\u63a5\u53e3\u5c1a\u672a\u63a5\u5165";

const runtime = new PluginRuntime({
  hostEntry,
  spawnProcess: ({ entry }) => {
    const child = fork(entry, [], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, CRAFTMINE_CORE_BIN: binary },
    });
    return {
      postMessage: (message) => { if (child.connected) child.send(message); },
      onMessage: (handler) => child.on("message", handler),
      onExit: (handler) => child.on("exit", (code) => handler(code ?? 0)),
      kill: () => child.kill(),
    };
  },
});
const bridge = (channel, payload = {}) => runtime.invokePanelBridge("craftmine.world", channel, payload);

let browser;
let pagePanel;
let pageUi;
let failCreate = null;
let failSave = false;
let failSwitch = false;
let taskBinding = null;
const hostCalls = [];

const buildFixture = async (out, options) => {
  fs.mkdirSync(out, { recursive: true });
  const script = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { WorldListPanel } from "./src/components/craftmine/WorldListPanel";
import { WorldAuxSections } from "./src/components/craftmine/WorldAuxSections";
import { useCraftmineWorlds } from "./src/hooks/use-craftmine-worlds";
${options.bridge ? `globalThis.__craftmineWorldBridge = { invoke: (pluginId, channel, payload) => globalThis.__hostInvoke(pluginId, channel, payload) };` : ""}
window.__sessionWrites = 0;
window.__auxOpenCalls = 0;
window.__openWorldCalls = 0;
window.__surfaces = [];
function Harness() {
  const controller = useCraftmineWorlds("zh");
  const [play, setPlay] = useState(false);
  window.__setPlay = setPlay;
  window.__controller = controller;
  return (
    <div className={"app-shell craftmine-world-first" + (play ? " craftmine-play" : "")} style={{ "--craftmine-chat-width": "400px" }}>
      <aside className="sidebar">
        <nav className="craftmine-navigation no-drag">
          <button type="button" className="craftmine-world-nav" data-nav="world" onClick={() => { window.__openWorldCalls += 1; }}><span>\u4e16\u754c</span></button>
          <WorldListPanel controller={controller} lang="zh" onOpenWorld={() => { window.__openWorldCalls += 1; }} />
          <div className="craftmine-world-session" data-world-session="session-1">
            <span className="craftmine-world-session-label">\u4f1a\u8bdd</span>
            <span className="craftmine-world-session-title">\u4fdd\u7559\u7684\u4f1a\u8bdd</span>
          </div>
          <WorldAuxSections controller={controller} lang="zh" onOpenSurface={(surface, section) => { window.__auxOpenCalls += 1; window.__surfaces.push(section); window.__openWorldCalls += 1; }} />
        </nav>
      </aside>
      <section className="main-pane"><textarea className="composer-input" defaultValue="\u672a\u53d1\u9001\u7684\u8f93\u5165" /></section>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<Harness />);
`;
  const entry = path.join(out, "fixture.jsx");
  fs.writeFileSync(entry, script);
  await build({
    // Resolve the desktop app's imports from the real app directory.
    stdin: { contents: script, resolveDir: desktop, loader: "jsx", sourcefile: "world-navigation-fixture.jsx" },
    outfile: path.join(out, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    target: "chrome130",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const styles = ["tokens.css", "base.css", "craftmine.css"]
    .map((name) => fs.readFileSync(path.join(desktop, "src/styles", name), "utf8"))
    .join("\n");
  fs.writeFileSync(
    path.join(out, "index.html"),
    `<!doctype html><html lang="zh-CN" data-theme="dark" data-platform="win32"><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`,
  );
};

try {
  await runtime.loadFromPath(pluginDir, ["ui.view", "agent.tool.register", "background.service"]);
  const first = await bridge("world.create", { title: TITLE_ONE });
  const second = await bridge("world.create", { title: TITLE_LONG });
  await bridge("world.open", { id: first.id });

  browser = await playwright().chromium.launchPersistentContext(path.join(dir, "profile"), {
    ...browserOptions(),
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await browser.addInitScript(() => {
    globalThis.__inputRequests = 0;
    Element.prototype.requestPointerLock = () => { globalThis.__inputRequests += 1; throw Error("Pointer lock disabled"); };
    window.focus = () => { globalThis.__inputRequests += 1; };
    HTMLElement.prototype.focus = function () { globalThis.__inputRequests += 1; };
    // The docked plugin view receives its bridge from the host preload; the
    // headless harness provides the same shape over the real runtime.
    if (window === top && !globalThis.pluginBridge) {
      globalThis.pluginBridge = { invoke: (channel, payload) => globalThis.__craftmineBridge(channel, payload) };
    }
  });

  pagePanel = await browser.newPage();
  pagePanel.on("pageerror", (error) => errors.push("panel: " + error.message));
  await pagePanel.exposeBinding("__craftmineBridge", async (source, channel, payload) => {
    if (source.frame !== pagePanel.mainFrame()) throw Error("Only the trusted panel may invoke the bridge");
    if (channel === "world.saveProgress" && failSave) throw Error("Injected save failure");
    return bridge(channel, payload);
  });
  await pagePanel.goto(pathToFileURL(path.join(pluginDir, "views/world.html")).href);
  await pagePanel.waitForFunction(() => document.body.dataset.worldLoaded === "true" && document.body.dataset.worldId, null, { timeout: 20000 });
  check("real world panel mounted the host world", await pagePanel.evaluate((id) => document.body.dataset.worldId === id, first.id));

  const switchWorld = async (id) => {
    if (failSwitch) throw Error("Injected switch failure");
    // The docked panel populates its world <select> only from its own actions,
    // and the renderer cannot ask it to re-list yet (see INTERFACE_REQUEST.md).
    // The harness therefore adds the option the host already knows about and
    // then uses the panel's own change handler, which performs the real
    // freeze + save + open sequence. A failed save leaves the world mounted.
    const title = await bridge("world.read", { id }).then((record) => record.title).catch(() => id);
    let switched = false;
    for (let attempt = 0; attempt < 6 && !switched; attempt += 1) {
      // A visible panel error is final: the world stays mounted.
      const failure = await pagePanel.evaluate(() => {
        const box = document.getElementById("error");
        return box && !box.hidden ? box.textContent || "switch failed" : "";
      });
      if (failure) throw Error(failure);
      // The panel drops a switch request while its own save is in flight, so a
      // real player waits for the control to re-enable and retries. Do the same.
      const idle = await pagePanel
        .waitForFunction(() => !document.getElementById("world-list").disabled, null, { timeout: 30000 })
        .then(() => true, () => false);
      if (!idle) continue;
      await pagePanel.evaluate(({ target, label }) => {
        const select = document.getElementById("world-list");
        if (![...select.options].some((option) => option.value === target)) {
          const option = document.createElement("option");
          option.value = target;
          option.textContent = label;
          select.append(option);
        }
        select.value = target;
        select.dispatchEvent(new Event("change"));
      }, { target: id, label: title });
      switched = await pagePanel
        .waitForFunction((target) => document.body.dataset.worldId === target, id, { timeout: 15000 })
        .then(() => true, () => false);
    }
    if (switched) {
      await pagePanel.waitForFunction(() => !document.getElementById("world-list").disabled, null, { timeout: 30000 }).catch(() => {});
      return { activeWorldId: id };
    }
    const message = await pagePanel.evaluate(() => document.getElementById("error")?.textContent || "switch failed");
    throw Error(message);
  };
  const hostInvoke = async (pluginId, channel, payload = {}) => {
    hostCalls.push(channel);
    if (pluginId !== "craftmine.world") throw Error("unexpected plugin " + pluginId);
    if (channel === "world.create" && failCreate) throw Error(failCreate);
    if (channel === "task.current") return taskBinding ? { context: taskBinding } : null;
    if (channel === "world.switch") return switchWorld(payload.id);
    return bridge(channel, payload);
  };

  const uiDir = path.join(dir, "ui");
  await buildFixture(uiDir, { bridge: true });
  pageUi = await browser.newPage();
  pageUi.on("pageerror", (error) => errors.push("ui: " + error.message));
  await pageUi.exposeBinding("__hostInvoke", async (source, pluginId, channel, payload) => hostInvoke(pluginId, channel, payload));
  await pageUi.goto(pathToFileURL(path.join(uiDir, "index.html")).href);
  await pageUi.waitForFunction(() => document.querySelectorAll("[data-world-id]").length >= 2, null, { timeout: 20000 });

  const state = await pageUi.evaluate(() => ({
    ids: [...document.querySelectorAll("[data-world-id]")].map((node) => node.dataset.worldId),
    titles: [...document.querySelectorAll(".craftmine-world-item-name")].map((node) => node.textContent),
    active: document.querySelector("[data-world-active='true']")?.dataset.worldId ?? null,
    baseStates: [...document.querySelectorAll("[data-world-id]")].map((node) => node.dataset.worldBaseState),
    baseText: document.querySelector(".craftmine-world-item-base")?.textContent ?? "",
    recency: document.querySelector(".craftmine-world-item-recent")?.textContent ?? "",
    listState: document.querySelector("[data-world-list-state]")?.dataset.worldListState ?? "",
  }));
  check("left column lists the real host worlds with their titles", state.titles.includes(TITLE_ONE) && state.titles.includes(TITLE_LONG) && state.ids.length === 2);
  check("the host-reported active world is marked and sorted first", state.active === first.id && state.ids[0] === first.id);
  check("an unreported base is shown as unreported, never as a delivered base", state.baseStates.every((value) => value === "unreported") && state.baseText.includes("\u5e95\u5ea7\u672a\u6807\u6ce8"));
  check("save recency comes from the host timestamp", /(\u521a\u521a|\u5206\u949f|\u5c0f\u65f6|\u5929)/.test(state.recency) && state.listState === "ready");

  // Create flow: real world.create through the plugin and Rust core.
  const openCreate = async () => {
    const expanded = await pageUi.evaluate(() => document.querySelector("[data-action='new-world']").getAttribute("aria-expanded") === "true");
    if (!expanded) await pageUi.evaluate(() => document.querySelector("[data-action='new-world']").click());
    await pageUi.waitForSelector("[data-world-create='form']");
  };
  const typeName = async (title) => {
    await pageUi.evaluate((value) => {
      const input = document.querySelector("[data-world-create='name']");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, title);
  };
  const createWorld = async (title) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const expanded = await pageUi.evaluate(() => document.querySelector("[data-action='new-world']")?.getAttribute("aria-expanded") === "true");
      if (!expanded) await pageUi.evaluate(() => document.querySelector("[data-action='new-world']").click());
      const visible = await pageUi.waitForSelector("[data-world-create='form']", { timeout: 10000 }).then(() => true, () => false);
      if (!visible) continue;
      await typeName(title);
      const submitted = await pageUi.evaluate(() => {
        const form = document.querySelector("[data-world-create='form']");
        if (!form) return false;
        form.requestSubmit();
        return true;
      });
      if (submitted) return true;
    }
    return false;
  };
  await openCreate();
  const createOptions = await pageUi.evaluate(() => ({
    baseOptions: document.querySelectorAll("[data-world-base-option]").length,
    baseUnreported: !!document.querySelector("[data-world-create='base-unreported']"),
    starters: [...document.querySelectorAll("[data-world-starter-option]")].map((node) => node.dataset.worldStarterOption),
  }));
  check("create offers only the delivered blank start and no invented base", createOptions.baseOptions === 0 && createOptions.baseUnreported && createOptions.starters.join(",") === "blank");
  check("the create form submits through the real host", await createWorld(TITLE_THREE));
  await pageUi.waitForFunction((title) => [...document.querySelectorAll(".craftmine-world-item-name")].some((node) => node.textContent === title), TITLE_THREE, { timeout: 20000 });
  // The create flow continues with the save-then-open switch; wait for it.
  await pageUi.waitForFunction(() => window.__controller.busy === false, null, { timeout: 90000 });
  const created = await pageUi.evaluate(() => ({
    active: document.querySelector("[data-world-active='true']")?.dataset.worldId ?? null,
    activeTitle: document.querySelector("[data-world-active='true'] .craftmine-world-item-name")?.textContent ?? "",
    count: document.querySelectorAll("[data-world-id]").length,
  }));
  const hostList = await bridge("world.list");
  check("creating a world persists it in Rust and opens it", hostList.worlds.length === 3 && created.count === 3 && created.activeTitle === TITLE_THREE && hostList.activeWorldId === created.active);
  const panelWorld = await pagePanel.evaluate(() => document.body.dataset.worldId);
  check("the world panel shows the world created from the left column", panelWorld === created.active);

  // Create failure with a long host error.
  const longError = "CRAFTMINE_CREATE_FAILED: " + "\u4e16\u754c\u521b\u5efa\u5931\u8d25\u7684\u8be6\u7ec6\u539f\u56e0".repeat(12);
  failCreate = longError;
  await createWorld("\u5931\u8d25\u7684\u4e16\u754c");
  await pageUi.waitForSelector("[data-world-notice='error']");
  const createFailure = await pageUi.evaluate(() => {
    const box = document.querySelector("[data-world-notice='error']");
    return {
      text: box.textContent,
      wrapped: box.scrollWidth <= box.clientWidth + 1,
      boxScroll: box.scrollWidth,
      boxClient: box.clientWidth,
      docScroll: document.documentElement.scrollWidth,
      docClient: window.innerWidth,
      overflow: document.documentElement.scrollWidth <= window.innerWidth,
      count: document.querySelectorAll("[data-world-id]").length,
      active: document.querySelector("[data-world-active='true']")?.dataset.worldId ?? null,
    };
  });
  check("a failed create keeps the previous world and shows the full host error", createFailure.text.includes("CRAFTMINE_CREATE_FAILED") && createFailure.count === 3 && createFailure.active === created.active);
  check("a long host error wraps instead of breaking the narrow column", createFailure.wrapped && createFailure.overflow);
  failCreate = null;
  await pageUi.waitForFunction(() => window.__controller.busy === false, null, { timeout: 60000 });

  // A world that is created but cannot be opened must not be shown as active:
  // the host selection goes back to the world the view is still running.
  failSwitch = true;
  await createWorld("\u65e0\u6cd5\u6253\u5f00\u7684\u4e16\u754c");
  await pageUi.waitForFunction(() => window.__controller.busy === false, null, { timeout: 90000 });
  const partialCreate = await pageUi.evaluate(() => ({
    error: document.querySelector("[data-world-notice='error']")?.textContent ?? "",
    active: document.querySelector("[data-world-active='true']")?.dataset.worldId ?? null,
    count: document.querySelectorAll("[data-world-id]").length,
    formOpen: !!document.querySelector("[data-world-create='form']"),
  }));
  const hostAfterPartial = await bridge("world.list");
  check(
    `a created world that cannot be opened keeps the previous world active everywhere (${JSON.stringify(partialCreate)} host ${hostAfterPartial.activeWorldId} expected ${created.active})`,
    partialCreate.error.includes("Injected switch failure") &&
      partialCreate.active === created.active &&
      hostAfterPartial.activeWorldId === created.active &&
      partialCreate.count === 4 &&
      partialCreate.formOpen,
  );
  failSwitch = false;
  await pageUi.evaluate(() => document.querySelector("[data-action='new-world']")?.click());

  // Save failure: the host keeps the previous world. The live world has to be
  // dirty first, otherwise the panel skips the save and switches immediately.
  await pagePanel.evaluate(() => {
    const frame = document.querySelector("iframe");
    const nonce = frame.srcdoc.match(/name="craftmine-nonce" content="([^"]+)"/)[1];
    frame.contentWindow.postMessage({ channel: "craftmine-host/1", nonce, type: "respawn" }, "*");
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  failSave = true;
  await pageUi.evaluate((id) => document.querySelector(`[data-world-id='${id}']`).click(), first.id);
  await pageUi.waitForFunction(() => document.querySelector("[data-world-notice='error']")?.textContent?.includes("Injected save failure"), null, { timeout: 20000 });
  const saveFailure = await pageUi.evaluate(() => ({
    active: document.querySelector("[data-world-active='true']")?.dataset.worldId ?? null,
    notice: document.querySelector("[data-world-notice='error']")?.textContent ?? "",
    text: document.querySelector("[data-world-notice='error']")?.textContent ?? "",
  }));
  const afterFailure = await bridge("world.list");
  check("a failed save keeps the previous world active in the UI and in Rust", saveFailure.active === created.active && afterFailure.activeWorldId === created.active);
  check("the failed switch reports the real host error", saveFailure.notice.includes("Injected save failure"));
  failSave = false;

  // A running task keeps its own world; the left column never rebinds the session.
  taskBinding = { worldId: created.active, status: "running", binding: { sessionId: "session-1", taskId: "task-1" } };
  await pageUi.evaluate(() => window.__controller.refresh());
  await pageUi.waitForFunction(() => document.querySelector("[data-world-id] .craftmine-world-item-task"), null, { timeout: 20000 });
  await pageUi.evaluate((id) => document.querySelector(`[data-world-id='${id}']`).click(), first.id);
  await pageUi.waitForFunction(() => document.querySelector("[data-world-notice='info']"), null, { timeout: 20000 });
  const taskSwitch = await pageUi.evaluate(() => ({
    notice: document.querySelector("[data-world-notice='info']")?.textContent ?? "",
    sessionWrites: window.__sessionWrites,
    sessionNode: document.querySelector("[data-world-session]")?.dataset.worldSession ?? "",
  }));
  check("switching while a task runs states that the task keeps its world", taskSwitch.notice.includes(TASK_STAYS) && taskSwitch.sessionNode === "session-1");
  // The host gateway (Electron main) is not part of this headless harness, so
  // assert the renderer-side invariant that is testable here: the switch path
  // only calls world channels and never a task- or session-mutating channel.
  const mutation = hostCalls.filter((channel) => /^(task\.(resume|discard|stop|budget)|session)/.test(channel));
  check(
    "switching worlds issues no task or session mutation from the left column",
    hostCalls.includes("world.switch") && mutation.length === 0,
  );
  taskBinding = null;

  // Auxiliary surfaces: collapsed until asked for, real summaries, persisted.
  const auxClosed = await pageUi.evaluate(() => [...document.querySelectorAll("[data-aux-toggle]")].map((node) => node.getAttribute("aria-expanded")));
  check("auxiliary surfaces start collapsed", auxClosed.length === 6 && auxClosed.every((value) => value === "false"));
  await pageUi.evaluate(() => document.querySelector("[data-aux-toggle='checks']").click());
  await pageUi.waitForFunction(() => document.querySelector("[data-aux-summary='checks']")?.textContent?.length > 0, null, { timeout: 20000 });
  const auxChecks = await pageUi.evaluate(() => ({
    expanded: document.querySelector("[data-aux-toggle='checks']").getAttribute("aria-expanded"),
    summary: document.querySelector("[data-aux-summary='checks']").textContent,
    bodyHidden: document.querySelector("#craftmine-aux-body-checks").hidden,
  }));
  check("expanding checks reads its real host summary", auxChecks.expanded === "true" && auxChecks.bodyHidden === false && auxChecks.summary.length > 0);
  await pageUi.evaluate(() => document.querySelector("[data-aux-open='checks']").click());
  check("the section request opens the world panel and carries the section id", await pageUi.evaluate(() => window.__auxOpenCalls === 1 && window.__openWorldCalls > 0 && window.__surfaces.join(",") === "checks"));
  await pageUi.reload();
  await pageUi.waitForFunction(() => document.querySelector("[data-aux-toggle='checks']"), null, { timeout: 20000 });
  check("auxiliary expansion is remembered after a reload", await pageUi.evaluate(() => document.querySelector("[data-aux-toggle='checks']").getAttribute("aria-expanded") === "true"));

  await pageUi.screenshot({ path: path.join(evidence, "world-list-dark.png") });

  // Play mode keeps both mounted instances; returning restores them.
  await pageUi.evaluate(() => { window.__composer = document.querySelector(".composer-input"); window.__list = document.querySelector("[data-world-list-state]"); window.__setPlay(true); });
  await pageUi.waitForFunction(() => getComputedStyle(document.querySelector(".main-pane")).display === "none", null, { timeout: 10000 });
  const playState = await pageUi.evaluate(() => ({
    sidebarHidden: getComputedStyle(document.querySelector(".sidebar")).display === "none",
    sameComposer: window.__composer === document.querySelector(".composer-input"),
    value: document.querySelector(".composer-input").value,
    sameList: window.__list === document.querySelector("[data-world-list-state]"),
  }));
  check("play mode hides the world list and chat but keeps both mounted instances", playState.sidebarHidden && playState.sameComposer && playState.sameList && playState.value === "\u672a\u53d1\u9001\u7684\u8f93\u5165");
  await pageUi.evaluate(() => window.__setPlay(false));
  await pageUi.waitForFunction(() => getComputedStyle(document.querySelector(".main-pane")).display !== "none", null, { timeout: 10000 });
  check("returning to creation restores the same input and world list", await pageUi.evaluate(() => window.__composer === document.querySelector(".composer-input") && document.querySelector(".composer-input").value === "\u672a\u53d1\u9001\u7684\u8f93\u5165"));

  // Narrow window and light theme.
  await pageUi.setViewportSize({ width: 420, height: 720 });
  await pageUi.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const narrow = await pageUi.evaluate(() => {
    const input = document.querySelector(".composer-input").getBoundingClientRect();
    const list = document.querySelector("[data-world-list-state]");
    return {
      inputVisible: input.width > 0 && input.right <= window.innerWidth + 1 && input.bottom <= window.innerHeight + 1,
      overflow: document.documentElement.scrollWidth <= window.innerWidth,
      scrollable: list.scrollHeight >= list.clientHeight,
    };
  });
  check("a narrow window keeps the chat input reachable and the column inside the viewport", narrow.inputVisible && narrow.overflow);
  await pageUi.screenshot({ path: path.join(evidence, "world-list-narrow.png") });
  // The sidebar can be dragged to its 240px minimum in the real client.
  await pageUi.evaluate(() => document.querySelector(".app-shell").style.setProperty("--ds-sidebar-width", "240px"));
  await pageUi.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const narrowColumn = await pageUi.evaluate(() => {
    const sidebar = document.querySelector(".sidebar");
    const summary = document.querySelector("[data-aux-summary='checks']");
    const row = document.querySelector("[data-world-id]");
    return {
      width: Math.round(sidebar.getBoundingClientRect().width),
      noOverflow: sidebar.scrollWidth <= sidebar.clientWidth + 1,
      summaryHidden: !summary || getComputedStyle(summary).display === "none",
      rowWraps: row.scrollWidth <= row.clientWidth + 1,
    };
  });
  check("the world list stays readable at the 240px sidebar minimum", narrowColumn.width <= 241 && narrowColumn.noOverflow && narrowColumn.rowWraps);
  await pageUi.setViewportSize({ width: 1440, height: 960 });
  await pageUi.emulateMedia({ colorScheme: "light" });
  await pageUi.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  const light = await pageUi.evaluate(() => ({
    visible: [...document.querySelectorAll(".craftmine-world-item-name")].every((node) => node.getBoundingClientRect().width > 0),
    overflow: document.documentElement.scrollWidth <= window.innerWidth,
  }));
  check("the world list stays legible in the light theme", light.visible && light.overflow);
  await pageUi.screenshot({ path: path.join(evidence, "world-list-light.png") });

  // Unwired host: an explicit state, not a fabricated world list.
  const emptyDir = path.join(dir, "ui-nohost");
  await buildFixture(emptyDir, { bridge: false });
  const pageNoHost = await browser.newPage();
  pageNoHost.on("pageerror", (error) => errors.push("nohost: " + error.message));
  await pageNoHost.goto(pathToFileURL(path.join(emptyDir, "index.html")).href);
  await pageNoHost.waitForSelector("[data-world-state='unavailable']", { timeout: 20000 });
  const noHost = await pageNoHost.evaluate(() => ({
    text: document.querySelector("[data-world-state='unavailable']").textContent,
    rows: document.querySelectorAll("[data-world-id]").length,
    createDisabled: document.querySelector("[data-action='new-world']").disabled,
  }));
  check("without the host channel the panel says so and shows no invented worlds", noHost.rows === 0 && noHost.createDisabled && noHost.text.includes(UNAVAILABLE));

  const frames = [...pageUi.frames(), ...pagePanel.frames(), ...pageNoHost.frames()];
  const locks = await Promise.all(frames.map((frame) => frame.evaluate(() => globalThis.__inputRequests || 0).catch(() => 0)));
  check("no pointer lock, focus or real input was requested", locks.every((value) => value === 0));
  check("no unhandled page errors in the real components or the world panel", errors.length === 0);
} catch (error) {
  errors.push(error.stack || String(error));
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser?.close();
  for (const loaded of runtime.listLoaded()) await runtime.unload(loaded.manifest.id);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ checks, errors }, null, 2));
  fs.writeFileSync(path.join(evidence, "world-navigation.json"), JSON.stringify({
    kind: "real-react-world-navigation-with-real-plugin-and-rust-core",
    sourceCommit: process.env.CRAFTMINE_SOURCE_COMMIT || null,
    plugin: "desktop/build/craftmine.world",
    coreBinary: binary,
    checks,
    errors,
  }, null, 2));
  console.log("Evidence: " + dir);
  console.log("Report: " + path.join(evidence, "world-navigation.json"));
}