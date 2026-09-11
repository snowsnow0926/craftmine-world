import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const layout = await import("../src/lib/craftmine-layout.ts");

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
  setPage: page => calls.push(["page", page]),
  openWorkPanelTab: tab => calls.push(["tab", tab.id]),
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
