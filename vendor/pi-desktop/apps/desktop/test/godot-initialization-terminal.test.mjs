import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {register} from "node:module";
import {fileURLToPath} from "node:url";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {createGodotWorldFactory, worldIdForOperation} = await import("../electron/main/godot-world-creation.ts");
const {createGodotWorldInitializer} = await import("../electron/main/godot-world-initialization.ts");
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");
const pathCode = "GODOT_TASK_PATH_TOO_LONG";

// Real factory/initializer and filesystem; the domain is a controlled durable
// state fixture, not an engine/core execution or packaged acceptance claim.
function fixture(t, initialStatus = "pending") {
  const worldsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cm-init-terminal-"));
  t.after(() => fs.rmSync(worldsRoot, {recursive: true, force: true}));
  const payload = {title: "Terminal initialization", baseId: "first-person", starterId: "blank", operationId: "terminal-operation-1"};
  const worldId = worldIdForOperation(payload.operationId);
  const projectText = "config_version=5\n[application]\nconfig/name=\"Terminal fixture\"\n";
  const projectHash = sha(projectText);
  const calls = [];
  let durable = {worldId, initId: "gwinit-fixture", status: initialStatus, playable: false, reason: initialStatus === "pending" ? null : pathCode};
  let jobCount = 0;
  let taskCount = 0;
  let recoverable = false;
  let resumed = false;
  let nextJobPasses = false;
  const materialize = ({out}) => {
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, "project.godot"), projectText);
    fs.writeFileSync(path.join(out, "world-build.json"), JSON.stringify({initialProgress: {sceneId: "fixture"}}));
    fs.writeFileSync(path.join(out, "managed-base.json"), JSON.stringify({worldId, baseId: "first-person",
      files: [{path: "project.godot", bytes: Buffer.byteLength(projectText), sha256: projectHash}]}));
  };
  const domain = async (method, args) => {
    calls.push({method, args});
    switch (method) {
      case "godotWorld.initialize": {
        const {playable: _playable, ...record} = durable;
        return {init: record}; // The real initialize transaction returns a raw record.
      }
      case "godotWorld.initStatus": return {...durable};
      case "task.recoverable": return {items: recoverable ? [{worldId, taskId: "previous-task", generation: 1,
        binding: {sessionId: `create-${worldId}`}}] : []};
      case "task.resume": resumed = true; return {};
      case "turn.begin":
        if (recoverable && !resumed) throw Error("EXPLICIT_RECOVERY_REQUIRED");
        taskCount += 1;
        return {binding: {baseBuild: "first-person-fixture"}};
      case "godotProject.index": return {revision: 1, manifestHash: "source-fixture", files: [{path: "project.godot", sha256: projectHash}]};
      case "content.status": return {backend: "git"};
      case "godotCandidate.list": return {items: []};
      case "godotExecutor.status": return {buildAvailable: true, checkAvailable: true};
      case "godotBuild.start": jobCount += 1; return {jobId: `job-${jobCount}`};
      case "godotBuild.read":
        if (nextJobPasses) return {status: "passed", candidateId: "candidate-recovered"};
        durable = {...durable, status: "failed", reason: pathCode};
        recoverable = true;
        return {status: "failed", output: {compile: {errors: [pathCode]}}};
      case "workspace.endTurn": return {};
      default: throw Error(`UNEXPECTED_DOMAIN_METHOD:${method}`);
    }
  };
  function open() {
    const initializer = createGodotWorldInitializer({worldsRoot, domain, selection: async () => worldId,
      firstLoad: async (id, candidateId) => {
        assert.equal(id, worldId);
        assert.equal(candidateId, "candidate-recovered");
        calls.push({method: "firstLoad", args: {worldId: id, candidateId}});
        durable = {...durable, status: "confirmed", playable: true, reason: null};
      }});
    const factory = createGodotWorldFactory({worldsRoot, domain, materialize, initialization: initializer,
      catalogFile: path.join(root, "desktop/godot/bases/base-catalog.json"), basesRoot: path.join(root, "desktop/godot/bases")});
    return {factory, initializer};
  }
  return {worldId, payload, worldsRoot, calls, open,
    counts: () => ({jobCount, taskCount}),
    allowRecovery: () => {nextJobPasses = true;},
    setStatus: (status, reason = pathCode) => {durable = {...durable, status, reason, playable: false};},
    sourceHash: () => sha(fs.readFileSync(path.join(worldsRoot, worldId, "project.godot")))};
}

test("failed creation survives factory/initializer restart and replay without opening a task; explicit retry resumes", async t => {
  const f = fixture(t);
  let {factory, initializer} = f.open();
  await factory.create(f.payload);
  assert.ok(f.calls.some(call => call.method === "godotWorld.initStatus"), "raw initialize reply starts the initializer immediately");
  await initializer.start(f.worldId);
  assert.deepEqual(f.counts(), {jobCount: 1, taskCount: 1});
  assert.equal(initializer.error(f.worldId), `Error: ${pathCode}`);
  const expected = await factory.status(f.worldId);
  assert.equal(expected.creation.error.code, pathCode);
  assert.equal(expected.creation.stage, "build");
  assert.equal(expected.creation.error.stage, "build");
  assert.match(expected.creation.error.message, /路径过长/);
  const originalSource = f.sourceHash();
  const beforeRestart = f.calls.length;

  ({factory, initializer} = f.open());
  assert.equal(initializer.error(f.worldId), null, "restart has no transient failure map");
  for (let read = 0; read < 3; read += 1) assert.deepEqual(await factory.status(f.worldId), expected);
  const replay = await factory.create(f.payload);
  assert.deepEqual(replay.creation, expected.creation);
  await initializer.start(f.worldId); // Defend callers outside the factory too.
  assert.deepEqual(await factory.status(f.worldId), expected);
  assert.equal(initializer.error(f.worldId), null);
  assert.equal(initializer.busy, false);
  assert.deepEqual(f.counts(), {jobCount: 1, taskCount: 1});
  assert.ok(f.calls.slice(beforeRestart).every(call => call.method === "godotWorld.initStatus"));
  assert.equal(f.sourceHash(), originalSource);

  const retryStart = f.calls.length;
  f.allowRecovery();
  await factory.retry(f.worldId);
  assert.equal(initializer.error(f.worldId), null);
  assert.deepEqual(f.counts(), {jobCount: 2, taskCount: 2});
  const retryMethods = f.calls.slice(retryStart).map(call => call.method);
  assert.ok(retryMethods.indexOf("task.recoverable") < retryMethods.indexOf("task.resume"));
  assert.ok(retryMethods.indexOf("task.resume") < retryMethods.indexOf("turn.begin"));
  assert.ok(retryMethods.includes("godotBuild.start"));
  assert.ok(retryMethods.includes("firstLoad"));
  assert.equal(f.calls.at(-1).args.status, "completed");
  assert.equal((await factory.status(f.worldId)).state, "ready");
  assert.equal(f.sourceHash(), originalSource);
});

for (const status of ["failed", "cancelled", "interrupted", "blocked", "unrecognized"]) {
  test(`${status} is not automatically retried by create replay, status or direct start`, async t => {
    const f = fixture(t, status);
    const {factory, initializer} = f.open();
    await factory.create(f.payload);
    await initializer.start(f.worldId);
    await factory.create(f.payload);
    await factory.status(f.worldId);
    await initializer.start(f.worldId);
    assert.deepEqual(f.counts(), {jobCount: 0, taskCount: 0});
    assert.ok(f.calls.every(call => ["godotWorld.initialize", "godotWorld.initStatus"].includes(call.method)));
  });
}

test("a failed explicit recovery cannot replace the trusted durable path reason", async t => {
  const f = fixture(t);
  const {factory, initializer} = f.open();
  await factory.create(f.payload);
  await initializer.start(f.worldId);
  // Simulate a separate recovery failure after a durable job already failed.
  fs.writeFileSync(path.join(f.worldsRoot, f.worldId, "managed-base.json"), "{}");
  await factory.retry(f.worldId);
  assert.equal(initializer.error(f.worldId), "Error: MANAGED_BASE_IDENTITY_MISMATCH");
  const current = await factory.status(f.worldId);
  assert.equal(current.creation.error.code, pathCode);
  assert.equal(current.creation.stage, "build");
  assert.equal(current.creation.error.stage, "build");
  assert.deepEqual(f.counts(), {jobCount: 1, taskCount: 1});
});

for (const status of ["pending", "drafting", "building", "checked"]) {
  test(`${status} retains automatic continuation`, async t => {
    const f = fixture(t, status);
    const {factory, initializer} = f.open();
    await factory.create(f.payload);
    assert.ok(f.calls.some(call => call.method === "godotWorld.initStatus"), "creation starts unfinished work without a status poll");
    await initializer.start(f.worldId);
    assert.deepEqual(f.counts(), {jobCount: 1, taskCount: 1});
    assert.equal(initializer.error(f.worldId), `Error: ${pathCode}`);
  });
}
