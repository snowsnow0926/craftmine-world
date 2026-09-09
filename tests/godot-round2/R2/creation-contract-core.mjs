/**
 * R2 · the creation payload this client builds is accepted by the real core.
 *
 * Spawns the real craftmine-core binary over its stdio JSON-lines protocol and
 * runs the exact sequence the Electron coordinator runs: materialize a shipped
 * base, read its published initial progress, call `godotWorld.initialize`, then
 * read `godotWorld.initStatus`. Nothing is stubbed except the domain transport.
 *
 * The product route from Electron main to these core methods is requested from
 * C in docs/dispatch-reports/godot-round2/R2/INTERFACE_REQUEST.md; this test
 * proves the payload contract independently of that route.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync, spawn} from "node:child_process";
import {createRequire, register} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const desktop = path.join(root, "vendor/pi-desktop/apps/desktop");
fs.mkdirSync(path.join(root, "test-results"), {recursive: true});
const out = fs.mkdtempSync(path.join(root, "test-results/godot-round2-r2-creation-"));
const report = {kind: "real-core-godot-world-initialization-contract", sourceCommit: null, engine: {}, checks: [], errors: [],
  limits: [
    "Proves the client payload against the real core; the panel route from Electron main is still requested from C.",
    "No first build, no candidate, no visible game window: initialization stops at the durable pending record.",
  ]};
const check = (name, value, detail) => {
  report.checks.push({name, passed: !!value, ...(detail ? {detail} : {})});
  assert.ok(value, name);
  console.log("PASS " + name);
};

const binary = process.env.CRAFTMINE_CORE_BIN || path.join(root, "vendor/pi-desktop/target/release/craftmine-core.exe");
if (!fs.existsSync(binary)) throw new Error("build craftmine-core first or set CRAFTMINE_CORE_BIN");
const crypto = await import("node:crypto");
report.engine = {
  coreBinary: path.basename(binary),
  coreSha256: crypto.createHash("sha256").update(fs.readFileSync(binary)).digest("hex"),
  godotEngine: JSON.parse(fs.readFileSync(path.join(root, "desktop/godot/bases/base-catalog.json"), "utf8")).engine,
};

register(pathToFileURL(path.join(desktop, "test/helpers/ts-import-hooks.mjs")));
const creation = await import(pathToFileURL(path.join(desktop, "electron/main/godot-world-creation.ts")).href);

// --- real core transport (stdio JSON lines) --------------------------------
const child = spawn(binary, ["--data-dir", path.join(out, "core")], {windowsHide: true, stdio: ["pipe", "pipe", "pipe"]});
let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    const resolver = pending.get(message.id);
    if (!resolver) continue;
    pending.delete(message.id);
    message.error ? resolver.reject(Object.assign(new Error(message.error.message), {code: message.error.code})) : resolver.resolve(message.result);
  }
});
let sequence = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = `r2-${++sequence}`;
  pending.set(id, {resolve, reject});
  child.stdin.write(JSON.stringify({id, method, params}) + "\n");
});

try {
  const hello = await call("hello");
  check("真实核心报告 Godot 工程能力", hello.godotProjects === true, hello);

  const options = creation.readGodotCreateOptions({
    catalogFile: path.join(root, "desktop/godot/bases/base-catalog.json"),
    basesRoot: path.join(root, "desktop/godot/bases"),
  });
  check("客户端只提供已交付的 Godot 底座", options.bases.length === 3
    && options.bases.every((base) => base.delivered && base.templates.length >= 2), options.bases.map((b) => [b.id, b.templates.map((t) => t.id)]));

  const materialize = await creation.loadMaterializer(path.join(root, "desktop/godot/shared/materialize.mjs"));
  const factory = creation.createGodotWorldFactory({
    worldsRoot: path.join(out, "worlds"),
    catalogFile: path.join(root, "desktop/godot/bases/base-catalog.json"),
    basesRoot: path.join(root, "desktop/godot/bases"),
    domain: (method, params) => call(method, params),
    materialize,
    makeWorldId: () => "world-r2contract",
  });

  const created = await factory.create({title: "契约世界", baseId: "top-down", starterId: "blank"});
  check("客户端创建的 Godot 世界经真实核心登记", created.id === "world-r2contract" && created.state === "initializing", created);
  check("登记后世界带有真实初始化步骤而不是假进度",
    created.creation?.stages?.length === 4 && created.creation.stages[0].status === "passed"
    && created.creation.progress > 0, created.creation);

  const record = await call("world.read", {id: "world-r2contract"});
  check("核心中是世界记录且标记为 Godot 初始化中",
    record.runtimeKind === "godot" && record.world.build.godot.initializing === true
    && record.world.build.scene.baseId === "top-down", record.world.build);
  check("初始进度来自底座自己发布的初始状态",
    record.world.snapshot.format === creation.PROGRESS_FORMAT
    && record.world.snapshot.baseId === "top-down"
    && record.world.snapshot.worldId === "world-r2contract"
    && record.world.snapshot.body.coins === 0, record.world.snapshot.body);

  const status = await call("godotWorld.initStatus", {worldId: "world-r2contract"});
  check("真实 initStatus 报告不可游玩", status.playable === false && status.status === "pending", status);
  const mapped = creation.initStatusToCreation(status);
  check("客户端把真实状态映射为初始化中且不切换", mapped.state === "initializing" && mapped.creation.error === null, mapped);

  let describe = null;
  let describeError = null;
  try { describe = await call("godotRuntime.describe", {worldId: "world-r2contract"}); }
  catch (error) { describeError = error.code ?? String(error.message); }
  check("未完成初始化的世界不能被描述为可运行",
    describeError === "GODOT_WORLD_NOT_INITIALIZED" || describe?.error?.code === "GODOT_WORLD_NOT_INITIALIZED", {describeError, describe});

  const replay = await call("godotWorld.initialize", {
    worldId: "world-r2contract", title: "契约世界", baseId: "top-down",
    baseBuild: "top-down-1.0.0",
    snapshot: record.world.snapshot,
  });
  check("重复初始化是幂等重放而不是第二个世界", replay.replayed === true, replay);

  await assert.rejects(factory.create({title: "坏底座", baseId: "mining-sandbox", starterId: "blank"}), /WORLD_BASE_UNAVAILABLE/);
  await assert.rejects(factory.create({title: "坏起点", baseId: "top-down", starterId: "nope"}), /WORLD_STARTER_UNAVAILABLE/);
  await assert.rejects(factory.create({title: " ", baseId: "top-down"}), /INVALID_WORLD_TITLE/);
  check("未交付底座、未知起点和空名称都被拒绝", true);

  const firstPerson = creation.readGodotCreateOptions({
    catalogFile: path.join(root, "desktop/godot/bases/base-catalog.json"),
    basesRoot: path.join(root, "desktop/godot/bases"),
  }).bases.find((base) => base.id === "first-person");
  let firstPersonError = null;
  try {
    await creation.createGodotWorldFactory({
      worldsRoot: path.join(out, "worlds2"),
      catalogFile: path.join(root, "desktop/godot/bases/base-catalog.json"),
      basesRoot: path.join(root, "desktop/godot/bases"),
      domain: (method, params) => call(method, params),
      materialize,
      makeWorldId: () => "world-r2firstperson",
    }).create({title: "第一人称", baseId: "first-person", starterId: "blank"});
  } catch (error) { firstPersonError = String(error.message); }
  check("缺少初始状态发布的底座不会被伪造创建",
    firstPersonError === "BASE_INITIAL_STATE_MISSING" && !fs.existsSync(path.join(out, "worlds2", "world-r2firstperson")), firstPersonError);
  report.firstPersonBase = {id: firstPerson?.id, templates: firstPerson?.templates?.map((t) => t.id)};
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
  console.error(error);
} finally {
  child.stdin.end();
  child.kill();
  report.sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log("Evidence: " + out);
}
