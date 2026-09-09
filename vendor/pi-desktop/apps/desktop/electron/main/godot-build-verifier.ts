/**
 * Isolated Electron runtime check for one managed Godot Web build (task C).
 *
 * The host must be able to prove that a build produced by a managed job really
 * starts, really renders, and reports no runtime errors before the candidate is
 * registered. This module owns that proof and nothing else: it is a private
 * product service, never a plugin or model API.
 *
 * Isolation rules, all enforced below:
 *   * the window is offscreen, non-focusable, hidden, non-zero sized;
 *   * the page runs on its own ephemeral session partition with every
 *     permission denied and egress confined to the instance loopback origin;
 *   * the shared headless input guard is installed in the main world before
 *     application scripts, and the check asserts it really is there;
 *   * the check never writes progress: no `save`, no `acknowledge`, no `cancel`
 *     op is ever sent, so a failed candidate cannot touch the formal world.
 */

import { BrowserWindow, session, type Session } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  createWorldRuntime,
  type RuntimeEvent,
  type WorldRuntime,
} from "../../../../../../desktop/godot/web/runtime.mjs";
import { GODOT_WORLD_MESSAGE_CHANNEL, godotWorldScopeArgument } from "../shared/godot-world-chrome";
import { checkCraftmineFrame } from "./craftmine-frame-check";

/** Descriptor produced by the Rust core (`godotJob.checkDescriptor`). */
export type GodotRuntimeCheckDescriptor = {
  format: "craftmine.godot-check-descriptor/1";
  phase: "check";
  jobId: string;
  inputHash: string;
  worldId: string;
  buildId: string;
  baseId: "first-person" | "top-down" | "side-view";
  /** Absolute path to the core-owned artifacts directory. */
  root: string;
  entry: "web/index.html";
  threads: boolean;
  artifacts: Array<{ path: string; bytes: number; sha256: string }>;
  snapshot: unknown;
};

export type GodotRuntimeCheckReady = {
  ok: boolean;
  ops: string[];
  instanceId: string;
  elapsedMs: number;
};

export type GodotRuntimeCheckCapture = {
  sha256: string;
  width: number;
  height: number;
  coloredSamples: number;
  samples: number;
};

export type GodotRuntimeCheckRender = {
  ok: boolean;
  frames: number;
  distinctFrames: number;
  captures: GodotRuntimeCheckCapture[];
};

export type GodotRuntimeCheckErrors = {
  ok: boolean;
  runtime: string[];
  console: string[];
  renderer: string | null;
};

export type GodotRuntimeCheckSnapshot = {
  ok: boolean;
  equal: boolean;
  expectedHash: string | null;
  actualHash: string | null;
  keys: string[];
};

export type GodotRuntimeCheckIsolation = {
  ok: boolean;
  offscreen: boolean;
  focusable: boolean;
  visible: boolean;
  guard: { focus: number; pointerLock: number } | null;
  networkBlocked: number;
  navigationBlocked: number;
  popupsBlocked: number;
  sessionCleared: boolean;
};

export type GodotRuntimeCheckRecovery = {
  ok: boolean;
  gracefulExit: boolean;
  windowDestroyed: boolean;
  serverClosed: boolean;
};

export type GodotRuntimeCheckAssertionId =
  | "runtime.ready"
  | "runtime.frame"
  | "runtime.no-errors"
  | "runtime.snapshot"
  | "runtime.isolation"
  | "runtime.recovery";

export type GodotRuntimeCheckAssertion = {
  id: GodotRuntimeCheckAssertionId;
  passed: boolean;
};

export type GodotRuntimeCheckEvidence = {
  format: "craftmine.godot-runtime-check/1";
  scope: "base-startup";
  jobId: string;
  buildId: string;
  worldId: string;
  inputHash: string;
  passed: boolean;
  startedAt: string;
  elapsedMs: number;
  ready: GodotRuntimeCheckReady;
  render: GodotRuntimeCheckRender;
  errors: GodotRuntimeCheckErrors;
  snapshot: GodotRuntimeCheckSnapshot;
  isolation: GodotRuntimeCheckIsolation;
  recovery: GodotRuntimeCheckRecovery;
  assertions: GodotRuntimeCheckAssertion[];
  /** Bounded page console lines; diagnostic only, never part of `passed`. */
  diagnostics: string[];
  error: string | null;
};

/** One bounded deadline for the whole check, mirroring `CraftmineVerifier`. */
const CHECK_DEADLINE_MS = 30_000;/** Offscreen capture budget for the first real pixels. */
const FRAME_PAINT_DEADLINE_MS = 2_500;
/** Three spaced captures, at least two of them distinct, prove a live canvas. */
const FRAME_COUNT = 3;
const FRAME_INTERVAL_MS = 120;
const MAX_JOBS = 2;
const MAX_ERROR_ENTRIES = 32;
const MAX_ERROR_CHARS = 2000;
const MAX_ARTIFACT_ENTRIES = 4096;
const ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const JOB_ID_PATTERN = /^gjob-[a-f0-9]{64}$/;
const BUILD_ID_PATTERN = /^gbd-[a-f0-9]{64}$/;
const BASE_IDS = ["first-person", "top-down", "side-view"] as const;
const GUARD_PROBE =
  "({guard: globalThis.__craftmineHeadless ?? null, node: typeof process, bridge: typeof pluginBridge})";

type GuardProbe = { guard: { focus: number; pointerLock: number } | null; node: string; bridge: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingMs(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

/** Await `value`, or give up after `ms` so teardown can never hang the host. */
async function withDeadline<T>(value: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([value, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Canonical JSON with sorted object keys, so key order cannot fake equality. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** A manifest path must be a forward-slash relative path under `web/`. */
function requireArtifactPath(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  // Reject a drive letter, a backslash, a NUL, an absolute path, a traversal
  // segment and a trailing dot/space segment: Win32 strips those when opening.
  if (value.includes("\\") || value.includes("\0") || value.includes(":")) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  if (!value.startsWith("web/")) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || /[. ]$/.test(part))) {
    throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  }
  return value;
}

/** Win32 verbatim roots (`\\?\D:\...`) break `realpathSync`; normalize them. */
function plainRoot(value: string): string {
  if (process.platform !== "win32") return value;
  if (value.startsWith("\\\\?\\UNC\\")) return "\\\\" + value.slice(8);
  if (value.startsWith("\\\\?\\")) return value.slice(4);
  return value;
}

/** Strict descriptor validation. Shape problems throw and never reach a window. */
export function parseGodotCheckDescriptor(input: unknown): GodotRuntimeCheckDescriptor {
  if (!isRecord(input)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  if (input.format !== "craftmine.godot-check-descriptor/1" || input.phase !== "check") throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const jobId = input.jobId;
  if (typeof jobId !== "string" || !JOB_ID_PATTERN.test(jobId)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const inputHash = input.inputHash;
  if (typeof inputHash !== "string" || !HASH_PATTERN.test(inputHash)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const worldId = input.worldId;
  if (typeof worldId !== "string" || !ID_PATTERN.test(worldId)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const buildId = input.buildId;
  if (typeof buildId !== "string" || !BUILD_ID_PATTERN.test(buildId)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const baseId = input.baseId;
  if (typeof baseId !== "string" || !BASE_IDS.includes(baseId as (typeof BASE_IDS)[number])) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const root = input.root;
  if (typeof root !== "string" || root.length < 1 || root.length > 4096 || !isAbsolute(root)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  // The Rust core canonicalizes its data directory, so a claimed root can be a
  // Win32 verbatim path. Node's realpath refuses those, and the shared Web
  // runtime resolves every served file with it, so normalize before use.
  const plain = plainRoot(root);
  if (!isAbsolute(plain)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  if (input.entry !== "web/index.html") throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  if (typeof input.threads !== "boolean") throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const snapshot = input.snapshot === undefined ? null : input.snapshot;
  if (snapshot !== null && !isRecord(snapshot)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const rawArtifacts = input.artifacts;
  if (!Array.isArray(rawArtifacts) || rawArtifacts.length < 1 || rawArtifacts.length > MAX_ARTIFACT_ENTRIES) {
    throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  }
  const seen = new Set<string>();
  const artifacts: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const item of rawArtifacts) {
    if (!isRecord(item)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
    const path = requireArtifactPath(item.path);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
    seen.add(key);
    if (!Number.isSafeInteger(item.bytes) || (item.bytes as number) < 0) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
    if (typeof item.sha256 !== "string" || !HASH_PATTERN.test(item.sha256)) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
    artifacts.push({ path, bytes: item.bytes as number, sha256: item.sha256 });
  }
  if (!seen.has("web/index.html")) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  return {
    format: "craftmine.godot-check-descriptor/1",
    phase: "check",
    jobId,
    inputHash,
    worldId,
    buildId,
    baseId: baseId as GodotRuntimeCheckDescriptor["baseId"],
    root: plain,
    entry: "web/index.html",
    threads: input.threads,
    artifacts,
    snapshot,
  };
}

/**
 * The artifacts directory is core-owned, but the check still proves the files
 * it will serve are the files the descriptor promised: ordinary files, exact
 * size, exact sha256, and no link anywhere on the path.
 */
async function verifyArtifacts(descriptor: GodotRuntimeCheckDescriptor, deadline: number): Promise<void> {
  const rootInfo = await lstat(descriptor.root).catch(() => null);
  if (!rootInfo || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
  const entry = join(descriptor.root, "web", "index.html");
  const entryInfo = await lstat(entry).catch(() => null);
  if (!entryInfo || !entryInfo.isFile()) throw new Error("GODOT_CHECK_ARTIFACT_MISSING");
  for (const artifact of descriptor.artifacts) {
    if (Date.now() >= deadline) throw new Error("GODOT_CHECK_TIMEOUT");
    const parts = artifact.path.split("/");
    let cursor = descriptor.root;
    for (const part of parts) {
      cursor = join(cursor, part);
      const info = await lstat(cursor).catch(() => null);
      if (!info) throw new Error("GODOT_CHECK_ARTIFACT_MISSING");
      if (info.isSymbolicLink()) throw new Error("GODOT_CHECK_ARTIFACT_MISMATCH");
      if (cursor !== join(descriptor.root, ...parts) && !info.isDirectory()) throw new Error("INVALID_GODOT_CHECK_DESCRIPTOR");
    }
    const file = join(descriptor.root, ...parts);
    const info = await lstat(file).catch(() => null);
    if (!info || !info.isFile()) throw new Error("GODOT_CHECK_ARTIFACT_MISSING");
    if (info.size !== artifact.bytes) throw new Error("GODOT_CHECK_ARTIFACT_MISMATCH");
    if ((await sha256File(file)) !== artifact.sha256) throw new Error("GODOT_CHECK_ARTIFACT_MISMATCH");
  }
}

/**
 * Egress is confined to the instance's own loopback origin. Same-origin blob
 * and inline data URLs are page-local resources a threaded Web export needs;
 * everything else is cancelled and counted.
 */
function isRuntimeRequest(url: string, origin: string): boolean {
  return url === origin || url.startsWith(`${origin}/`) || url.startsWith(`blob:${origin}/`) ||
    url === "about:blank" || url === "about:srcdoc" || url.startsWith("data:");
}

function readGuardProbe(raw: unknown): GuardProbe {
  if (!isRecord(raw)) return { guard: null, node: "undefined", bridge: "undefined" };
  const guard = raw.guard;
  const present = isRecord(guard) && typeof guard.focus === "number" && typeof guard.pointerLock === "number";
  return {
    guard: present ? { focus: (guard as Record<string, unknown>).focus as number, pointerLock: (guard as Record<string, unknown>).pointerLock as number } : null,
    node: typeof raw.node === "string" ? raw.node : "undefined",
    bridge: typeof raw.bridge === "string" ? raw.bridge : "undefined",
  };
}

/**
 * Runs one isolated runtime check. Validation failures listed in the contract
 * throw; every other failure is returned inside the evidence object so the
 * caller always receives a complete, diagnosable record.
 */
export class GodotBuildVerifier {
  private jobs = new Map<string, () => void>();
  private readonly deadlineMs: number;

  /** A real Web export can take tens of seconds to start in software GL. */
  constructor(options: { deadlineMs?: number } = {}) {
    this.deadlineMs = Number.isSafeInteger(options.deadlineMs) && (options.deadlineMs as number) > 0
      ? Math.min(options.deadlineMs as number, 600_000)
      : CHECK_DEADLINE_MS;
  }

  cancel(jobId: string): void {
    this.jobs.get(jobId)?.();
  }

  cancelAll(): void {
    for (const cancel of this.jobs.values()) cancel();
  }

  async check(input: unknown): Promise<GodotRuntimeCheckEvidence> {
    const descriptor = parseGodotCheckDescriptor(input);
    if (this.jobs.has(descriptor.jobId) || this.jobs.size >= MAX_JOBS) throw new Error("GODOT_CHECK_BUSY");

    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const deadline = startedMs + this.deadlineMs;
    // Bounded, non-scoring page diagnostics: they make a failed check
    // diagnosable without letting a noisy page fail it.
    const diagnostics: string[] = [];

    const ready: GodotRuntimeCheckReady = { ok: false, ops: [], instanceId: "", elapsedMs: 0 };
    const render: GodotRuntimeCheckRender = { ok: false, frames: 0, distinctFrames: 0, captures: [] };
    const errors: GodotRuntimeCheckErrors = { ok: false, runtime: [], console: [], renderer: null };
    const snapshot: GodotRuntimeCheckSnapshot = { ok: false, equal: false, expectedHash: null, actualHash: null, keys: [] };
    const isolation: GodotRuntimeCheckIsolation = {
      ok: false, offscreen: false, focusable: true, visible: true, guard: null,
      networkBlocked: 0, navigationBlocked: 0, popupsBlocked: 0, sessionCleared: false,
    };
    const recovery: GodotRuntimeCheckRecovery = { ok: false, gracefulExit: false, windowDestroyed: false, serverClosed: false };
    let error: string | null = null;
    let runtime: WorldRuntime | null = null;
    let window: BrowserWindow | null = null;
    let isolated: Session | null = null;
    let detachTransport: () => void = () => {};
    // Events that arrive after the check body finished are teardown noise.
    let finished = false;

    // Cancellation and the bounded deadline share one stop signal; every await
    // inside the check races it, so neither a hung page nor a cancel can leave
    // the check running past its budget.
    let halted = false;
    let haltReason = "";
    let rejectHalt: (failure: Error) => void = () => {};
    const haltedPromise = new Promise<never>((_resolve, reject) => { rejectHalt = reject; });
    void haltedPromise.catch(() => undefined);
    const halt = (reason: string): void => {
      if (halted) return;
      halted = true;
      haltReason = reason;
      rejectHalt(new Error(reason));
    };
    const assertRunning = (): void => {
      if (halted) throw new Error(haltReason);
    };
    const bounded = <T>(value: Promise<T>): Promise<T> => Promise.race([value, haltedPromise]);

    this.jobs.set(descriptor.jobId, () => halt("GODOT_CHECK_CANCELLED"));
    const timer = setTimeout(() => halt("GODOT_CHECK_TIMEOUT"), remainingMs(deadline));

    try {
      await bounded(verifyArtifacts(descriptor, deadline));
      assertRunning();

      const activeRuntime = await createWorldRuntime({
        worldId: descriptor.worldId,
        buildId: descriptor.buildId,
        root: descriptor.root,
        artifacts: descriptor.artifacts,
        entry: descriptor.entry,
        threads: descriptor.threads,
        timeoutMs: Math.min(remainingMs(deadline), this.deadlineMs),
      });
      runtime = activeRuntime;
      ready.instanceId = activeRuntime.instanceId;
      assertRunning();

      const origin = activeRuntime.origin;
      const preload = join(__dirname, "../preload/godot-check.cjs");
      isolated = session.fromPartition(`pi-godot-check-${randomUUID()}`, { cache: false });
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
        const allowed = isRuntimeRequest(details.url, origin);
        if (!allowed) isolation.networkBlocked += 1;
        callback({ cancel: !allowed });
      });
      // Registered before the window exists so subframes and workers are
      // covered by the same guard, not only the main frame's window preload.
      isolated.registerPreloadScript({ type: "frame", filePath: preload });

      window = new BrowserWindow({
        width: 960,
        height: 640,
        show: false,
        focusable: false,
        webPreferences: {
          session: isolated,
          offscreen: true,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          webSecurity: true,
          backgroundThrottling: false,
          spellcheck: false,
          preload,
          additionalArguments: [
            godotWorldScopeArgument({
              protocol: activeRuntime.protocol,
              worldId: descriptor.worldId,
              buildId: descriptor.buildId,
              instanceId: activeRuntime.instanceId,
            }),
          ],
        },
      });
      const bounds = window.getBounds();
      if (!(bounds.width > 0 && bounds.height > 0)) throw new Error("GODOT_CHECK_WINDOW_SIZE_INVALID");
      isolation.offscreen = window.webContents.isOffscreen();
      isolation.focusable = window.isFocusable();
      isolation.visible = window.isVisible();
      if (!isolation.offscreen || isolation.focusable || isolation.visible) throw new Error("GODOT_CHECK_ISOLATION_FAILED");

      window.webContents.setWindowOpenHandler(() => {
        if (!finished) isolation.popupsBlocked += 1;
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event) => {
        if (!finished) isolation.navigationBlocked += 1;
        event.preventDefault();
      });
      window.webContents.on("will-attach-webview", (event) => {
        if (!finished) isolation.navigationBlocked += 1;
        event.preventDefault();
      });
      window.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
        if (!finished && isMainFrame && diagnostics.length < 64) diagnostics.push(`[fail-load] ${code} ${description} ${url}`);
      });
      window.webContents.on("console-message", (details) => {
        if (finished) return;
        if (diagnostics.length < 64) diagnostics.push(`[${details.level}] ${details.message.slice(0, 400)}`);
        if (details.level !== "error" && !details.message.startsWith("Uncaught")) return;
        if (errors.console.length < MAX_ERROR_ENTRIES) errors.console.push(details.message.slice(0, MAX_ERROR_CHARS));
      });
      window.webContents.on("preload-error", (_event, preloadPath, preloadFailure) => {
        if (finished) return;
        errors.renderer = `preload-error: ${preloadPath}: ${messageOf(preloadFailure)}`.slice(0, MAX_ERROR_CHARS);
        halt("GODOT_CHECK_PRELOAD_ERROR");
      });
      window.webContents.on("render-process-gone", (_event, details) => {
        if (finished) return;
        errors.renderer = `render-process-gone: ${details.reason}`;
        halt("GODOT_CHECK_RENDERER_GONE");
      });

      // The verifier owns the transport: runtime messages are relayed to the
      // page, and page messages are re-validated by the runtime's own scope.
      detachTransport = activeRuntime.attach((message) => {
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
        window.webContents.send(GODOT_WORLD_MESSAGE_CHANNEL, message);
      });
      window.webContents.ipc.on(GODOT_WORLD_MESSAGE_CHANNEL, (_event, message: unknown) => {
        activeRuntime.receive(message);
      });
      activeRuntime.onEvent((event: RuntimeEvent) => {
        if (finished) return;
        if (event.type === "runtime-error") {
          if (errors.runtime.length < MAX_ERROR_ENTRIES) errors.runtime.push(event.error.slice(0, MAX_ERROR_CHARS));
          return;
        }
        if (event.type === "exited") {
          errors.renderer = errors.renderer ?? `runtime-exited: ${String(event.exitCode ?? "unknown")}`;
          halt("GODOT_CHECK_RUNTIME_EXITED");
        }
      });

      // A stalled engine must be diagnosable: sample the page's own state from
      // before the first navigation. Diagnostic only; nothing here can make the
      // check pass.
      const probe = setInterval(() => {
        if (finished || !window || window.isDestroyed()) return;
        void window.webContents.executeJavaScript(
          "({ready:document.readyState,coi:crossOriginIsolated,game:typeof CraftmineGame,engine:typeof Engine," +
          "canvas:(()=>{const c=document.getElementById('canvas');return c?[c.width,c.height]:null})()," +
          "status:((document.getElementById('status')||{}).textContent||null)})", false)
          .then(value => { if (diagnostics.length < 64) diagnostics.push("[probe] " + JSON.stringify(value)); })
          .catch(() => {});
      }, 5000);
      probe.unref?.();
      const readyStarted = Date.now();
      try {
        await bounded(window.loadURL(activeRuntime.url));
        const readyInfo = await bounded(activeRuntime.waitReady());
        ready.ok = true;
        ready.ops = Array.isArray(readyInfo.ops) ? readyInfo.ops.slice(0, 64) : [];
        ready.elapsedMs = Date.now() - readyStarted;
      } finally {
        clearInterval(probe);
      }
      const loaded = await bounded(activeRuntime.load({ build: null, snapshot: descriptor.snapshot ?? null }));
      if (loaded.error) throw new Error(`GODOT_CHECK_LOAD_FAILED: ${loaded.error}`);
      assertRunning();

      // Isolation proof: the guard is installed in the main world of every
      // frame, the renderer has no Node or plugin bridge, and the hidden
      // offscreen window never holds document focus.
      const guards: GuardProbe[] = [];
      for (const frame of window.webContents.mainFrame.framesInSubtree) {
        const probe = await bounded(frame.executeJavaScript(GUARD_PROBE, false));
        guards.push(readGuardProbe(probe));
      }
      isolation.guard = guards[0]?.guard ?? null;
      const focused = await bounded(window.webContents.executeJavaScript("document.hasFocus()", false));
      if (guards.length === 0 || guards.some((entry) => entry.guard === null)) throw new Error("GODOT_CHECK_INPUT_GUARD_MISSING");
      if (guards.some((entry) => entry.guard!.focus !== 0 || entry.guard!.pointerLock !== 0 || entry.node !== "undefined" || entry.bridge !== "undefined")) {
        throw new Error("GODOT_CHECK_ISOLATION_FAILED");
      }
      if (focused !== false) throw new Error("GODOT_CHECK_FOCUS_LEAK");

      // Snapshot proof. This is the only state op the check performs: it never
      // calls `save`, `acknowledge`, `cancel` or any other writing op, so the
      // formal world progress can never be changed by a check.
      const observed = await bounded(activeRuntime.snapshot());
      if (observed.error) throw new Error(`GODOT_CHECK_SNAPSHOT_FAILED: ${observed.error}`);
      const returned = observed.result ?? null;
      // Managed bases return a transport wrapper around the persisted progress
      // envelope. Compare the native round trip before advancing simulation.
      const actual = isRecord(descriptor.snapshot) && descriptor.snapshot.format === "craftmine.godot-progress/1"
        ? isRecord(returned) && returned.worldId === descriptor.worldId && isRecord(returned.state)
          ? returned.state : null
        : returned;
      const actualHash = actual === null ? null : hashJson(actual);
      const expectedHash = descriptor.snapshot === null ? null : hashJson(descriptor.snapshot);
      snapshot.expectedHash = expectedHash;
      snapshot.actualHash = actualHash;
      snapshot.keys = isRecord(actual) ? Object.keys(actual).sort() : [];
      // A world without durable progress has no expected state to compare; the
      // proof is then that the build answered with its own fresh state.
      snapshot.equal = expectedHash === null ? actualHash !== null : expectedHash === actualHash;
      snapshot.ok = actualHash !== null && snapshot.equal;
      if (!snapshot.ok) throw new Error("GODOT_CHECK_SNAPSHOT_MISMATCH");

      const resumed = await bounded(activeRuntime.resume());
      if (resumed.error) throw new Error(`GODOT_CHECK_RESUME_FAILED: ${resumed.error}`);

      // Render proof: real pixels, spaced in time, and at least two distinct
      // frames so a frozen or blank canvas cannot pass.
      const paintDeadline = Date.now() + FRAME_PAINT_DEADLINE_MS;
      for (let index = 0; index < FRAME_COUNT; index += 1) {
        if (index > 0) await bounded(delay(FRAME_INTERVAL_MS));
        assertRunning();
        for (;;) {
          if (window.isDestroyed()) throw new Error("GODOT_CHECK_RENDERER_GONE");
          window.webContents.invalidate();
          const image = await bounded(window.webContents.capturePage());
          let pixels: { coloredSamples: number; samples: number };
          try {
            pixels = checkCraftmineFrame(image);
          } catch (captureFailure) {
            if (!(captureFailure instanceof Error) || captureFailure.message !== "BLANK_GAME_FRAME" || Date.now() >= paintDeadline) {
              throw captureFailure;
            }
            await bounded(delay(50));
            continue;
          }
          const size = image.getSize();
          render.captures.push({
            sha256: createHash("sha256").update(image.toPNG()).digest("hex"),
            width: size.width,
            height: size.height,
            coloredSamples: pixels.coloredSamples,
            samples: pixels.samples,
          });
          break;
        }
      }
      render.frames = render.captures.length;
      render.distinctFrames = new Set(render.captures.map((capture) => capture.sha256)).size;
      // Liveness is proven by the engine answering `snapshot` (the page's bridge
      // only dispatches while its main loop runs). A correct static scene
      // legitimately paints identical frames, so distinct frames are recorded as
      // evidence, not used as a pass criterion.
      render.ok = render.frames >= FRAME_COUNT;
      if (!render.ok) throw new Error("GODOT_CHECK_FRAME_MISSING");
    } catch (failure) {
      error = messageOf(failure);
    } finally {
      finished = true;
      clearTimeout(timer);
      this.jobs.delete(descriptor.jobId);
      const activeRuntime = runtime;
      if (activeRuntime) {
        try {
          const exit = await withDeadline(activeRuntime.exit({ timeoutMs: 3000 }), 4000);
          recovery.gracefulExit = exit !== null && typeof exit.error !== "string";
        } catch {
          recovery.gracefulExit = false;
        }
        try {
          const disposed = await withDeadline(activeRuntime.dispose({ graceful: true }), 8000);
          if (disposed === null) throw new Error("GODOT_CHECK_DISPOSE_TIMEOUT");
        } catch {
          recovery.gracefulExit = false;
          await activeRuntime.dispose({ graceful: false }).catch(() => undefined);
        }
        recovery.serverClosed = activeRuntime.state === "disposed";
      }
      detachTransport();
      if (window) {
        try {
          if (!window.isDestroyed()) window.destroy();
        } catch {
          // The renderer may already be gone.
        }
        recovery.windowDestroyed = window.isDestroyed();
      }
      if (isolated) {
        isolated.webRequest.onBeforeRequest(null);
        try {
          await isolated.clearStorageData();
          isolation.sessionCleared = true;
        } catch {
          isolation.sessionCleared = false;
        }
      }
    }

    errors.ok = errors.runtime.length === 0 && errors.console.length === 0 && errors.renderer === null;
    isolation.ok = isolation.offscreen && !isolation.focusable && !isolation.visible &&
      isolation.guard !== null && isolation.guard.focus === 0 && isolation.guard.pointerLock === 0 &&
      isolation.navigationBlocked === 0 && isolation.popupsBlocked === 0 && isolation.sessionCleared;
    recovery.ok = recovery.gracefulExit && recovery.windowDestroyed && recovery.serverClosed;
    const assertions: GodotRuntimeCheckAssertion[] = [
      { id: "runtime.ready", passed: ready.ok },
      { id: "runtime.frame", passed: render.ok },
      { id: "runtime.no-errors", passed: errors.ok },
      { id: "runtime.snapshot", passed: snapshot.ok },
      { id: "runtime.isolation", passed: isolation.ok },
      { id: "runtime.recovery", passed: recovery.ok },
    ];
    const passed = assertions.every((assertion) => assertion.passed);
    if (!passed && error === null) {
      error = `GODOT_CHECK_FAILED: ${assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id).join(",")}`;
    }
    return {
      format: "craftmine.godot-runtime-check/1",
      scope: "base-startup",
      jobId: descriptor.jobId,
      buildId: descriptor.buildId,
      worldId: descriptor.worldId,
      inputHash: descriptor.inputHash,
      passed,
      startedAt,
      elapsedMs: Date.now() - startedMs,
      ready,
      render,
      errors,
      snapshot,
      isolation,
      recovery,
      assertions,
      diagnostics,
      error,
    };
  }
}
