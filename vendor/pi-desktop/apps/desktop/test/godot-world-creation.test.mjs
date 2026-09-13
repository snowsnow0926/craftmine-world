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
const desktop = path.join(root, "vendor/pi-desktop/apps/desktop");
const catalogFile = path.join(root, "desktop/godot/bases/base-catalog.json");
const basesRoot = path.join(root, "desktop/godot/bases");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "r2-creation-"));

test("the shipped catalog offers only delivered Godot bases and their templates", () => {
  const options = creation.readGodotCreateOptions({catalogFile, basesRoot});
  assert.deepEqual([...options.bases.map((base) => base.id)].sort(), ["creation-sandbox", "first-person", "mining-sandbox", "side-view", "top-down"]);
  assert.ok(options.bases.every((base) => base.delivered && base.templates.length >= (base.id === "creation-sandbox" ? 1 : 2)));
  assert.deepEqual(options.bases.find((base) => base.id === "creation-sandbox").templates.map((t) => t.id), ["blank", "promo-mainline", "promo-flight", "promo-rain", "promo-city"]);
  assert.deepEqual(options.bases.find((base) => base.id === "top-down").templates.map((t) => t.id), ["blank", "town"]);
  assert.equal(options.createActions, true);
  const missing = creation.readGodotCreateOptions({catalogFile, basesRoot: path.join(root, "nope")});
  assert.ok(missing.bases.every((base) => base.delivered === false), "an absent source is not delivered");
});

test("creation requests are bounded and refuse bases this client cannot build", () => {
  assert.deepEqual(
    (({title, baseId, templateId}) => ({title, baseId, templateId}))(
      creation.validateGodotCreateRequest({title: " 小镇 ", baseId: "top-down", starterId: "town"})),
    {title: "小镇", baseId: "top-down", templateId: "town"});
  assert.deepEqual(creation.validateGodotCreateRequest({title: "x", baseId: "side-view"}).templateId, "blank");
  assert.match(creation.validateGodotCreateRequest({title: "x", baseId: "side-view"}).operationId, /^[a-f0-9]{32}$/,
    "a missing operation id is generated once per request");
  for (const input of [{title: "", baseId: "top-down"}, {title: "x".repeat(81), baseId: "top-down"},
    {title: "x", baseId: "unsupported-base"}, {title: "x", baseId: "top-down", starterId: "../evil"}]) {
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
    baseVersion: "1.0.0", stateVersion: 1, body: {coins: 0, sceneId: "world", worldId: "world-a1"}});
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

test("the shipped materializer loads from an absolute path exactly once", async () => {
  const modulePath = path.join(root, "desktop/godot/shared/materialize.mjs");
  await assert.rejects(() => creation.loadMaterializer(`file:///${modulePath}`), /MATERIALIZER_PATH_REQUIRED/);
  await assert.rejects(() => creation.loadMaterializer(path.join(root, "desktop/godot/shared/missing.mjs")), /MATERIALIZER_NOT_FOUND/);
  const materialize = await creation.loadMaterializer(modulePath);
  assert.equal(typeof materialize, "function");
  const out = path.join(tmp(), "world-materialized");
  materialize({baseId: "top-down", worldId: "world-mat1", template: "blank", out});
  assert.equal(fs.existsSync(path.join(out, "project.godot")), true, "the real module materialized a project");
  const captured = JSON.parse(fs.readFileSync(path.join(root, "desktop/godot/shared/initial-states/top-down-blank.json"), "utf8"));
  const {worldId: _authoredId, ...expected} = captured.snapshot.body;
  assert.deepEqual(creation.readBaseInitialBody(out), expected);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "craftmine_initial_state.json"), "utf8")).initialProgress.worldId, "world-mat1");
});

test("the main process passes a path, never a pre-converted URL", async () => {
  const source = fs.readFileSync(path.join(desktop, "electron/main/index.ts"), "utf8");
  assert.match(source, /loadMaterializer\(join\(godotRoot, "shared", "materialize\.mjs"\)\)/);
  assert.doesNotMatch(source, /loadMaterializer\(pathToFileURL/);
});

test("world ids are stable per operation and reject unsafe ids", () => {
  assert.equal(creation.worldIdForOperation("op-abcdefgh"), creation.worldIdForOperation("op-abcdefgh"));
  assert.notEqual(creation.worldIdForOperation("op-abcdefgh"), creation.worldIdForOperation("op-abcdefgi"));
  assert.match(creation.worldIdForOperation("op-abcdefgh"), /^world-[a-f0-9]{12}$/);
  assert.throws(() => creation.worldIdForOperation("short"), /INVALID_OPERATION_ID/);
  assert.deepEqual(creation.validateGodotCreateRequest({title: "x", baseId: "top-down", operationId: "op-abcdefgh"}).operationId, "op-abcdefgh");
  assert.throws(() => creation.validateGodotCreateRequest({title: "x", baseId: "top-down", operationId: "../evil"}), /INVALID_OPERATION_ID/);
});

test("a lost reply is reconciled against the core and never deletes a registered world", async () => {
  const worldsRoot = tmp();
  const calls = [];
  const materialize = ({out}) => {
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, "world.json"), JSON.stringify({initialProgress: {coins: 0}}));
  };
  const factory = creation.createGodotWorldFactory({
    worldsRoot, catalogFile, basesRoot, materialize,
    domain: async (method, params) => {
      calls.push(method);
      if (method === "godotWorld.initialize") throw new Error("transport lost");
      if (method === "godotWorld.initStatus") return {status: "pending", initId: "gwinit-1", playable: false, worldId: params.worldId};
      throw new Error(`unexpected ${method}`);
    },
  });
  const created = await factory.create({title: "小镇", baseId: "top-down", operationId: "op-lostreply1"});
  assert.equal(created.state, "initializing");
  assert.deepEqual(calls, ["godotWorld.initialize", "godotWorld.initStatus"]);
  assert.equal(fs.existsSync(path.join(worldsRoot, creation.worldIdForOperation("op-lostreply1"))), true,
    "a committed world keeps its materialized source");
});

test("an unknown outcome keeps the source and reports a retryable identity", async () => {
  const worldsRoot = tmp();
  const materialize = ({out}) => {
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, "world.json"), JSON.stringify({initialProgress: {coins: 0}}));
  };
  const factory = creation.createGodotWorldFactory({
    worldsRoot, catalogFile, basesRoot, materialize,
    domain: async () => { throw new Error("host unavailable"); },
  });
  await assert.rejects(factory.create({title: "小镇", baseId: "top-down", operationId: "op-uncertain1"}), (error) => {
    assert.equal(error.message, "WORLD_CREATE_UNCERTAIN");
    assert.equal(error.worldId, creation.worldIdForOperation("op-uncertain1"));
    assert.equal(error.operationId, "op-uncertain1");
    return true;
  });
  assert.equal(fs.existsSync(path.join(worldsRoot, creation.worldIdForOperation("op-uncertain1"))), true);
});

test("a world the core never registered releases its managed copy", async () => {
  const worldsRoot = tmp();
  const materialize = ({out}) => {
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, "world.json"), JSON.stringify({initialProgress: {coins: 0}}));
  };
  const factory = creation.createGodotWorldFactory({
    worldsRoot, catalogFile, basesRoot, materialize,
    domain: async (method) => {
      if (method === "godotWorld.initialize") throw new Error("WORLD_EXISTS");
      throw Object.assign(new Error("GODOT_WORLD_NOT_INITIALIZING"), {code: "GODOT_WORLD_NOT_INITIALIZING"});
    },
  });
  await assert.rejects(factory.create({title: "小镇", baseId: "top-down", operationId: "op-never1"}), /WORLD_EXISTS/);
  assert.equal(fs.existsSync(path.join(worldsRoot, creation.worldIdForOperation("op-never1"))), false);
});
test("the factory registers through the core and releases only an unregistered copy", async () => {
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
  const created = await factory.create({title: "小镇", baseId: "top-down", starterId: "blank", operationId: "op-test1"});
  assert.equal(created.state, "initializing");
  assert.deepEqual(calls.map(([method]) => method), ["godotWorld.initialize"]);
  assert.equal(calls[0][1].snapshot.worldId, "world-test1");
  assert.equal(calls[0][1].snapshot.baseId, "top-down");
  assert.equal(calls[0][1].snapshot.body.coins, 0);
  assert.equal(calls[0][1].baseBuild, "top-down-1.0.0");

  const failing = creation.createGodotWorldFactory({
    worldsRoot, catalogFile, basesRoot,
    domain: async (method) => {
      if (method === "godotWorld.initialize") throw new Error("WORLD_EXISTS");
      throw Object.assign(new Error("GODOT_WORLD_NOT_INITIALIZING"), {code: "GODOT_WORLD_NOT_INITIALIZING"});
    },
    materialize, makeWorldId: () => "world-test2",
  });
  await assert.rejects(failing.create({title: "重复", baseId: "top-down"}), /WORLD_EXISTS/);
  assert.equal(fs.existsSync(path.join(worldsRoot, "world-test2")), false, "an unregistered copy is released");
  assert.equal(await factory.status("world-test1").then((s) => s.state), "initializing");
  assert.equal(await creation.createGodotWorldFactory({
    worldsRoot, catalogFile, basesRoot, domain: async () => { throw new Error("UNSUPPORTED_HOST_OPERATION"); },
    materialize, makeWorldId: () => "world-test3",
  }).status("world-test3"), null, "a missing route reports unknown, never a fake ready");
});

test("passive slot status does not resume initialization before the player enters", async () => {
  const worldsRoot=tmp(),worldId='world-passive';
  fs.mkdirSync(path.join(worldsRoot,worldId));
  fs.writeFileSync(path.join(worldsRoot,worldId,'.creation-owner.json'),'{}');
  const starts=[];
  const factory=creation.createGodotWorldFactory({worldsRoot,catalogFile,basesRoot,
    domain:async()=>({status:'pending',playable:false}),
    initialization:{running:()=>false,start:async id=>{starts.push(id);},error:()=>null},
  });
  assert.equal((await factory.status(worldId,{resume:false})).state,'initializing');
  assert.deepEqual(starts,[]);
  await factory.status(worldId);
  assert.deepEqual(starts,[worldId]);
});

test("the main process injects the isolated Godot build verifier", () => {
  const index = fs.readFileSync(path.join(desktop, "electron/main/index.ts"), "utf8");
  assert.match(index, /import \{ GodotBuildVerifier \} from "\.\/godot-build-verifier"/);
  assert.match(index, /const godotVerifier = new GodotBuildVerifier\(\)/);
  assert.match(index, /godotVerification: \{/);
  assert.match(index, /godotVerifier\.cancelAll\(\)/);
  const runtime = fs.readFileSync(path.join(desktop, "electron/main/plugin-runtime.ts"), "utf8");
  assert.match(runtime, /case "craftmine\.godotCheck":/);
  assert.match(runtime, /case "craftmine\.cancelGodotCheck":/);
  assert.match(runtime, /godotVerification\?: \{/);
});

test("the create panel keeps one stable operation id for retries", () => {
  const panel = fs.readFileSync(path.join(desktop, "src/components/craftmine/WorldCreatePanel.tsx"), "utf8");
  assert.match(panel, /const operationId = useRef<string>\(/);
  assert.match(panel, /operationId: operationId\.current/);
  const gateway = fs.readFileSync(path.join(desktop, "electron/main/craftmine-navigation-host.ts"), "utf8");
  assert.match(gateway, /INVALID_OPERATION_ID/);
  assert.match(gateway, /operationId: payload\.operationId/);
});

test("the shipped Godot root resolves from the compiled main process directory", () => {
  const compiledMain = path.join(desktop, "out/main");
  const resolved = creation.resolveGodotRoot({startDir: compiledMain});
  assert.equal(resolved, path.join(root, "desktop/godot"));
  assert.equal(fs.existsSync(path.join(resolved, "bases/base-catalog.json")), true);
  assert.throws(() => creation.resolveGodotRoot({startDir: tmp()}), /GODOT_BASES_UNAVAILABLE/);
  // A packaged build carries the same tree under resources/godot.
  const resources = tmp();
  fs.mkdirSync(path.join(resources, "godot/bases"), {recursive: true});
  fs.writeFileSync(path.join(resources, "godot/bases/base-catalog.json"), "{}");
  assert.equal(creation.resolveGodotRoot({resourcesPath: resources, startDir: tmp()}), path.join(resources, "godot"));
  const override = tmp();
  fs.mkdirSync(path.join(override, "bases"), {recursive: true});
  fs.writeFileSync(path.join(override, "bases/base-catalog.json"), "{}");
  assert.equal(creation.resolveGodotRoot({resourcesPath: resources, startDir: tmp(), override}), override);
});

test("the panel coordinator serves Godot bases, creation and real world state", async () => {
  const forwarded = [];
  const statusReads = [];
  const host = {instance: null, state: {state: "closed"}, setSurfaceVisible: () => {}, resume: async () => {}, pause: async () => {},
    holdSelectionSync: async () => () => {}, switchWorld: async (value) => {forwarded.push(["switchWorld", value]);},
    save: async () => ({status: "persisted", receipt: {}}), checkpoint: async () => ({status: "persisted", receipt: {}})};
  const adapter = {allowedRoots: () => [], describe: async () => null, progress: async () => null, describeCandidate: async () => null};
  const factory = {
    options: {create: true, createActions: true, bases: [{id: "top-down", baseVersion: "1.0.0", label: "2D 俯视", description: "d", delivered: true,
      templates: [{id: "blank", label: "空白", kind: "blank-start", description: "", delivered: true},
        {id: "sample", label: "Example", kind: "example", description: "", delivered: true, preview: "data:image/png;base64,example"}]}]},
    create: async (payload) => { forwarded.push(["create", payload]); return {id: "world-x", title: payload.title, state: "initializing", creation: {operationId: "o", stage: "project", stages: [], progress: 25, error: null, actions: ["details"]}}; },
    status: async (worldId, options) => {statusReads.push({worldId, options});return worldId === "godot1" ? {state: "failed", creation: {operationId: "o2", stage: "build", stages: [], progress: 60,
      error: {code: "GODOT_EXECUTION_UNAVAILABLE", message: "no executor", stage: "build", recoverable: true}, actions: ["retry"]}} : null;},
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
  assert.deepEqual(options.bases[0].starters.map(starter => starter.id), ["blank"], "Web cannot inherit Godot examples");
  assert.equal(options.bases[1].starters[1].preview, "data:image/png;base64,example");
  assert.equal(options.starters.find(starter => starter.id === "sample").preview, undefined, "large previews are sent once in the base catalog");

  const created = await coordinator.invoke("world.create", {title: "小镇", baseId: "top-down", starterId: "blank"});
  assert.equal(created.id, "world-x");
  assert.equal(forwarded.some(([channel]) => channel === "create"), true);
  assert.ok(forwarded.some(([channel, value]) => channel === "world.open" && value.id === created.id));
  await coordinator.invoke("world.create", {title: "旧世界", baseId: "craftmine-web/5"});
  assert.equal(forwarded.at(-1)[0], "world.create", "the legacy base still goes to the plugin");

  const list = await coordinator.invoke("world.list", {});
  const godot = list.worlds.find((world) => world.id === "godot1");
  assert.equal(godot.state, "failed");
  assert.equal(godot.creation.error.code, "GODOT_EXECUTION_UNAVAILABLE");
  assert.equal(list.worlds.find((world) => world.id === "web1").state, undefined);
  assert.equal(list.activeWorldId, "godot1");
  assert.deepEqual(statusReads, [{worldId: "godot1", options: {resume: false}}]);
});
