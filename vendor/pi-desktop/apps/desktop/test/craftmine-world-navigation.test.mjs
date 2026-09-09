import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

register(pathToFileURL(fileURLToPath(new URL("./helpers/ts-import-hooks.mjs", import.meta.url))));

const worlds = await import("../src/lib/craftmine-worlds.ts");
const aux = await import("../src/lib/craftmine-aux.ts");
const layout = await import("../src/lib/craftmine-layout.ts");


const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");

test("world list parsing keeps host facts and drops malformed rows", () => {
  const parsed = worlds.parseWorldList({
    activeWorldId: "w1",
    worlds: [
      { id: "w1", title: "Cabin", revision: 4, updatedAt: 1700, base: { id: "craftmine-web/5", label: "Web voxel", delivered: true }, origin: "created", check: { status: "passed", at: 1701 } },
      { id: "w2", title: "Town", revision: 1, updatedAt: 1600, base: { id: "godot.top-down", label: "Top down", delivered: false }, origin: "imported" },
      { title: "no id" },
      "junk",
    ],
  });
  assert.equal(parsed.activeWorldId, "w1");
  assert.equal(parsed.worlds.length, 2);
  assert.deepEqual(parsed.worlds[0].base, { id: "craftmine-web/5", label: "Web voxel", delivered: true });
  assert.equal(parsed.worlds[0].check.status, "passed");
  assert.equal(parsed.worlds[1].base.delivered, false);
  assert.equal(parsed.worlds[1].check, null);
  assert.equal(parsed.worlds[1].origin, "imported");
});

test("base labels never promote an unreported or planned base", () => {
  const entry = (base) => ({ id: "w", title: "W", revision: 0, updatedAt: 0, base, origin: null, check: null });
  assert.equal(worlds.worldBaseLabel(entry(null), "zh"), "\u5e95\u5ea7\u672a\u6807\u6ce8");
  assert.equal(worlds.worldBaseState(entry(null)), "unreported");
  assert.equal(worlds.worldBaseState(entry({ id: "b", label: "B", delivered: false })), "planned");
  assert.equal(worlds.worldBaseState(entry({ id: "b", label: "B", delivered: true })), "reported");
  assert.equal(worlds.worldBaseLabel(entry({ id: "b", label: "B", delivered: true }), "en"), "B");
  assert.match(worlds.worldBaseLabel(entry({ id: "b", label: "B", delivered: false }), "en"), /planned/);
});

test("save recency and check tone come from the host timestamp and status", () => {
  const now = 1_700_000_000_000;
  assert.equal(worlds.worldRecency(0, now, "en"), "No saved progress");
  assert.match(worlds.worldRecency(now - 5_000, now, "en"), /just now/i);
  assert.match(worlds.worldRecency(now - 90_000, now, "en"), /1m ago/);
  assert.match(worlds.worldRecency(now - 7_200_000, now, "en"), /2h ago/);
  assert.match(worlds.worldRecency(now - 3 * 86_400_000, now, "en"), /3d ago/);
  assert.equal(worlds.worldCheckTone({ status: "passed", at: 0 }), "ok");
  assert.equal(worlds.worldCheckTone({ status: "failed", at: 0 }), "bad");
  assert.equal(worlds.worldCheckTone({ status: "running", at: 0 }), "busy");
  assert.equal(worlds.worldCheckTone(null), "idle");
  assert.equal(worlds.worldCheckLabel(null, "en"), null);
});

test("active world sorts first, then newest save", () => {
  const list = [
    { id: "a", title: "A", revision: 0, updatedAt: 10, base: null, origin: null, check: null },
    { id: "b", title: "B", revision: 0, updatedAt: 30, base: null, origin: null, check: null },
    { id: "c", title: "C", revision: 0, updatedAt: 20, base: null, origin: null, check: null },
  ];
  assert.deepEqual(worlds.sortWorldEntries(list, "a").map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(worlds.sortWorldEntries(list, null).map((entry) => entry.id), ["b", "c", "a"]);
});

test("switch planning keeps a running task in its own world", () => {
  const task = { sessionId: "s1", worldId: "w1", taskId: "t1", generation: 2, running: true };
  const base = { activeWorldId: "w1", targetId: "w2", busy: false, saving: false, switchSupported: true, activeTask: task };
  assert.deepEqual(worlds.planWorldSwitch(base), { kind: "switch", targetId: "w2", taskStaysInWorld: "w1" });
  assert.deepEqual(worlds.planWorldSwitch({ ...base, targetId: "w1" }), { kind: "noop" });
  assert.deepEqual(worlds.planWorldSwitch({ ...base, busy: true }), { kind: "blocked", reason: "busy" });
  assert.deepEqual(worlds.planWorldSwitch({ ...base, switchSupported: false }), { kind: "blocked", reason: "unsupported" });
  assert.deepEqual(
    worlds.planWorldSwitch({ ...base, activeTask: { ...task, worldId: "w2" } }),
    { kind: "switch", targetId: "w2", taskStaysInWorld: null },
  );
});

test("world name input is trimmed, bounded and rejected when empty", () => {
  assert.equal(worlds.validateWorldTitle("   ", "en"), "Enter a world name.");
  assert.equal(worlds.normalizeWorldTitle("  a   b  "), "a b");
  assert.equal(worlds.normalizeWorldTitle("x".repeat(200)).length, worlds.CRAFTMINE_WORLD_TITLE_MAX);
  assert.equal(worlds.validateWorldTitle("ok", "zh"), null);
});

test("host errors map to readable text and keep unknown detail verbatim", () => {
  assert.match(worlds.worldErrorMessage("SELECTED_WORLD_CHANGED", "en"), /changed/);
  assert.match(worlds.worldErrorMessage("WORLD_NOT_FOUND", "zh"), /\u4e0d\u5b58\u5728/);
  assert.match(worlds.worldErrorMessage("Unsupported Craftmine panel operation", "en"), /does not provide/);
  assert.equal(worlds.worldErrorMessage("disk full on drive D", "en"), "disk full on drive D");
});

test("bridge uses the plugin channel names and reports switch failure without a world change", async () => {
  const calls = [];
  const bridge = worlds.createCraftmineWorldBridge(async (pluginId, channel, payload) => {
    calls.push([pluginId, channel, payload]);
    if (channel === "world.list") return { worlds: [{ id: "w1", title: "One", revision: 2, updatedAt: 5 }], activeWorldId: "w1" };
    if (channel === "world.switch") throw new Error("Injected save failure");
    if (channel === "world.create") return { id: "w2", title: "Two" };
    return {};
  });
  const list = await bridge.list();
  assert.equal(calls[0][0], "craftmine.world");
  assert.equal(calls[0][1], "world.list");
  assert.equal(list.worlds[0].title, "One");
  assert.deepEqual(await bridge.switchWorld("w2"), { ok: false, error: "Injected save failure", activeWorldId: null });
  assert.deepEqual(await bridge.create({ title: "Two" }), { id: "w2", title: "Two" });
});

test("create without a host identity is an error, not a silent success", async () => {
  const bridge = worlds.createCraftmineWorldBridge(async () => ({ title: "no id" }));
  await assert.rejects(() => bridge.create({ title: "x" }), /WORLD_CREATE_NO_ID/);
});

test("the bridge resolves only from the documented host seams", () => {
  const saved = { seam: globalThis.__craftmineWorldBridge, preload: globalThis.piDesktop };
  try {
    delete globalThis.__craftmineWorldBridge;
    delete globalThis.piDesktop;
    assert.equal(worlds.craftmineHostInvoker(), null);
    assert.equal(worlds.craftmineWorldBridge(), null);
    const seen = [];
    globalThis.__craftmineWorldBridge = { invoke: async (pluginId, channel) => (seen.push([pluginId, channel]), { worlds: [] }) };
    assert.equal(typeof worlds.craftmineHostInvoker(), "function");
    globalThis.__craftmineWorldBridge = async () => ({ worlds: [] });
    assert.equal(typeof worlds.craftmineHostInvoker(), "function");
    globalThis.__craftmineWorldBridge = undefined;
    globalThis.piDesktop = { pluginPanelInvoke: async () => ({ worlds: [] }) };
    assert.equal(typeof worlds.craftmineHostInvoker(), "function");
  } finally {
    if (saved.seam === undefined) delete globalThis.__craftmineWorldBridge;
    else globalThis.__craftmineWorldBridge = saved.seam;
    if (saved.preload === undefined) delete globalThis.piDesktop;
    else globalThis.piDesktop = saved.preload;
  }
});

test("auxiliary sections cover the six surfaces and report missing channels", async () => {
  assert.deepEqual(
    aux.CRAFTMINE_AUX_SECTIONS.map((section) => section.id),
    ["works", "assets", "checks", "memory", "tasks", "backups"],
  );
  assert.equal(aux.craftmineAuxSection("assets").channel, null);
  const calls = [];
  const bridge = {
    call: async (channel, payload) => {
      calls.push([channel, payload]);
      if (channel === "verification.list") return [{ status: "passed" }];
      if (channel === "library.search") return { items: [{}, {}], total: 7 };
      return {};
    },
  };
  assert.equal(await aux.loadAuxSummary(bridge, "w1", "assets"), null);
  assert.equal(calls.length, 0);
  assert.deepEqual(await aux.loadAuxSummary(bridge, "w1", "checks"), { id: "checks", label: "\u68c0\u67e5", count: 1, detail: "passed" });
  assert.equal((await aux.loadAuxSummary(bridge, "w1", "works")).count, 7);
  assert.equal(calls[0][1].worldId, "w1");
  assert.equal(aux.auxSummaryText(null, "en"), "Not connected");
  assert.match(aux.auxSummaryText({ id: "x", label: "x", count: 3, detail: "passed" }, "zh"), /3/);
});

test("auxiliary expansion is remembered per section and tolerates corrupt storage", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  layout.rememberCraftmineAux(storage, "checks", true);
  layout.rememberCraftmineAux(storage, "memory", true);
  layout.rememberCraftmineAux(storage, "memory", false);
  assert.deepEqual(layout.loadCraftmineLayout(storage).aux, { checks: true, memory: false });
  store.set("craftmine.desktop.layout.v1", '{"mode":"play","widths":{"play":670},"aux":"broken"}');
  const recovered = layout.loadCraftmineLayout(storage);
  assert.deepEqual(recovered.aux, {});
  assert.equal(recovered.mode, "play");
  assert.equal(recovered.widths.play, 670);
  assert.equal(recovered.chatWidth, layout.CRAFTMINE_CHAT_DEFAULT_WIDTH);
});

test("world navigation renders the list, create flow and auxiliary surfaces on demand", async () => {
  const list = await source("../src/components/craftmine/WorldListPanel.tsx");
  assert.match(list, /data-world-list-state=\{controller\.status\}/);
  assert.match(list, /data-world-base-state=\{worldBaseState\(entry\)\}/);
  assert.match(list, /data-world-active=/);
  assert.match(list, /data-world-notice="error"/);
  assert.match(list, /data-action="new-world"/);
  const create = await source("../src/components/craftmine/WorldCreatePanel.tsx");
  assert.match(create, /disabled=\{!base\.delivered\}/);
  assert.match(create, /disabled=\{!starter\.delivered\}/);
  assert.match(create, /data-world-create="name"/);
  assert.match(create, /maxLength=\{CRAFTMINE_WORLD_TITLE_MAX\}/);
  const panels = await source("../src/components/craftmine/WorldAuxSections.tsx");
  assert.match(panels, /aria-expanded=\{open\}/);
  assert.match(panels, /rememberCraftmineAux\(localStorage, id, next\)/);
  assert.match(panels, /data-aux-open=\{section\.id\}/);
  const nav = await source("../src/components/CraftmineNavigation.tsx");
  assert.match(nav, /data-nav="world"/);
  assert.match(nav, /<WorldListPanel /);
  assert.match(nav, /<WorldAuxSections /);
  assert.match(nav, /data-world-session=\{activeSessionId\}/);
  assert.match(nav, /<CraftmineLayoutControls \/>/);
});

test("the world list never stores a second world database in the renderer", async () => {
  for (const path of [
    "../src/lib/craftmine-worlds.ts",
    "../src/lib/craftmine-aux.ts",
    "../src/components/craftmine/WorldListPanel.tsx",
    "../src/components/craftmine/WorldCreatePanel.tsx",
    "../src/components/craftmine/WorldAuxSections.tsx",
  ]) {
    const text = await source(path);
    assert.doesNotMatch(text, /localStorage\.setItem\([^)]*world/i, path);
  }
  const lib = await source("../src/lib/craftmine-worlds.ts");
  assert.match(lib, /CRAFTMINE_REQUIRED_CHANNELS/);
  assert.match(lib, /world\.switch/);
});