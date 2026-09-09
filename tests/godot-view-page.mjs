// craftmine-world panel view in Godot mode (task C).
//
// Loads the built view page with a stub plugin bridge and checks that a
// Godot-backed world switches the page to its placeholder mode, that the game
// area starts exactly below the reserved chrome strip, and that every host
// state is shown. Headless browser only; no input, no pointer lock.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { playwright, browserOptions } from "../app/browser-tools.mjs";

const page = path.resolve("desktop/build/craftmine.world/views/world.html");
if (!fs.existsSync(page)) {
  throw new Error("Build the world plugin first: node desktop/build-world-plugin.mjs");
}
const out = fs.mkdtempSync(path.resolve("test-results/godot-view-page-"));
const report = { kind: "craftmine-world-view-page-godot-mode", checks: [], notVerified: ["real Electron host broadcast", "real Godot rendering"] };
const check = (name, value, evidence) => {
  report.checks.push({ name, passed: !!value, ...(evidence === undefined ? {} : { evidence }) });
  console.log((value ? "PASS " : "FAIL ") + name);
  assert.ok(value, name);
};

const browser = await playwright().chromium.launch({ ...browserOptions() });
const context = await browser.newContext({ viewport: { width: 760, height: 900 } });
await context.addInitScript(() => {
  globalThis.__events = [];
  const handlers = {};
  globalThis.pluginBridge = {
    invoke: async (channel) => {
      if (channel === "world.list") return { worlds: [{ id: "godot-world", title: "Godot 世界" }], activeWorldId: "godot-world" };
      if (channel === "world.open") {
        return { id: "godot-world", revision: 1, world: { build: { id: "v-godot", hash: "h", engine: { kind: "godot-web", buildId: "b1", root: "C:/x" } }, snapshot: {} } };
      }
      if (channel === "app.getAppearance") return { base: "dark" };
      return {};
    },
    on: (event, handler) => {
      (handlers[event] ??= []).push(handler);
      globalThis.__events.push(event);
    },
    emit: (event, payload) => {
      for (const handler of handlers[event] ?? []) handler(payload);
    },
  };
});
const errors = [];
const view = await context.newPage();
view.on("pageerror", (error) => errors.push(String(error)));
await view.goto(pathToFileURL(page).href);
await view.waitForFunction(() => document.body.dataset.godot === "true", null, { timeout: 15000 });

const layout = await view.evaluate(() => {
  const surface = document.getElementById("godot-surface").getBoundingClientRect();
  const frame = document.querySelector("iframe");
  return {
    chrome: getComputedStyle(document.documentElement).getPropertyValue("--godot-chrome").trim(),
    surfaceTop: Math.round(surface.top),
    surfaceHeight: Math.round(surface.height),
    frameDisplay: getComputedStyle(frame).display,
    frameSrcdoc: frame.getAttribute("srcdoc"),
    saveDisabled: document.getElementById("save-world").disabled,
    subscribed: globalThis.__events,
  };
});
check("A Godot world switches the panel page to its placeholder mode", layout.subscribed.includes("godot-world:state") && layout.chrome === "76px", layout);
check("The game area starts exactly below the reserved chrome strip", layout.surfaceTop === 76 && layout.surfaceHeight > 700, layout);
check("The voxel iframe is hidden and has no document for a Godot world", layout.frameDisplay === "none" && layout.frameSrcdoc === null, layout);
check("Saving is owned by the host, so the panel button is disabled", layout.saveDisabled === true);

const states = await view.evaluate(() => {
  const out = [];
  for (const state of ["loading", "ready", "paused", "saving", "saved", "failed", "closed"]) {
    globalThis.pluginBridge.emit("godot-world:state", {
      worldId: "godot-world",
      buildId: "b1",
      instanceId: "i1",
      state,
      error: state === "failed" ? "引擎启动失败" : undefined,
    });
    out.push({ state, label: document.getElementById("world-status").textContent, loaded: document.body.dataset.worldLoaded ?? null, error: document.getElementById("error").textContent });
  }
  globalThis.pluginBridge.emit("godot-world:state", { worldId: "other-world", buildId: "b1", instanceId: "i2", state: "ready" });
  out.push({ state: "foreign", label: document.getElementById("world-status").textContent });
  return out;
});
const labels = Object.fromEntries(states.map((item) => [item.state, item.label]));
check(
  "Every host state is shown with a Chinese label",
  labels.loading === "载入中" && labels.ready === "已就绪" && labels.paused === "已暂停" && labels.saving === "保存中" && labels.saved === "已保存" && labels.failed === "运行失败" && labels.closed === "已关闭",
  labels,
);
check(
  "Only ready and saved mark the world as loaded",
  states[0].loaded === null && states[1].loaded === "true" && states[4].loaded === "true" && states[5].loaded === null,
  states.map((item) => ({ state: item.state, loaded: item.loaded })),
);
check("A failure is shown without throwing, and another world is ignored", states[5].error.includes("引擎启动失败") && labels.foreign === "已关闭", states[5]);
check("The page reports no unhandled error", errors.length === 0, errors);
await browser.close();

report.passed = report.checks.filter((item) => item.passed).length;
report.total = report.checks.length;
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ kind: report.kind, passed: report.passed, total: report.total, evidence: out }));
process.exit(report.passed === report.total ? 0 : 1);
