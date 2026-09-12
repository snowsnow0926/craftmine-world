/**
 * R6 asset library UI — model and controller behaviour.
 *
 * The host is never contacted: a fake `call` records every channel and payload,
 * so the assertions describe the exact RPC the panel would send. The React
 * module is imported for its controller factory only; `react` is stubbed
 * because this worktree has no node_modules (no dependency is installed here).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register, registerHooks } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..", "..", "..", "vendor", "pi-desktop", "apps", "desktop");
const assetsDir = join(appRoot, "src", "components", "craftmine", "assets");

register(pathToFileURL(join(appRoot, "test", "helpers", "ts-import-hooks.mjs")));

// Minimal React surface: the controller module only needs the names to resolve.
// No hook is executed in this file, so the stubs never run.
const REACT_STUB = [
  "export const useState = () => { throw new Error('REACT_NOT_AVAILABLE_IN_TESTS'); };",
  "export const useEffect = () => {};",
  "export const useMemo = (fn) => fn();",
  "export const useCallback = (fn) => fn;",
  "export const useRef = (value) => ({ current: value });",
  "export const useSyncExternalStore = () => { throw new Error('REACT_NOT_AVAILABLE_IN_TESTS'); };",
  "export default {};",
].join("\n");

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react") {
      return { url: "r6-test:react", format: "module", shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "r6-test:react") {
      return { format: "module", source: REACT_STUB, shortCircuit: true };
    }
    return next(url, context);
  },
});

const model = await import(pathToFileURL(join(assetsDir, "asset-library-model.ts")).href);
const hookModule = await import(pathToFileURL(join(assetsDir, "use-asset-library.ts")).href);

const {
  buildSearchRequest,
  mergePage,
  describeState,
  stateBadges,
  describePreview,
  previewLabel,
  canRetry,
  thumbnailSrc,
  scopeOptions,
  kindOptions,
  mediaKindOptions,
  scanSummary,
  importRequestFor,
  versionOptions,
  assetIdFromName,
  joinScanPath,
  mediaKindForType,
  normalizeTags,
} = model;
const { createAssetLibraryController, controllerActions } = hookModule;

/* --------------------------------------------------------------- fixtures */

const SOURCE = {
  origin: "player-import",
  author: "player",
  license: "CC0-1.0",
  licenseStatus: "verified",
};

const STATE_FULL = {
  indexed: true,
  previewable: true,
  baseChecked: {
    status: "passed",
    baseId: "craftmine-web",
    baseVersion: 5,
    engineVersion: "5.0",
    target: "web",
    checkerVersion: "check/1",
    detail: "ok",
  },
  appliedToSource: { worldId: "w1", detail: "current" },
};

function card(assetId, version, overrides = {}) {
  return {
    assetId,
    version,
    kind: "object",
    mediaKind: "image",
    contentHash: `hash-${assetId}-${version}`,
    displayName: `${assetId} v${version}`,
    tags: ["crate"],
    favorite: false,
    bytes: 2048,
    fileCount: 1,
    source: { ...SOURCE },
    createdAt: 1000 + version,
    state: {
      indexed: true,
      previewable: false,
      baseChecked: null,
      appliedToSource: null,
    },
    ...overrides,
  };
}

function versionBody(assetId, version, overrides = {}) {
  return {
    assetId,
    version,
    kind: "object",
    mediaKind: "image",
    contentHash: `hash-${assetId}-${version}`,
    displayName: `${assetId} v${version}`,
    bytes: 2048,
    fileCount: 1,
    source: { ...SOURCE },
    createdAt: 1000 + version,
    files: [
      {
        path: "textures/crate.png",
        sha256: "a".repeat(64),
        bytes: 2048,
        mediaType: "image/png",
      },
    ],
    ...overrides,
  };
}

function previewRecord(status, detail, facts, createdAt = 5) {
  return {
    previewerVersion: "asset-preview/1",
    engineVersion: "5.0",
    settingsHash: "default",
    status,
    detail,
    facts,
    createdAt,
  };
}

function fakeHost(handlers) {
  const calls = [];
  const call = async (channel, payload) => {
    calls.push({ channel, payload });
    const handler = handlers[channel];
    if (handler === undefined) throw new Error(`UNEXPECTED_CHANNEL:${channel}`);
    return typeof handler === "function" ? handler(payload) : handler;
  };
  return { calls, call };
}

function selectedController(handlers = {}) {
  const host = fakeHost({
    "asset.read": () => ({
      version_: versionBody("a1", 2),
      state: { ...STATE_FULL },
    }),
    "asset.previewRead": () => ({
      items: [previewRecord("ok", "png 4x4", { picture: true, playable: false })],
      total: 1,
    }),
    "asset.usage": () => ({
      items: [{ version: 2, refKind: "world-current", refId: "w1", detail: "", createdAt: 3 }],
      total: 1,
    }),
    "asset.versions": () => ({
      assetId: "a1",
      items: [
        { version_: versionBody("a1", 2), state: { ...STATE_FULL } },
        { version_: versionBody("a1", 1), state: { indexed: true, previewable: false, baseChecked: null, appliedToSource: null } },
      ],
      total: 2,
      nextOffset: null,
    }),
    ...handlers,
  });
  const controller = createAssetLibraryController(host.call);
  return { controller, calls: host.calls };
}

/* ------------------------------------------------------- search + paging */

test("buildSearchRequest fills host defaults and clamps the page size", () => {
  assert.deepEqual(buildSearchRequest({ scope: "local-library" }), {
    scope: "local-library",
    query: "",
    tags: [],
    favoritesOnly: false,
    latestOnly: true,
    offset: 0,
    limit: 50,
  });
  assert.deepEqual(
    buildSearchRequest({
      scope: "current-world",
      worldId: "  w1  ",
      query: "  crate  ",
      kind: "object",
      mediaKind: "model",
      tags: ["Crate", "base", "crate", " base "],
      favoritesOnly: true,
      latestOnly: false,
      offset: -5,
      limit: 500,
    }),
    {
      scope: "current-world",
      worldId: "w1",
      query: "crate",
      kind: "object",
      mediaKind: "model",
      tags: ["base", "crate"],
      favoritesOnly: true,
      latestOnly: false,
      offset: 0,
      limit: 100,
    },
  );
  // `worldId` is only meaningful for the current-world scope.
  assert.equal("worldId" in buildSearchRequest({ scope: "local-library", worldId: "w1" }), false);
  // Unknown filters are dropped instead of being sent as garbage.
  const filtered = buildSearchRequest({
    scope: "local-library",
    kind: "not-a-kind",
    mediaKind: "not-a-media-kind",
  });
  assert.equal("kind" in filtered, false);
  assert.equal("mediaKind" in filtered, false);
  assert.deepEqual(normalizeTags(["b", "a", "b"]), ["a", "b"]);
});

test("mergePage de-duplicates by assetId+version and keeps order", () => {
  const first = {
    items: [card("a", 1), card("b", 1)],
    total: 4,
    truncated: false,
    nextOffset: 2,
  };
  const second = {
    items: [card("b", 1), card("c", 2)],
    total: 4,
    truncated: true,
    nextOffset: null,
  };
  const merged = mergePage(first, second);
  assert.deepEqual(
    merged.items.map((entry) => `${entry.assetId}#${entry.version}`),
    ["a#1", "b#1", "c#2"],
  );
  assert.equal(merged.total, 4);
  assert.equal(merged.truncated, true);
  assert.equal(merged.nextOffset, null);
  assert.deepEqual(mergePage(null, second).items.map((entry) => entry.assetId), ["b", "c"]);
});

test("controller.search sends the built request and loadMore uses nextOffset", async () => {
  const host = fakeHost({
    "asset.search": (payload) => ({
      items: payload.offset === 0 ? [card("a", 1)] : [card("b", 2)],
      total: 2,
      truncated: false,
      nextOffset: payload.offset === 0 ? 1 : null,
    }),
  });
  const controller = createAssetLibraryController(host.call);
  const page = await controller.search({ scope: "local-library", tags: ["crate"], limit: 10 });
  assert.deepEqual(host.calls[0], {
    channel: "asset.search",
    payload: {
      scope: "local-library",
      query: "",
      tags: ["crate"],
      favoritesOnly: false,
      latestOnly: true,
      offset: 0,
      limit: 10,
    },
  });
  assert.equal(page.total, 2);
  const snapshot = controller.snapshot();
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.nextOffset, 1);
  assert.deepEqual(snapshot.cards.map((entry) => entry.assetId), ["a"]);

  const merged = await controller.loadMore();
  assert.equal(host.calls[1].payload.offset, 1);
  assert.deepEqual(merged.items.map((entry) => entry.assetId), ["a", "b"]);
  assert.equal(controller.snapshot().nextOffset, null);
  assert.equal(controller.snapshot().total, 2);
});

test("scope and category switching send the new filter to the host", async () => {
  const host = fakeHost({
    "asset.search": () => ({ items: [], total: 0, truncated: false, nextOffset: null }),
  });
  const controller = createAssetLibraryController(host.call);
  await controller.search({ scope: "current-world", worldId: "w1" });
  await controller.search({
    scope: "local-library",
    kind: "object",
    mediaKind: "model",
    latestOnly: false,
  });
  assert.equal(host.calls[0].payload.scope, "current-world");
  assert.equal(host.calls[0].payload.worldId, "w1");
  assert.equal(host.calls[1].payload.scope, "local-library");
  assert.equal("worldId" in host.calls[1].payload, false);
  assert.equal(host.calls[1].payload.kind, "object");
  assert.equal(host.calls[1].payload.mediaKind, "model");
  assert.equal(host.calls[1].payload.latestOnly, false);

  assert.deepEqual(scopeOptions().map((option) => option.value), [
    "current-world",
    "local-library",
    "import-source",
  ]);
  assert.deepEqual(kindOptions().map((option) => option.value), [
    "base",
    "world",
    "module",
    "object",
    "scene",
    "raw",
    "data",
  ]);
  assert.deepEqual(
    kindOptions().map((option) => option.label.zh),
    ["底座", "世界", "模块", "物件", "场景", "原始素材", "数据"],
  );
  assert.deepEqual(mediaKindOptions().map((option) => option.value), [
    "image",
    "model",
    "audio",
    "package",
    "other",
  ]);
});

/* --------------------------------------------------------------- states */

test("the four state flags produce four independent badges", () => {
  const idle = describeState({
    indexed: false,
    previewable: false,
    baseChecked: null,
    appliedToSource: null,
  });
  assert.equal(idle.indexed.tone, "warning");
  assert.equal(idle.previewable.tone, "neutral");
  assert.equal(idle.baseChecked.tone, "neutral");
  assert.equal(idle.appliedToSource.tone, "neutral");
  assert.equal(idle.indexed.label, "未索引");
  assert.equal(idle.previewable.label, "无预览结果");
  assert.equal(idle.baseChecked.label, "未做底座检查");
  assert.equal(idle.appliedToSource.label, "未应用到世界");
  // Four distinct labels: one green light must not stand for all of them.
  assert.equal(new Set(Object.values(idle).map((badge) => badge.label)).size, 4);

  const full = describeState(STATE_FULL, "en");
  assert.equal(full.indexed.tone, "success");
  assert.equal(full.previewable.tone, "success");
  assert.equal(full.baseChecked.tone, "success");
  assert.equal(full.appliedToSource.tone, "success");
  assert.match(full.baseChecked.detail, /craftmine-web v5/);
  assert.match(full.appliedToSource.detail, /w1/);

  const failedCheck = describeState({
    indexed: true,
    previewable: false,
    baseChecked: { ...STATE_FULL.baseChecked, status: "failed" },
    appliedToSource: null,
  });
  assert.equal(failedCheck.baseChecked.tone, "error");
  assert.deepEqual(stateBadges(STATE_FULL).map((badge) => badge.key), [
    "indexed",
    "previewable",
    "baseChecked",
    "appliedToSource",
  ]);
});

/* -------------------------------------------------------------- preview */

test("describePreview covers all six statuses with honest copy", () => {
  const pending = describePreview({ status: "pending", detail: "", facts: {}, createdAt: 1 });
  assert.equal(pending.label, "预览中");
  assert.equal(pending.tone, "neutral");
  assert.equal(pending.canRetry, false);
  assert.equal(pending.playable, false);

  const image = describePreview({
    status: "ok",
    detail: "png 4x4",
    facts: { picture: true, playable: false, format: "png", width: 4, height: 4, thumbnailBase64: "AA==" },
    createdAt: 1,
  });
  assert.equal(image.label, "可预览图片");
  assert.equal(image.tone, "success");
  assert.equal(image.picture, true);
  assert.equal(image.playable, false);
  assert.equal(image.canRetry, false);
  assert.match(image.detail, /png 4x4/);
  assert.equal(thumbnailSrc({ status: "ok", detail: "", facts: { picture: true, thumbnailBase64: "AA==" }, createdAt: 1 }), "data:image/png;base64,AA==");

  const wav = describePreview({
    status: "ok",
    detail: "pcm_s16le 1500 ms",
    facts: { playable: true, picture: false, codec: "pcm_s16le", durationMs: 1500, sampleRate: 44100 },
    createdAt: 1,
  });
  assert.equal(wav.label, "可试听");
  assert.equal(wav.playable, true);
  assert.equal(wav.picture, false);
  assert.match(wav.detail, /1\.5 s/);

  const glb = describePreview({
    status: "partial",
    detail: "glb structure only: 12 tris / 2 nodes",
    facts: {
      picture: false,
      playable: false,
      rendered: false,
      renderReason: "model-render-not-implemented",
      triangles: 12,
      nodes: 2,
    },
    createdAt: 1,
  });
  assert.equal(glb.tone, "warning");
  assert.equal(glb.label, "仅结构解析，无画面");
  assert.doesNotMatch(glb.label, /已渲染|rendered/i);
  assert.notEqual(glb.label, "预览完成");
  assert.equal(glb.picture, false);
  assert.equal(glb.playable, false);
  assert.equal(glb.canRetry, false);
  assert.match(glb.detail, /12 tris/);

  const failed = describePreview({
    status: "failed",
    detail: "CORRUPT_ASSET_BODY",
    facts: {},
    createdAt: 1,
  });
  assert.equal(failed.label, "预览失败");
  assert.equal(failed.tone, "error");
  assert.equal(failed.detail, "CORRUPT_ASSET_BODY");
  assert.equal(failed.canRetry, true);

  const timeout = describePreview({ status: "timeout", detail: "PREVIEW_TIMEOUT", facts: {}, createdAt: 1 });
  assert.equal(timeout.label, "预览超时");
  assert.equal(timeout.tone, "warning");
  assert.equal(timeout.canRetry, true);

  const cancelled = describePreview({ status: "cancelled", detail: "", facts: {}, createdAt: 1 });
  assert.equal(cancelled.label, "预览已取消");
  assert.equal(cancelled.tone, "neutral");
  assert.equal(cancelled.canRetry, true);

  assert.equal(previewLabel(null), "尚无预览");
  assert.equal(canRetry(null), true);
  assert.equal(canRetry({ status: "ok", detail: "", facts: { picture: true }, createdAt: 1 }), false);
});

test("OGG is never playable and never gets a player", () => {
  const ogg = describePreview({
    status: "failed",
    detail: "OGG_PCM_DECODE_NOT_IMPLEMENTED",
    facts: {
      pcmDecoded: false,
      playable: false,
      picture: false,
      reason: "ogg-pcm-decode-not-implemented",
      codec: "vorbis",
    },
    createdAt: 1,
  });
  assert.equal(ogg.playable, false);
  assert.equal(ogg.picture, false);
  assert.notEqual(ogg.label, "可试听");
  assert.match(ogg.label, /不可试听/);
  assert.equal(thumbnailSrc({ status: "failed", detail: "", facts: { playable: false }, createdAt: 1 }), null);
  // A failed preview is never mistaken for a decoded image either.
  assert.equal(
    thumbnailSrc({
      status: "failed",
      detail: "CORRUPT_ASSET_BODY",
      facts: { picture: true, thumbnailBase64: "AA==" },
      createdAt: 1,
    }),
    null,
  );
});

/* ------------------------------------------------------- cancel / retry */

test("preview runs the real service and cancel terminates the attempt", async () => {
  let phase = "ok";
  const { controller, calls } = selectedController({
    "asset.preview": () => ({
      jobId: "job-1",
      cacheKey: "cache-1",
      cached: false,
      retried: false,
      attempt: 1,
      applied: true,
      stale: false,
      timeoutMs: 20000,
      status: "pending",
      detail: "",
      facts: {},
    }),
    "asset.cancel": () => {
      phase = "cancelled";
      return { cancelled: true, applied: true, attempt: 1 };
    },
    "asset.previewRead": () => ({
      items: [previewRecord(phase, phase === "ok" ? "png 4x4" : "", phase === "ok" ? { picture: true } : {}, 7)],
      total: 1,
    }),
  });

  const read = await controller.select("a1", 2);
  assert.equal(read.version_.version, 2);
  const selectedSnapshot = controller.snapshot();
  assert.equal(selectedSnapshot.selected.version_.displayName, "a1 v2");
  assert.equal(selectedSnapshot.usage.length, 1);
  assert.deepEqual(selectedSnapshot.versions.map((entry) => entry.version_.version), [2, 1]);
  assert.equal(selectedSnapshot.preview.status, "ok");

  const begun = await controller.previewBegin("a1", 2);
  assert.equal(begun.jobId, "job-1");
  assert.equal(begun.attempt, 1);
  assert.equal(begun.applied, true);
  assert.equal(begun.preview.status, "pending");
  // The panel must call the real attempt-bound service, never the raw core
  // begin/finish channels, so the core-issued claim owns the run.
  assert.equal(calls.some((entry) => entry.channel === "asset.previewBegin"), false);
  assert.equal(calls.some((entry) => entry.channel === "asset.previewFinish"), false);
  assert.deepEqual(
    calls.find((entry) => entry.channel === "asset.preview").payload,
    { assetId: "a1", version: 2 },
  );
  assert.equal(controller.snapshot().previewJob.jobId, "job-1");

  await controller.cancelPreview();
  const cancel = calls.filter((entry) => entry.channel === "asset.cancel");
  assert.equal(cancel.length, 1);
  assert.deepEqual(cancel[0].payload, {
    assetId: "a1",
    version: 2,
    detail: "cancelled by player",
  });
  assert.equal(controller.snapshot().preview.status, "cancelled");
  assert.equal(controller.snapshot().previewJob, null);

  await controller.retryPreview();
  const previews = calls.filter((entry) => entry.channel === "asset.preview");
  assert.equal(previews.length, 2);
  assert.deepEqual(previews[0].payload, { assetId: "a1", version: 2 });
  assert.deepEqual(previews[1].payload, { assetId: "a1", version: 2 });
  await controller.previewBegin("a1", 2, "settings-9");
  const withSettings = calls.filter((entry) => entry.channel === "asset.preview")[2];
  assert.deepEqual(withSettings.payload, { assetId: "a1", version: 2, settingsHash: "settings-9" });
});

test("a late preview result for a superseded selection is discarded", async () => {
  let release = null;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { controller } = selectedController({
    "asset.preview": async () => {
      await gate;
      return {
        jobId: "job-late",
        cacheKey: "cache-late",
        cached: false,
        retried: false,
        attempt: 1,
        applied: true,
        stale: false,
        timeoutMs: 20000,
        status: "ok",
        detail: "late-should-not-appear",
        facts: { picture: true },
      };
    },
  });
  await controller.select("a1", 2);
  const pending = controller.previewBegin("a1", 2);
  // The player switches to another version before the decode returns.
  await controller.select("a1", 1);
  const afterSwitch = controller.snapshot();
  release();
  const late = await pending;
  assert.equal(late.stale, false, "the host did apply it to its own attempt");
  // The superseded result must not overwrite the newer selection's state.
  assert.equal(controller.snapshot().previewJob, null);
  assert.notEqual(controller.snapshot().preview?.detail, "late-should-not-appear");
  assert.deepEqual(controller.snapshot().preview, afterSwitch.preview);
});

/* ------------------------------------------------------- scan + import */

test("scanSummary and importRequestFor produce the import payload", async () => {
  const scan = {
    root: "C:\\assets",
    scanned: 7,
    truncated: false,
    items: [
      { path: "models/a.glb", bytes: 10, supported: true, mediaType: "model/gltf-binary", sha256: "b".repeat(64), known: false },
      { path: "audio/b.wav", bytes: 20, supported: true, mediaType: "audio/wav", sha256: "c".repeat(64), known: true, assetId: "b", version: 2 },
      { path: "notes.txt", bytes: 5, supported: false, mediaType: null, known: null },
      { path: "images/c.png", bytes: 30, supported: true, mediaType: "image/png", known: false },
      { path: "images/d.png", bytes: 31, supported: true, mediaType: "image/png", known: false },
      { path: "images/e.png", bytes: 32, supported: true, mediaType: "image/png", known: false },
      { path: "images/f.png", bytes: 33, supported: true, mediaType: "image/png", known: false },
    ],
    issues: [{ path: "notes.txt", code: "UNSUPPORTED_MEDIA_TYPE" }],
    hints: { newVersions: 5, unchanged: 1, unsupported: 1 },
    worldUpdated: false,
  };
  const summary = scanSummary(scan);
  assert.deepEqual(
    { newVersions: summary.newVersions, unchanged: summary.unchanged, unsupported: summary.unsupported },
    { newVersions: 5, unchanged: 1, unsupported: 1 },
  );
  assert.ok(summary.samplePaths.length <= 5);
  assert.deepEqual(summary.samplePaths[0], "models/a.glb");

  const request = importRequestFor(scan.items[0], {
    assetId: "crate",
    kind: "object",
    mediaKind: "model",
    displayName: "Crate",
    source: { origin: "player-import", author: "me", license: "CC0-1.0", licenseStatus: "verified" },
    tags: ["Base", "base"],
    sourceRoot: scan.root,
  });
  assert.deepEqual(request, {
    operationId: "asset-import:crate:1:models/a.glb",
    sourceRoot: "C:\\assets",
    sourcePath: "C:\\assets\\models\\a.glb",
    assetId: "crate",
    version: 1,
    kind: "object",
    mediaKind: "model",
    path: "models/a.glb",
    mediaType: "model/gltf-binary",
    displayName: "Crate",
    source: { origin: "player-import", author: "me", license: "CC0-1.0", licenseStatus: "verified" },
    tags: ["base"],
  });
  assert.equal(joinScanPath("C:/assets/", "models/a.glb"), "C:/assets/models/a.glb");
  for (const sourcePath of [undefined, null, "", "  "]) {
    assert.equal(importRequestFor(scan.items[0], {...request, sourcePath}).sourcePath,
      "C:\\assets\\models\\a.glb", "directory picker uses the selected scan path");
  }
  assert.equal(importRequestFor(scan.items[0], {...request, sourcePath: "D:/picked/a.glb"}).sourcePath,
    "D:/picked/a.glb", "an explicit file picker path remains unchanged");
  assert.equal(mediaKindForType("audio/ogg"), "audio");
  assert.equal(mediaKindForType("application/x-godot-package"), "package");
  assert.equal(mediaKindForType("application/zip"), "package");
  assert.equal(assetIdFromName("Crate (v2)!"), "crate-v2");

  const host = fakeHost({
    "asset.scan": () => scan,
    "asset.import": (payload) => ({
      assetId: payload.assetId,
      version: payload.version,
      contentHash: "d".repeat(64),
      deduplicated: false,
      replayed: false,
      version_: { displayName: payload.displayName },
    }),
  });
  const controller = createAssetLibraryController(host.call);
  const scanned = await controller.scan("C:\\assets");
  assert.equal(scanned.hints.newVersions, 5);
  assert.deepEqual(host.calls[0], { channel: "asset.scan", payload: { sourceRoot: "C:\\assets" } });
  const imported = await controller.importAsset(request);
  assert.deepEqual(host.calls[1].payload, request);
  assert.equal(imported.displayName, "Crate");
  assert.equal(controller.snapshot().lastImport.assetId, "crate");
  assert.equal(controller.snapshot().scanResult.hints.newVersions, 5);
});

test("snapshot data keys stay disjoint from controller action names", () => {
  // Regression guard for the import crash: `scan` once named both the scan
  // result (data) and the scan action (method). The merge in useAssetLibrary
  // then replaced the result with the function, and AssetLibraryPanel threw
  // `Cannot read properties of undefined (reading 'find')`, unmounting the tree.
  const host = fakeHost({});
  const controller = createAssetLibraryController(host.call);
  const actionNames = Object.keys(controllerActions(controller));
  const collisions = Object.keys(controller.snapshot()).filter((key) =>
    actionNames.includes(key),
  );
  assert.deepEqual(
    collisions,
    [],
    `snapshot field(s) ${collisions.join(", ")} collide with controller action names`,
  );
  assert.equal(typeof controller.scan, "function");
  assert.equal(controller.snapshot().scanResult, null);
});

test("the panel import path reads the scan result, never the scan action", async () => {
  const scan = {
    root: "C:\\assets",
    scanned: 1,
    truncated: false,
    items: [
      {
        path: "models/a.glb",
        bytes: 10,
        supported: true,
        mediaType: "model/gltf-binary",
        sha256: "b".repeat(64),
        known: false,
      },
    ],
    issues: [],
    hints: { newVersions: 1, unchanged: 0, unsupported: 0 },
    worldUpdated: false,
  };
  const host = fakeHost({ "asset.scan": () => scan });
  const controller = createAssetLibraryController(host.call);
  await controller.scan("C:\\assets");
  // Exactly what AssetLibraryPanel.startImport() does after the scan resolves.
  const result = controller.snapshot().scanResult;
  assert.equal(typeof controller.scan, "function");
  assert.ok(Array.isArray(result?.items), "scanResult.items must be an array");
  const picked = result.items.find((item) => item.path === "models/a.glb");
  assert.equal(picked.supported, true);
  assert.equal(scanSummary(result).newVersions, 1);
});

test("AssetLibraryPanel reads scan data from scanResult with a guarded items read", () => {
  const panel = readFileSync(join(assetsDir, "AssetLibraryPanel.tsx"), "utf8");
  assert.match(panel, /const scan = controller\.scanResult;/);
  assert.match(panel, /Array\.isArray\(scan\.items\)/);
  assert.doesNotMatch(panel, /const scan = controller\.scan;/);
});

test("versionOptions lists newest first", () => {
  const items = [
    { version_: versionBody("a1", 1), state: STATE_FULL },
    { version_: versionBody("a1", 3), state: STATE_FULL },
    { version_: versionBody("a1", 2), state: STATE_FULL },
  ];
  assert.deepEqual(versionOptions(items).map((option) => option.version), [3, 2, 1]);
  assert.deepEqual(versionOptions(items).map((option) => option.label), ["v3", "v2", "v1"]);
});

/* --------------------------------------------------------------- errors */

test("host failures reach the caller and stay in the error state", async () => {
  const host = fakeHost({
    "asset.search": () => {
      throw new Error("ASSET_NOT_FOUND");
    },
  });
  const controller = createAssetLibraryController(host.call);
  await assert.rejects(() => controller.search({ scope: "local-library" }), /ASSET_NOT_FOUND/);
  const snapshot = controller.snapshot();
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.error, "ASSET_NOT_FOUND");
  assert.equal(snapshot.busy, false);

  const unwired = createAssetLibraryController(null);
  await assert.rejects(
    () => unwired.search({ scope: "local-library" }),
    /ASSET_LIBRARY_UNAVAILABLE/,
  );
  assert.equal(unwired.snapshot().status, "unavailable");
  assert.equal(unwired.snapshot().error, "ASSET_LIBRARY_UNAVAILABLE");
});

/* -------------------------------------------------------- static guards */

test("asset UI sources contain no pointer-lock, click or focus emulation", () => {
  const files = ["AssetLibraryPanel.tsx", "asset-library-model.ts", "use-asset-library.ts"];
  const forbidden = [
    "requestPointerLock",
    "document.exitPointerLock",
    ".click()",
    "dispatchEvent(new MouseEvent",
    "element.focus(",
  ];
  for (const name of files) {
    const source = readFileSync(join(assetsDir, name), "utf8");
    for (const pattern of forbidden) {
      assert.equal(source.includes(pattern), false, `${name} must not contain ${pattern}`);
    }
  }
  const panel = readFileSync(join(assetsDir, "AssetLibraryPanel.tsx"), "utf8");
  // The audio element exists only behind a playable preview.
  assert.match(panel, /preview\.playable && audioSrc/);
  assert.match(panel, /<audio/);
  assert.equal(typeof hookModule.useAssetLibrary, "function");
});

test("a late search response for a previous scope never overwrites the list", async () => {
  let releaseStale;
  let issued = 0;
  const host = fakeHost({
    "asset.search": () => {
      issued += 1;
      if (issued === 1) {
        return new Promise(resolve => {
          releaseStale = () =>
            resolve({ items: [card("stale", 1)], total: 1, truncated: false, nextOffset: null });
        });
      }
      return { items: [card("fresh", 1)], total: 1, truncated: false, nextOffset: null };
    },
  });
  const controller = createAssetLibraryController(host.call);
  const stale = controller.search({ scope: "local-library" });
  await controller.search({ scope: "import-source" });
  releaseStale();
  await stale;
  assert.deepEqual(
    controller.snapshot().cards.map(item => item.assetId),
    ["fresh"],
    "the stale page must be dropped",
  );
  assert.equal(controller.snapshot().request.scope, "import-source");
});

test("thumbnailSrc only accepts a bounded, well-formed base64 payload", () => {
  const ok = {
    status: "ok",
    detail: "",
    facts: { picture: true, thumbnailBase64: "iVBORw0KGgo=" },
    createdAt: 1,
  };
  assert.equal(model.thumbnailSrc(ok), "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(
    model.thumbnailSrc({ ...ok, facts: { picture: true, thumbnailBase64: "<script>alert(1)</script>" } }),
    null,
  );
  assert.equal(
    model.thumbnailSrc({ ...ok, facts: { picture: true, thumbnailBase64: "A".repeat(700_001) } }),
    null,
  );
  assert.equal(
    model.thumbnailSrc({ ...ok, facts: { picture: false, thumbnailBase64: "iVBORw0KGgo=" } }),
    null,
  );
});
