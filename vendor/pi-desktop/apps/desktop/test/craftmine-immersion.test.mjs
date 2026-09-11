import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

const layout = await import("../src/lib/craftmine-layout.ts");
const { immersionKeyAction, applyImmersionKey, immersionShortcutAction } = await import("../src/lib/craftmine-immersion-keys.ts");
const storage = value => ({ getItem: () => JSON.stringify(value) });

test("existing layout preferences migrate without opening an overlay", () => {
  const saved = layout.loadCraftmineLayout(storage({ mode: "play", chatWidth: 430, widths: { create: 490, play: 680 } }));
  assert.equal(saved.overlay, "closed");
  assert.equal(saved.mode, "play");
  assert.equal(saved.chatWidth, 430);
  assert.deepEqual(saved.widths, { create: 490, play: 680 });
  // A layout stored before entering play was an option keeps the documented
  // default, and never invents a world the automatic switch already ran for.
  assert.equal(saved.playWhenWorldActivates, true);
  assert.equal(saved.enteredWorldId, null);
  for (const invalid of ["other", null, {}, 1]) assert.equal(layout.loadCraftmineLayout(storage({ overlay: invalid })).overlay, "closed");
  for (const invalid of [null, "", 7, {}]) assert.equal(layout.loadCraftmineLayout(storage({ enteredWorldId: invalid })).enteredWorldId, null);
  assert.equal(layout.loadCraftmineLayout(storage({ playWhenWorldActivates: false })).playWhenWorldActivates, false);
  assert.equal(layout.loadCraftmineLayout(storage({ playWhenWorldActivates: "false" })).playWhenWorldActivates, true);
});

test("presentation transitions preserve widths and open no session or task", () => {
  const saved = layout.loadCraftmineLayout(storage({ mode: "create", overlay: "full", chatWidth: 420 }));
  const playing = layout.changeCraftmineLayout(saved, "play", 515);
  assert.equal(playing.overlay, "closed");
  assert.equal(playing.chatWidth, 420);
  assert.equal(playing.widths.create, 515);
  assert.equal(saved.overlay, "full");
  assert.equal(layout.toggleCraftmineOverlay("closed", "compact"), "compact");
  assert.equal(layout.toggleCraftmineOverlay("compact", "full"), "full");
  assert.equal(layout.toggleCraftmineOverlay("full", "full"), "closed");
  assert.equal(layout.toggleCraftmineOverlay("full", "compact"), "compact");
});

test("only the visible controls state the entry preference", () => {
  const saved = layout.loadCraftmineLayout(storage({}));
  // The automatic switch into play must not turn the default into a preference.
  const automatic = layout.changeCraftmineLayout(saved, "play", 480);
  assert.equal(automatic.mode, "play");
  assert.equal(automatic.playWhenWorldActivates, true);
  assert.equal(layout.changeCraftmineLayout(saved, "create", 480, { explicit: true }).playWhenWorldActivates, false);
  assert.equal(layout.changeCraftmineLayout(saved, "play", 480, { explicit: true }).playWhenWorldActivates, true);
  assert.equal(layout.changeCraftmineLayout({ ...saved, playWhenWorldActivates: false }, "play", 480).playWhenWorldActivates, false);
});

test("activating a world fills the workspace once and never overrides a return", () => {
  const base = { enteredWorldId: null, playWhenWorldActivates: true, playing: false };
  assert.deepEqual(layout.decideCraftmineActivation({ ...base, worldId: "world-a" }), { switchToPlay: true, enteredWorldId: "world-a" });
  // The same activation is not replayed after a reload or an explicit return.
  assert.deepEqual(layout.decideCraftmineActivation({ ...base, worldId: "world-a", enteredWorldId: "world-a" }), { switchToPlay: false, enteredWorldId: "world-a" });
  assert.deepEqual(layout.decideCraftmineActivation({ ...base, worldId: "world-b", enteredWorldId: "world-a" }), { switchToPlay: true, enteredWorldId: "world-b" });
  // No world, an already playing workspace, and a stored "keep the workbench"
  // preference all leave the presentation alone while still marking the world.
  assert.deepEqual(layout.decideCraftmineActivation({ ...base, worldId: null }), { switchToPlay: false, enteredWorldId: null });
  assert.deepEqual(layout.decideCraftmineActivation({ ...base, worldId: "world-a", playing: true }), { switchToPlay: false, enteredWorldId: "world-a" });
  assert.deepEqual(layout.decideCraftmineActivation({ ...base, worldId: "world-a", playWhenWorldActivates: false }), { switchToPlay: false, enteredWorldId: "world-a" });
});

test("application shortcuts toggle levels and layer Escape out of play", () => {
  assert.equal(immersionKeyAction({ key: "F2" }, "closed", false), "compact");
  assert.equal(immersionKeyAction({ key: "F2", shiftKey: true }, "compact", false), "full");
  assert.equal(immersionKeyAction({ key: "F2" }, "compact", false), "closed");
  assert.equal(immersionKeyAction({ key: "Escape" }, "full", false), "closed");
  assert.equal(immersionKeyAction({ key: "Escape" }, "compact", false), "closed");
  // The second Escape has no overlay left to close and returns to the workbench.
  assert.equal(immersionKeyAction({ key: "Escape" }, "closed", false), "exit-play");
  assert.equal(immersionKeyAction({ key: "Escape", shiftKey: true }, "closed", false), null);
  assert.equal(immersionKeyAction({ key: "F11" }, "full", false), null);
});

test("one application point serves overlay and exit decisions", () => {
  const applied = [];
  const host = { setOverlay: value => applied.push(["overlay", value]), exitPlay: () => applied.push(["exit"]) };
  assert.equal(applyImmersionKey(null, host), false);
  assert.equal(applyImmersionKey("compact", host), true);
  assert.equal(applyImmersionKey("closed", host), true);
  assert.equal(applyImmersionKey("exit-play", host), true);
  assert.deepEqual(applied, [["overlay", "compact"], ["overlay", "closed"], ["exit"]]);
});

test("IME, repeat, modifiers and higher layers retain their input", () => {
  for (const key of ["F2", "Escape"]) {
    for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { defaultPrevented: true }]) {
      assert.equal(immersionKeyAction({ key, ...guard }, "full", false), null);
    }
    assert.equal(immersionKeyAction({ key }, "full", true), null);
    // Escape out of play is blocked by the same guards as an overlay close.
    assert.equal(immersionKeyAction({ key }, "closed", true), null);
  }
  assert.equal(immersionKeyAction({ key: "Escape", shiftKey: true }, "full", false), null);
});

test("a shortcut forwarded from the native surface lands on the same decision", () => {
  assert.equal(immersionShortcutAction("compact", "closed"), "compact");
  assert.equal(immersionShortcutAction("full", "compact"), "full");
  assert.equal(immersionShortcutAction("escape", "full"), "closed");
  assert.equal(immersionShortcutAction("exit-play", "closed"), "exit-play");
  const applied = [];
  const host = { setOverlay: value => applied.push(["overlay", value]), exitPlay: () => applied.push(["exit"]) };
  for (const [action, overlay] of [["compact", "closed"], ["escape", "compact"], ["exit-play", "closed"]]) {
    applyImmersionKey(immersionShortcutAction(action, overlay), host);
  }
  assert.deepEqual(applied, [["overlay", "compact"], ["overlay", "closed"], ["exit"]]);
});
