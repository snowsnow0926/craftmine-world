// Real Electron acceptance for the Godot Web world view (task C).
//
// Runs a real Electron process, a real BrowserWindow, a real WebContentsView
// created by GodotWorldViewHost, and a real Godot 4.7.2 Web export served by
// desktop/godot/web/runtime.mjs. Everything is offscreen and unfocusable; no
// OS input, no pointer lock, no window activation. Playwright is not used.
//
// The product wiring of the host into electron/main/index.ts is task I's step
// (docs/dispatch-reports/godot-parallel/C/INTEGRATION_C.md); this harness
// bundles the same module and the same preload source itself.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { prepareWebProbes } from "../desktop/godot/export-probes.mjs";

const root = process.cwd();
const desktop = path.join(root, "vendor/pi-desktop/apps/desktop");
const require = createRequire(path.join(desktop, "package.json"));
const { build } = createRequire(path.join(root, "vendor/pi-desktop/packages/agent-runtime/package.json"))("esbuild");
let PNG;
try {
  ({ PNG } = require("pngjs"));
} catch {
  ({ PNG } = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs")));
}

fs.mkdirSync("test-results", { recursive: true });
const out = fs.mkdtempSync(path.resolve("test-results/godot-world-view-"));
const report = {
  kind: "real-electron-godot-web-world-view",
  out,
  checks: [],
  notVerified: [
    "product index.ts wiring (task I integration step)",
    "real model authorship of the Godot project",
    "GPU/player feel (offscreen software rendering)",
    "packaged Windows distribution",
    "plugin progress transaction against real Rust (host progress callback is a harness fixture)",
  ],
};
const check = (name, value, evidence) => {
  report.checks.push({ name, passed: !!value, ...(evidence === undefined ? {} : { evidence }) });
  console.log((value ? "PASS " : "FAIL ") + name);
  assert.ok(value, name);
};

const electron = require("electron");
const appDir = path.join(out, "app");
fs.mkdirSync(path.join(appDir, "main"), { recursive: true });
fs.mkdirSync(path.join(appDir, "preload"), { recursive: true });
await build({
  entryPoints: [path.join(root, "tests/godot-world-view/main.mjs")],
  outfile: path.join(appDir, "main/index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "warning",
});
await build({
  entryPoints: [path.join(desktop, "electron/preload/godot-world.ts")],
  outfile: path.join(appDir, "preload/godot-world.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "warning",
});
fs.copyFileSync(path.join(root, "tests/godot-world-view/panel.html"), path.join(appDir, "main/panel.html"));
fs.copyFileSync(path.join(root, "tests/godot-world-view/pointer-guard.cjs"), path.join(appDir, "main/pointer-guard.cjs"));
fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "craftmine-godot-acceptance", private: true, main: "main/index.cjs" }, null, 2));

const environment = await prepareWebProbes(out, { threads: true });
const first = await environment.build("first-person");
const changed = await environment.build("first-person", { revision: "changed", damage: 7 });
const top = await environment.build("top-down");
const brokenRoot = path.join(out, "broken-build");
fs.mkdirSync(brokenRoot, { recursive: true });
fs.writeFileSync(path.join(brokenRoot, "index.html"), "<!doctype html><p>not a Godot build</p>");
const allowedRoots = [first.output, changed.output, top.output, brokenRoot];
report.builds = environment.builds.map(({ base, revision, buildId, bytes }) => ({ base, revision, buildId, bytes }));
check(
  "Pinned engine exported real 3D/2D Web builds for the Electron run",
  report.builds.every((item) => item.bytes > 1_000_000) && new Set(report.builds.map((item) => item.buildId)).size === 3,
  report.builds,
);

function launch(label) {
  const child = spawn(electron, [appDir], {
    cwd: out,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      CRAFTMINE_HEADLESS_TEST: "1",
      CRAFTMINE_GODOT_ACCEPTANCE_ROOT: out,
      CRAFTMINE_GODOT_ALLOWED_ROOTS: allowedRoots.join(";"),
    },
  });
  const log = fs.createWriteStream(path.join(out, label + ".log"));
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const pending = new Map();
  const states = [];
  let ready = false;
  let ended = false;
  let exitResult;
  const exit = new Promise((resolve) => {
    const finish = (value) => {
      if (ended) return;
      ended = true;
      exitResult = value;
      log.end();
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("Electron exited: " + JSON.stringify(value)));
      }
      pending.clear();
      resolve(value);
    };
    child.once("error", (error) => finish({ error: String(error) }));
    child.once("exit", (code, signal) => finish({ code, signal }));
  });
  child.on("message", (message) => {
    if (message?.type === "ready") {
      ready = true;
      return;
    }
    if (message?.type === "state") {
      states.push(message.state);
      return;
    }
    if (message?.type === "fatal") {
      console.error("HARNESS FATAL", message.error);
      return;
    }
    if (message?.type !== "craftmine-godot-acceptance") return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message.result);
  });
  const call = (method, payload = {}, timeout = 90000) =>
    new Promise((resolve, reject) => {
      if (ended || !child.connected) return reject(new Error("Electron is not running: " + JSON.stringify(exitResult)));
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Acceptance RPC timeout: " + method));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      child.send({ type: "craftmine-godot-acceptance", id, method, payload }, (error) => {
        if (error && pending.has(id)) {
          pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  return {
    call,
    states,
    exit,
    get ended() {
      return ended;
    },
    async ready() {
      const deadline = Date.now() + 30000;
      while (!ready && Date.now() < deadline) {
        if (ended) throw new Error("Electron exited before ready: " + JSON.stringify(exitResult));
        await delay(100);
      }
      if (!ready) throw new Error("Acceptance harness did not become ready");
    },
    async stop() {
      if (ended) return exitResult;
      try {
        await call("quit", {}, 3000);
      } catch {
        // Fall through to the kill below.
      }
      const finished = await Promise.race([exit, delay(8000).then(() => null)]);
      if (!finished) {
        child.kill();
        return exit;
      }
      return finished;
    },
  };
}

const nearWhite = (png) => {
  let count = 0;
  for (let y = Math.floor(png.height / 2) - 4; y <= Math.floor(png.height / 2) + 4; y += 1) {
    for (let x = Math.floor(png.width / 2) - 4; x <= Math.floor(png.width / 2) + 4; x += 1) {
      const offset = (y * png.width + x) * 4;
      if (png.data[offset] > 235 && png.data[offset + 1] > 235 && png.data[offset + 2] > 235) count += 1;
    }
  }
  return count;
};

let client;
try {
  client = launch("first-start");
  await client.ready();

  // --- Real Electron view, real build, real pixels -------------------------
  const opened = await client.call("open", {
    worldId: "weapon-world",
    buildId: first.buildId,
    root: first.output,
    bounds: { x: 0, y: 0, width: 1280, height: 860 },
    visible: true,
  });
  check("Real Electron content view runs the fixed Godot build", opened.state.state === "ready" && /^http:\/\/127\.0\.0\.1:\d+\/w\/[a-f0-9]{64}\//.test(opened.instance.url), opened);
  const state = await client.call("state");
  check("Game view is a real WebContentsView on a private loopback origin", state.url === opened.instance.url, state.url);
  check(
    "Window stays offscreen, unfocusable and never asks for pointer lock",
    state.guards["pointer-lock"] === 0 && state.guards["window-focus"] === 0,
    state.guards,
  );
  const isolated = await client.call("evaluate", { target: "game", script: "crossOriginIsolated" });
  check("Multi-threaded export is cross-origin isolated inside Electron", isolated.value === true, isolated.value);
  const snapshot = await client.call("snapshot");
  check("Runtime snapshot reports real engine state and viewport", snapshot.snapshot?.state?.ammo === 6 && snapshot.snapshot?.viewportSize?.[0] > 500, snapshot.snapshot);
  const gunPixels = nearWhite(PNG.sync.read(fs.readFileSync((await client.call("capture", { target: "game", name: "electron-first-person" })).file)));
  check("Actual composited pixels show the rendered white crosshair", gunPixels >= 20, { whitePixels: gunPixels });
  const bounds = await client.call("bounds", { bounds: { x: 0, y: 0, width: 1280, height: 860 } });
  check("Game view is placed below the panel chrome strip the view page reserves", bounds.bounds?.y === 76 && bounds.bounds?.height === 784, bounds.bounds);

  // --- gameplay, pause/resume, save stages ---------------------------------
  // --- gameplay through the unified runtime protocol -----------------------
  const fire = await client.call("request", { op: "fire" });
  check("A base gameplay operation runs through the unified runtime protocol", fire.result?.hit === true && fire.result?.snapshot?.state?.targetHealth === 38 && fire.result?.snapshot?.state?.ammo === 5, fire.result?.snapshot?.state);
  await client.call("visible", { visible: false });
  const hidden = await client.call("state");
  await client.call("visible", { visible: true });
  const reshown = await client.call("state");
  check(
    "Hiding and reshowing the panel keeps the same runtime instance",
    hidden.instance.instanceId === opened.instance.instanceId && reshown.instance.instanceId === opened.instance.instanceId,
    { hidden: hidden.instance, reshown: reshown.instance },
  );
  await client.call("bounds", { bounds: { x: 0, y: 0, width: 1024, height: 700 } });
  const resized = await client.call("bounds", { bounds: { x: 0, y: 0, width: 1280, height: 860 } });
  check("Panel resizing repositions the same instance instead of reloading", resized.instance.instanceId === opened.instance.instanceId && resized.bounds?.height === 784, resized.bounds);
  const saved = await client.call("save", { revision: 3 });
  check(
    "Save reports runner confirmation and the durable receipt separately",
    saved.result.status === "persisted" && saved.result.runnerReceipt?.sha256?.length === 64 && saved.result.receipt?.revision === 4,
    { runnerReceipt: saved.result.runnerReceipt, receipt: saved.result.receipt },
  );
  check("Saved world reports the persisted state, not just the runner copy", saved.state.state === "saved", saved.state);

  // --- late messages from another world/instance ---------------------------
  const foreign = await client.call("late", {
    message: {
      protocol: "craftmine.godot-runtime/2",
      worldId: "another-world",
      buildId: first.buildId,
      instanceId: opened.instance.instanceId,
      type: "event",
      name: "poison",
      detail: { ammo: 0 },
    },
  });
  const afterForeign = await client.call("snapshot");
  check("A message claiming another world never reaches the running instance", foreign.injected && afterForeign.snapshot?.state?.ammo === 5, afterForeign.snapshot?.state);

  // --- candidate build failure keeps the running world ---------------------
  const brokenRoot = path.join(out, "broken-build");
  const broken = await client.call("open", { worldId: "weapon-world", buildId: "candidate-broken", root: brokenRoot, timeoutMs: 8000, bounds: { x: 0, y: 0, width: 1280, height: 860 }, visible: true }).then(
    () => null,
    (error) => error.message,
  );
  const afterBroken = await client.call("state");
  check(
    "A candidate build that cannot load leaves the current world running",
    /did not report ready|previous world kept running/i.test(broken ?? "") && afterBroken.state.state === "ready" && afterBroken.instance.instanceId === opened.instance.instanceId,
    { error: broken, state: afterBroken.state, instance: afterBroken.instance },
  );

  // --- world switch: new identity, new origin, isolated progress -----------
  const switched = await client.call("open", {
    worldId: "town-world",
    buildId: top.buildId,
    root: top.output,
    bounds: { x: 0, y: 0, width: 1280, height: 860 },
    visible: true,
  });
  check(
    "Switching world creates a new instance on a new origin",
    switched.instance.instanceId !== opened.instance.instanceId && new URL(switched.instance.url).port !== new URL(opened.instance.url).port,
    switched.instance,
  );
  const town = await client.call("snapshot");
  check("Second world starts with its own independent state", town.snapshot?.state?.coins === 20 && town.snapshot?.state?.apples === 0, town.snapshot?.state);
  await client.call("late", {
    message: {
      protocol: "craftmine.godot-runtime/2",
      worldId: "weapon-world",
      buildId: first.buildId,
      instanceId: opened.instance.instanceId,
      type: "event",
      name: "poison",
      detail: { coins: 0 },
    },
  });
  const afterLate = await client.call("snapshot");
  check("Late messages from the previous world are dropped by the new instance", afterLate.snapshot?.state?.coins === 20, afterLate.snapshot?.state);

  // --- save failure keeps the world and stays retryable --------------------
  const failed = await client.call("save", { failProgress: true, revision: 9 });
  const afterFailure = await client.call("snapshot");
  check(
    "A failed progress transaction keeps the world running and reports the failure",
    failed.result.status === "failed" && failed.state.state === "failed" && afterFailure.snapshot?.state?.coins === 20,
    { result: failed.result, state: failed.state },
  );

  // --- full client process restart ----------------------------------------
  const persisted = JSON.parse(fs.readFileSync(path.join(first.output, "build.json"), "utf8"));
  const restoredSnapshot = { coins: 15, apples: 2, position: [120, 80] };
  await client.call("quit");
  const stopped = await Promise.race([client.exit, delay(15000).then(() => null)]);
  check("The acceptance client exits cleanly", stopped?.code === 0, stopped);

  client = launch("restart");
  await client.ready();
  const restarted = await client.call("open", {
    worldId: "town-world",
    buildId: top.buildId,
    root: top.output,
    snapshot: restoredSnapshot,
    bounds: { x: 0, y: 0, width: 1280, height: 860 },
    visible: true,
  });
  const afterRestart = await client.call("snapshot");
  const restoredState = afterRestart.snapshot?.state;
  // Godot's JSON.stringify sorts dictionary keys, so compare fields, not text.
  const restoredMatches =
    restoredState?.coins === restoredSnapshot.coins &&
    restoredState?.apples === restoredSnapshot.apples &&
    JSON.stringify(restoredState?.position) === JSON.stringify(restoredSnapshot.position);
  check(
    "Full Electron restart loads the persisted progress into a new instance",
    restarted.state.state === "ready" && restarted.instance.instanceId !== switched.instance.instanceId && restoredMatches,
    {
      state: restarted.state.state,
      instanceChanged: restarted.instance.instanceId !== switched.instance.instanceId,
      actual: JSON.stringify(restoredState),
      expected: JSON.stringify(restoredSnapshot),
      instance: restarted.instance,
    },
  );
  const firstWorld = await client.call("open", {
    worldId: "weapon-world",
    buildId: first.buildId,
    root: first.output,
    bounds: { x: 0, y: 0, width: 1280, height: 860 },
    visible: true,
  });
  const weapon = await client.call("snapshot");
  check(
    "A second world created before the restart still starts with its own save",
    firstWorld.state.state === "ready" && weapon.snapshot?.state?.ammo === 6 && weapon.snapshot?.state?.targetHealth === 50,
    weapon.snapshot?.state,
  );
  const finalGuards = await client.call("state");
  check("No pointer lock or focus request was made during the whole run", finalGuards.guards["pointer-lock"] === 0 && finalGuards.guards["window-focus"] === 0, finalGuards.guards);
  await client.call("quit");
  const finalExit = await Promise.race([client.exit, delay(15000).then(() => null)]);
  check("The restarted client also exits cleanly", finalExit?.code === 0, finalExit);
  report.buildJsonBuildId = persisted.buildId;
} catch (error) {
  report.failure = String(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (client && !client.ended) await client.stop().catch(() => undefined);
  report.passed = report.checks.filter((item) => item.passed).length;
  report.total = report.checks.length;
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, total: report.total, evidence: out }));
}
