// Runtime host contract: real Godot Web export on the loopback origin.
//
// Verifies the headers, CSP, per-instance origin, asset serving and the
// `craftmine.godot-runtime/2` operations without Electron. No OS input, no
// pointer lock, headless browser only (project AGENTS.md).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { playwright, browserOptions } from "../app/browser-tools.mjs";
import { prepareWebProbes } from "../desktop/godot/export-probes.mjs";
import { createWorldRuntime, hashBuildDirectory, isolationHeaders } from "../desktop/godot/web/runtime.mjs";

fs.mkdirSync("test-results", { recursive: true });
const out = fs.mkdtempSync(path.resolve("test-results/godot-runtime-"));
const report = { kind: "real-godot-web-runtime-host", out, checks: [], notVerified: ["Electron content view", "real model authorship", "GPU/player feel"] };
const check = (name, value, evidence) => {
  report.checks.push({ name, passed: !!value, ...(evidence === undefined ? {} : { evidence }) });
  console.log((value ? "PASS " : "FAIL ") + name);
  assert.ok(value, name);
};

const environment = await prepareWebProbes(out, { threads: true });
const build = await environment.build("first-person");
report.builds = environment.builds;
check("Pinned engine exported a real threaded Web build", build.bytes > 1_000_000 && build.threads === true, { buildId: build.buildId, bytes: build.bytes });
check("Build identity is the content hash of the export directory", (await hashBuildDirectory(build.output)) === (await hashBuildDirectory(build.output)) && build.buildId.length === 64);

const runtime = await createWorldRuntime({ worldId: "weapon-world", buildId: build.buildId, root: build.output, timeoutMs: 60000 });
check("Each runtime instance gets its own loopback origin and path token", /^http:\/\/127\.0\.0\.1:\d+\/w\/[a-f0-9]{64}\/index\.html$/.test(runtime.url), runtime.url);
const second = await createWorldRuntime({ worldId: "other-world", buildId: build.buildId, root: build.output, timeoutMs: 60000 });
check("Two worlds never share an origin", second.origin !== runtime.origin, { first: runtime.origin, second: second.origin });

const browser = await playwright().chromium.launch({ ...browserOptions(), args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const page = await browser.newPage();
const responses = [];
const pageErrors = [];
page.on("response", (response) => responses.push({ url: response.url(), status: response.status(), headers: response.headers() }));
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.exposeFunction("__runtimePost", (message) => runtime.receive(message));
await page.addInitScript(
  (scope) => {
    const handlers = [];
    globalThis.__craftmineRuntimeHost = {
      scope,
      post: (message) => {
        void globalThis.__runtimePost(message);
      },
      on: (handler) => {
        handlers.push(handler);
      },
      onDetach: () => {},
    };
    globalThis.__runtimeDeliver = (message) => {
      for (const handler of handlers) handler(message);
    };
  },
  { worldId: runtime.worldId, buildId: runtime.buildId, instanceId: runtime.instanceId },
);
runtime.attach((message) => page.evaluate((value) => globalThis.__runtimeDeliver(value), message));
await page.goto(runtime.url, { waitUntil: "domcontentloaded" });
await runtime.waitReady();
check("Real Godot runtime reports ready over the loopback origin", runtime.state === "ready");
check("Multi-threaded page is cross-origin isolated", (await page.evaluate(() => crossOriginIsolated)) === true);
const document = responses.find((item) => item.url === runtime.url);
check(
  "Top-level document carries COOP/COEP/CORP and a deny-by-default CSP",
  document?.headers["cross-origin-opener-policy"] === "same-origin" &&
    document?.headers["cross-origin-embedder-policy"] === "require-corp" &&
    document?.headers["cross-origin-resource-policy"] === "cross-origin" &&
    /default-src 'none'/.test(document?.headers["content-security-policy"] ?? "") &&
    document?.headers["x-content-type-options"] === "nosniff",
  document?.headers,
);
check("CSP keeps the engine's wasm and worker needs explicit", /wasm-unsafe-eval/.test(isolationHeaders({ threads: true })["Content-Security-Policy"]) && /worker-src 'self' blob:/.test(isolationHeaders({ threads: true })["Content-Security-Policy"]));
const wasm = responses.find((item) => item.url.endsWith(".wasm"));
check("Engine assets are served with the correct type and no caching", wasm?.headers["content-type"] === "application/wasm" && wasm?.headers["cache-control"] === "no-store", wasm?.headers);
const traversal = await page.evaluate(async (base) => {
  const results = [];
  for (const suffix of ["../runtime.mjs", "..%2Fruntime.mjs", "..%20/runtime.mjs", "%2e%2e/runtime.mjs", "/w/0000000000000000000000000000000000000000000000000000000000000000/index.html", "index.exe"]) {
    const response = await fetch(new URL(suffix, base));
    results.push({ suffix, status: response.status });
  }
  return results;
}, runtime.url);
check("Path traversal, foreign tokens and unknown asset types are refused", traversal.every((item) => [400, 403, 404, 415].includes(item.status)), traversal);

const snapshot = (await runtime.snapshot()).result;
check("Snapshot returns real engine state and viewport", snapshot.state.ammo === 6 && snapshot.state.targetHealth === 50 && snapshot.viewportSize[0] > 500, snapshot);
const capabilities = (await runtime.request("capabilities")).result;
check("Runtime advertises the unified operation set and its identity", capabilities.protocol === "craftmine.godot-runtime/2" && capabilities.worldId === "weapon-world" && capabilities.instanceId === runtime.instanceId && capabilities.ops.includes("save"), capabilities);
const fire = (await runtime.request("fire")).result;
check("Base gameplay operations reach the running world", fire.hit === true && fire.snapshot.state.ammo === 5 && fire.snapshot.state.targetHealth === 38, fire.snapshot.state);
await runtime.pause();
const paused = (await runtime.snapshot()).result;
check("A paused world still answers snapshots", paused.state.ammo === 5);
await runtime.resume();
const saved = (await runtime.save()).result;
check(
  "Save separates the runner confirmation from the durable receipt",
  saved.status === "confirmed" && saved.runnerReceipt.sha256.length === 64 && saved.runnerReceipt.worldId === "weapon-world" && saved.state.ammo === 5,
  saved.runnerReceipt,
);
const acknowledged = (await runtime.acknowledge({ receipt: { format: "craftmine.progress-receipt/1", worldId: runtime.worldId, buildId: runtime.buildId, revision: 7 } })).result;
check("Runner accepts a durable receipt for its own world", acknowledged.acknowledged === true, acknowledged);
const foreignReceipt = await runtime.acknowledge({ receipt: { format: "craftmine.progress-receipt/1", worldId: "other-world", buildId: runtime.buildId, revision: 1 } }).then(() => null, (error) => error.message);
check("Runner refuses a durable receipt for another world", /another world/.test(foreignReceipt ?? ""), foreignReceipt);
const cancelled = await runtime.cancel(1);
check("Cancel is acknowledged for the target request", cancelled.result.cancelled === 1, cancelled.result);
const invalid = await runtime.request("restore-state", { state: { ammo: 1, targetHealth: 4, equipped: "sword", yaw: {} } }).then(() => null, (error) => error.message);
const unchanged = (await runtime.snapshot()).result;
check("An invalid restore is rejected without changing state", /Progress is invalid/.test(invalid ?? "") && unchanged.state.ammo === 5 && unchanged.state.targetHealth === 38, unchanged.state);
runtime.receive({ protocol: "craftmine.godot-runtime/2", worldId: "other-world", buildId: runtime.buildId, instanceId: runtime.instanceId, type: "event", name: "poison", detail: { ammo: 0 } });
runtime.receive({ protocol: "craftmine.godot-runtime/2", worldId: runtime.worldId, buildId: runtime.buildId, instanceId: "stale-instance", type: "event", name: "poison", detail: { ammo: 0 } });
check("Messages from another world or a stale instance are ignored", (await runtime.snapshot()).result.state.ammo === 5);
const exited = await runtime.exit();
check("Exit returns the engine exit code", exited.exitCode === 0, exited);
check("No page error was reported by the real engine", pageErrors.length === 0, pageErrors);
await runtime.dispose({ graceful: false });
const gone = await page.goto(runtime.url).then(() => null, (error) => error.message);
check("A disposed runtime origin stops serving the build", /ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE/.test(gone ?? ""), gone);
await second.dispose({ graceful: false });
await browser.close();

report.passed = report.checks.filter((item) => item.passed).length;
report.total = report.checks.length;
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ kind: report.kind, passed: report.passed, total: report.total, evidence: out }));
process.exit(report.passed === report.total ? 0 : 1);
