import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

const layout = await import("../src/lib/craftmine-layout.ts");
const { immersionKeyAction } = await import("../src/lib/craftmine-immersion-keys.ts");
const storage = value => ({ getItem: () => JSON.stringify(value) });

test("existing layout preferences migrate without opening an overlay", () => {
  const saved = layout.loadCraftmineLayout(storage({ mode: "play", chatWidth: 430, widths: { create: 490, play: 680 } }));
  assert.equal(saved.overlay, "closed");
  assert.equal(saved.mode, "play");
  assert.equal(saved.chatWidth, 430);
  assert.deepEqual(saved.widths, { create: 490, play: 680 });
  for (const invalid of ["other", null, {}, 1]) assert.equal(layout.loadCraftmineLayout(storage({ overlay: invalid })).overlay, "closed");
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

test("application shortcuts toggle levels and Escape closes only an open layer", () => {
  assert.equal(immersionKeyAction({ key: "F2" }, "closed", false), "compact");
  assert.equal(immersionKeyAction({ key: "F2", shiftKey: true }, "compact", false), "full");
  assert.equal(immersionKeyAction({ key: "F2" }, "compact", false), "closed");
  assert.equal(immersionKeyAction({ key: "Escape" }, "full", false), "closed");
  assert.equal(immersionKeyAction({ key: "Escape" }, "closed", false), null);
  assert.equal(immersionKeyAction({ key: "F11" }, "full", false), null);
});

test("IME, repeat, modifiers and higher layers retain their input", () => {
  for (const key of ["F2", "Escape"]) {
    for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { defaultPrevented: true }]) {
      assert.equal(immersionKeyAction({ key, ...guard }, "full", false), null);
    }
    assert.equal(immersionKeyAction({ key }, "full", true), null);
  }
  assert.equal(immersionKeyAction({ key: "Escape", shiftKey: true }, "full", false), null);
});
