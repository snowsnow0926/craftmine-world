import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {register} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";

register(pathToFileURL(fileURLToPath(new URL("./helpers/ts-import-hooks.mjs", import.meta.url))));
const creation = await import("../electron/main/godot-world-creation.ts");
const {createGodotPanelCoordinator} = await import("../electron/main/godot-panel-coordinator.ts");

const root = path.resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const catalogFile = path.join(root, "desktop/godot/bases/base-catalog.json");
const basesRoot = path.join(root, "desktop/godot/bases");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "r2-creation-"));

test("the shipped catalog offers only delivered Godot bases and their templates", () => {
  const options = creation.readGodotCreateOptions({catalogFile, basesRoot});
  assert.deepEqual([...options.bases.map((base) => base.id)].sort(), ["first-person", "side-view", "top-down"]);
  assert.ok(options.bases.every((base) => base.delivered && base.templates.length >= 2));
  assert.deepEqual(options.bases.find((base) => base.id === "top-down").templates.map((t) => t.id), ["blank", "town"]);
  assert.equal(options.createActions, true);
  const missing = creation.readGodotCreateOptions({catalogFile, basesRoot: path.join(root, "nope")});
  assert.ok(missing.bases.every((base) => base.delivered === false), "an absent source is not delivered");
});

test("creation requests are bounded and refuse bases this client cannot build", () => {
  assert.deepEqual(creation.validateGodotCreateRequest({title: " 小镇 ", baseId: "top-down", starterId: "town"}),
    {title: "小镇", baseId: "top-down", templateId: "town"});
  assert.deepEqual(creation.validateGodotCreateRequest({title: "x", baseId: "side-view"}).templateId, "blank");
  for (const input of [{title: "", baseId: "top-down"}, {title: "x".repeat(81), baseId: "top-down"},
    {title: "x", baseId: "mining-sandbox"}, {title: "x", baseId: "top-down", starterId: "../evil"}]) {
    assert.throws(() => creation.validateGodotCreateRequest(input), /INVALID_WORLD_TITLE|WORLD_BASE_UNAVAILABLE|WORLD_STARTER_UNAVAILABLE/);
  }
});

test("initial progress comes from the base and never from the client", () => {
  const dir = tmp();
  assert.throws(() => creation.readBaseInitialBody(dir), /BASE_INITIAL_STATE_MISSING/);
  fs.writeFileSync(path.join(dir, "world.json"), JSON.stringify({worldId: "example-blank", initialProgress: {coins: 0, sceneId: "world"}}));
  const body = creation.readBaseInitialBody(dir);
  assert.deepEqual(body, {coins: 0, sceneId: "world"});
  const envelope = creation.buildInitialProgress({worldId: "world-a1", baseId: "top-down", baseVersion: "1.0.0", stateVersion: 1, body});
  assert.deepEqual(envelope, {format: "craftmine.godot-progress/1", worldId: "world-a1", baseId: "top-down",
    baseVersion: "1.0.0", stateVersion: 1, body: {coins: 0, sceneId: "world"}});
  assert.throws(() => creation.buildInitialProgress({worldId: "world-a1", baseId: "top-down", stateVersion: 0, body}), /INVALID_GODOT_PROGRESS/);
  assert.throws(() => creation.buildInitialProgress({worldId: "world-a1", baseId: "top-down", stateVersion: 1, body: []}), /INVALID_GODOT_PROGRESS/);
});

test("core init status maps to real stages and never to a pass", () => {
  const status = (value) => creation.initStatusToCreation(value);
  const pending = status({status: "pending", initId: "gwinit-1", playable: false});
  assert.equal(pending.state, "initializing");
  assert.deepEqual(pending.creation.stages.map((s) => s.status), ["passed", "running", "pending", "pending"]);
  assert.equal(pending.creation.progress, 25);
  const drafting = status({status: "drafting", playable: false});
  assert.deepEqual(drafting.creation.stages.map((s) => s.status), ["passed", "passed", "running", "pending"]);
  const blocked = status({status: "blocked", reason: "GODOT_EXECUTION_UNAVAILABLE", playable: false});
  assert.equal(blocked.state, "failed");
  assert.equal(blocked.creation.error.code, "GODOT_EXECUTION_UNAVAILABLE");
  assert.equal(blocked.creation.error.recoverable, true);
  assert.deepEqual(blocked.creation.stages.map((s) => s.status), ["passed", "passed", "failed", "pending"]);
  assert.deepEqual(blocked.creation.actions, ["retry", "details"]);
  const failed = status({status: "failed", reason: "GODOT_PROJECT_REVISION_CONFLICT", playable: false});
  assert.equal(failed.creation.error.code, "GODOT_PROJECT_REVISION_CONFLICT");
  assert.deepEqual(failed.creation.stages.map((s) => s.status), ["passed", "failed", "pending", "pending"]);
  const checked = status({status: "checked", playable: false});
  assert.deepEqual(checked.creation.stages.map((s) => s.status), ["passed", "passed", "passed", "running"]);
  const confirmed = status({status: "confirmed", playable: true});
  assert.equal(confirmed.state, "ready");
  assert.equal(confirmed.creation.progress, 100);
  assert.ok(confirmed.creation.stages.every((s) => s.status === "passed"));
  const silent = status(null);
  assert.equal(silent.state, "initializing");
  assert.equal(silent.creation, null, "a silent core must not get invented stages");
});

test("the factory registers through the core and removes a failed managed copy", async () => {
  const worldsRoot = tmp();
  const calls = [];
  const materialize = ({out}) => {
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, "world.json"), JSON.stringify({worldId: "example", initialProgress: {coins: 0, sceneId: "world"}}));
  };
  const factory = creation.createGodotWorldFactory({
    worldsRoot, catalogFile, basesRoot,
    domain: async (method, params) => { calls.push([method, params]); return {init: {status: "pending", initId: "gwinit-x", playable: false}}; },
    materialize, makeWorldId: () => "world-test1",
  });
  const created = await factory.create({title: "小镇", baseId: "top-down", starterId: "blank"});
  assert.equal(created.state, "initializing");
  assert.deepEqual(calls.map(([method]) => method), ["godotWorld.initialize"]);
  assert.equal(calls[0][1].snapshot.worldId, "world-test1");
  assert.equal(calls[0][1].snapshot.baseId, "top-down");
  assert.equal(calls[0][1].snapshot.body.coins, 0);
  assert.equal(calls[0][1].baseBuild, "top-down-1.0.0");

  const failing = creation.createGodotWorldFactory({
    worldsRoot, catalogFile, basesRoot,
    domain: async () => { throw new Error("WORLD_EXISTS"); },
    materialize, makeWorldId: () => "world-test2",
  });
  await assert.rejects(failing.create({title: "重复", baseId: "top-down"}), /WORLD_EXISTS/);
  assert.equal(fs.existsSync(path.join(worldsRoot, "world-test2")), false, "a failed creation leaves no project behind");
  assert.equal(await factory.status("world-test1").then((s) => s.state), "initializing");
  assert.equal(await creation.createGodotWorldFactory({
    worldsRoot, catalogFile, basesRoot, domain: async () => { throw new Error("UNSUPPORTED_HOST_OPERATION"); },
    materialize, makeWorldId: () => "world-test3",
  }).status("world-test3"), null, "a missing route reports unknown, never a fake ready");
});

test("the panel coordinator serves Godot bases, creation and real world state", async () => {
  const forwarded = [];
  const host = {instance: null, state: {state: "closed"}, setSurfaceVisible: () => {}, resume: async () => {}, pause: async () => {},
    save: async () => ({status: "persisted", receipt: {}}), checkpoint: async () => ({status: "persisted", receipt: {}})};
  const adapter = {allowedRoots: () => [], describe: async () => null, progress: async () => null, describeCandidate: async () => null};
  const factory = {
    options: {create: true, createActions: true, bases: [{id: "top-down", baseVersion: "1.0.0", label: "2D 俯视", description: "d", delivered: true,
      templates: [{id: "blank", label: "空白", kind: "blank-start", description: "", delivered: true}]}]},
    create: async (payload) => { forwarded.push(["create", payload]); return {id: "world-x", title: payload.title, state: "initializing", creation: {operationId: "o", stage: "project", stages: [], progress: 25, error: null, actions: ["details"]}}; },
    status: async (worldId) => worldId === "godot1" ? {state: "failed", creation: {operationId: "o2", stage: "build", stages: [], progress: 60,
      error: {code: "GODOT_EXECUTION_UNAVAILABLE", message: "no executor", stage: "build", recoverable: true}, actions: ["retry"]}} : null,
  };
  const coordinator = createGodotPanelCoordinator({
    host, adapter, selection: async () => "godot1", creation: () => factory,
    invoke: async (channel, payload) => {
      forwarded.push([channel, payload]);
      if (channel === "world.createOptions") return {create: true, switch: true, bases: [{id: "craftmine-web/5", label: "网页体素", delivered: true}], starters: [{id: "blank", label: "空白", delivered: true}]};
      if (channel === "world.list") return {activeWorldId: "godot1", worlds: [
        {id: "godot1", title: "G", runtimeKind: "godot"}, {id: "web1", title: "W", runtimeKind: "legacy"}]};
      return {ok: true};
    },
  });

  const options = await coordinator.invoke("world.createOptions", {});
  assert.deepEqual(options.bases.map((b) => b.id), ["craftmine-web/5", "top-down"]);
  assert.equal(options.createActions, true);
  assert.equal(options.bases[1].starters[0].id, "blank");

  const created = await coordinator.invoke("world.create", {title: "小镇", baseId: "top-down", starterId: "blank"});
  assert.equal(created.id, "world-x");
  assert.equal(forwarded.some(([channel]) => channel === "create"), true);
  await coordinator.invoke("world.create", {title: "旧世界", baseId: "craftmine-web/5"});
  assert.equal(forwarded.at(-1)[0], "world.create", "the legacy base still goes to the plugin");

  const list = await coordinator.invoke("world.list", {});
  const godot = list.worlds.find((world) => world.id === "godot1");
  assert.equal(godot.state, "failed");
  assert.equal(godot.creation.error.code, "GODOT_EXECUTION_UNAVAILABLE");
  assert.equal(list.worlds.find((world) => world.id === "web1").state, undefined);
  assert.equal(list.activeWorldId, "godot1");
});
