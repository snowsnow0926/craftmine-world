import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { parseCreationTarget, creationRequestContext, copyCreationRequestContext } = await import("../src/lib/creation-target.ts");
const { parseWorldCapabilities, worldStartersForBase, worldCreationBaseLabel, resolveWorldCreationSelection } = await import("../src/lib/craftmine-worlds.ts");
const sample = target => ({captureId: "capture-a", worldId: "world-a", target});
const ground = {surface: "ground", entityId: null, position: [2, 0, -4], normal: [0, 1, 0], revision: 3};

test("only finite host entity/ground hits become visible targets", () => {
  assert.deepEqual(parseCreationTarget(sample(ground)).target, ground);
  assert.equal(parseCreationTarget(sample({...ground, surface: "entity", entityId: "house-a"})).target.entityId, "house-a");
  for (const invalid of [{...ground, surface: "boundary"}, {...ground, surface: "none"}, {...ground, position: [NaN, 0, 0]}, {...ground, normal: null}, {...ground, surface: "entity"}, {...ground, revision: -1}]) {
    const parsed = parseCreationTarget(sample(invalid));
    assert.equal(parsed.target, null);
    assert.equal(parsed.captureId, null);
  }
});

test("no ray hit retains world context without inventing a placement point", () => {
  const missing = parseCreationTarget(sample(null));
  assert.equal(missing.target, null);
  assert.deepEqual(creationRequestContext(missing), {creationTarget: {captureId: "capture-a"}});
  assert.equal(creationRequestContext(parseCreationTarget({captureId: null, target: null, reason: "UNSUPPORTED_BASE"})), undefined);
});

test("submitted context is an isolated opaque snapshot, not a mutable aiming vector", () => {
  const capture = parseCreationTarget(sample(ground));
  const submitted = creationRequestContext(capture);
  capture.captureId = "capture-b";
  capture.target.position[0] = 50;
  assert.deepEqual(submitted, {creationTarget: {captureId: "capture-a"}});
  const queued = copyCreationRequestContext(submitted);
  submitted.creationTarget.captureId = "capture-c";
  assert.deepEqual(queued, {creationTarget: {captureId: "capture-a"}});
});

test("creation-world starters come from their own delivered catalog", () => {
  const capabilities = parseWorldCapabilities({bases: [
    {id: "first-person", label: "First person", delivered: true, starters: [{id: "training", delivered: true}]},
    {id: "creation-sandbox", label: "Creation sandbox", delivered: true, starters: [{id: "blank", delivered: true}]},
    {id: "planned", delivered: false, starters: []},
  ], starters: [{id: "legacy-town", delivered: true}]});
  assert.deepEqual(worldStartersForBase(capabilities, "creation-sandbox").map(item => item.id), ["blank"]);
  assert.deepEqual(worldStartersForBase(capabilities, "planned"), []);
  assert.deepEqual(resolveWorldCreationSelection(capabilities, "creation-sandbox", "training"), {baseId: "creation-sandbox", starterId: ""});
  assert.deepEqual(resolveWorldCreationSelection(capabilities, "creation-sandbox", ""), {baseId: "creation-sandbox", starterId: "blank"});
  assert.equal(worldCreationBaseLabel(capabilities.bases[1], "zh"), "造物世界");
  assert.equal(capabilities.bases[2].delivered, false);
});

test("older hosts retain their legacy starter choices without inventing creation-world support", () => {
  const capabilities = parseWorldCapabilities({bases: [{id: "legacy", label: "Legacy", delivered: true}], starters: [{id: "town", delivered: true}]});
  assert.deepEqual(worldStartersForBase(capabilities, "legacy").map(item => item.id), ["town"]);
  assert.equal(capabilities.bases.some(base => base.id === "creation-sandbox"), false);
});
