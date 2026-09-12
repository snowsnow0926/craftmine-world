import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const layout = await import("../src/lib/craftmine-layout.ts");
const presentation = await import("../src/lib/craftmine-mode-presentation.ts");
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/craftmine-mode.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "mode-store-fixture", setup(builder) {
    builder.onResolve({ filter: /stores\/app-store$/ }, () => ({ path: "mode-store", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useAppStore = { getState: () => globalThis.modeStoreFixture };" }));
  } }],
});
const mode = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const storage = { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; } };
globalThis.localStorage = storage;
globalThis.window = new EventTarget();
const calls = [];
globalThis.modeStoreFixture = {
  workPanelWidth: 495, activeSessionId: "retained-session", running: true,
  activeWorkPanelTabId: null, workPanelTabs: [],
  setPage: page => calls.push(["page", page]),
  openWorkPanelTab: tab => calls.push(["tab", tab.id]),
  openWorkPanel: () => calls.push(["open"]),
  setWorkPanelWidth: width => calls.push(["width", width]),
};

test("explicit workbench entry overrides a stored play preference and keeps the task context", () => {
  storage.value = JSON.stringify({ mode: "play", overlay: "full", playWhenWorldActivates: true });
  calls.length = 0;
  const next = mode.enterCraftmineMode("create", { explicit: true });
  assert.equal(next.mode, "create");
  assert.equal(next.overlay, "closed");
  assert.equal(next.playWhenWorldActivates, false);
  assert.deepEqual(calls, [["page", "chat"], ["tab", "plugin:craftmine.world/world"], ["width", 480]]);
  assert.equal(globalThis.modeStoreFixture.activeSessionId, "retained-session");
  assert.equal(globalThis.modeStoreFixture.running, true);
  assert.equal(layout.decideCraftmineActivation({ worldId: "new-world", enteredWorldId: null, playing: false, playWhenWorldActivates: next.playWhenWorldActivates }).switchToPlay, false);
});

test("a persisted play layout does not reopen the mode gate on relaunch", () => {
  assert.match(appSource, /const \[modeChosen, setModeChosen\] = useState\(true\)/);
  assert.match(appSource, /const \[modeEntryOpen, setModeEntryOpen\] = useState\(false\)/);
  assert.match(appSource, /const modeEntryOpenRef = useRef\(modeEntryOpen\)/);
});

test("immersive entry closes a previously expanded chat and preserves layout widths", () => {
  storage.value = JSON.stringify({ mode: "create", overlay: "full", widths: { create: 510, play: 650 } });
  const next = mode.enterCraftmineMode("play", { explicit: true });
  assert.equal(next.mode, "play");
  assert.equal(next.overlay, "closed");
  assert.deepEqual(next.widths, { create: 495, play: 650 });
});

test("opening the primary mode chooser only emits a presentation event", () => {
  calls.length = 0;
  const before = storage.value;
  let requests = 0;
  window.addEventListener("craftmine-mode-entry-open", () => requests++, { once: true });
  mode.openCraftmineModeEntry();
  assert.equal(requests, 1);
  assert.deepEqual(calls, []);
  assert.equal(storage.value, before);
});

test("resetting workbench dimensions cannot re-enable automatic play", () => {
  const reset = layout.resetCraftmineLayout(storage, "create");
  assert.equal(reset.mode, "create");
  assert.equal(reset.playWhenWorldActivates, false);
  assert.equal(layout.resetCraftmineLayout(storage, "play").playWhenWorldActivates, true);
});

test("task-opened file and review tabs cannot replace the immersive world", () => {
  const tabs = [{ id: presentation.CRAFTMINE_WORLD_TAB_ID }, { id: "file:level.gd" }, { id: "review" }];
  for (const selected of ["file:level.gd", "review", null]) {
    assert.equal(presentation.craftminePresentedTabId("play", selected, tabs), presentation.CRAFTMINE_WORLD_TAB_ID);
    assert.equal(presentation.craftminePresentedTabId("create", selected, tabs), selected);
  }
  assert.equal(tabs.length, 3);
  assert.equal(presentation.craftminePresentedTabId("play", "review", [{ id: "review" }]), "review");
});

test("deliberate workbench entry reveals the retained artifact without reopening the world", () => {
  calls.length = 0;
  const fixture = globalThis.modeStoreFixture;
  fixture.activeWorkPanelTabId = "file:level.gd";
  fixture.workPanelTabs = [{ id: presentation.CRAFTMINE_WORLD_TAB_ID }, { id: "file:level.gd" }];
  storage.value = JSON.stringify({ mode: "play", overlay: "full" });
  mode.enterCraftmineMode("create", { explicit: true });
  assert.deepEqual(calls, [["page", "chat"], ["open"], ["width", 480]]);
  assert.equal(fixture.activeWorkPanelTabId, "file:level.gd");
  assert.equal(fixture.activeSessionId, "retained-session");
  assert.equal(fixture.running, true);
  assert.equal(presentation.shouldOpenCraftmineWorldTab("play", fixture.activeWorkPanelTabId, fixture.workPanelTabs), true);
  assert.equal(presentation.shouldOpenCraftmineWorldTab("create", "missing", fixture.workPanelTabs), true);
});
