import type { MainWindow } from "./main-window";
import { raiseMainOverlay, syncMainInputFocus, setMainViewBackground } from "./main-window-layers";
import { WebContentsView, session, type NativeImage, type Session, type WebContents } from "electron";
import { join, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import {
  createWorldRuntime,
  WORLD_CHROME_HEIGHT,
  type RuntimeEvent,
  type WorldRuntime,
} from "../../../../../../desktop/godot/web/runtime.mjs";
import { isHeadlessAcceptance, isOffscreenAcceptance, hasHeadlessController } from "./craftmine-headless";
import { randomBytes } from "node:crypto";
import { readEnginePerformance } from "./engine-performance-request";
import { PRIVATE_PLAY_OPS, validateHeadlessPlayAction, type PlayIdentity } from "./headless-play-action";
import {gameInputScript,validateGameInputEvents,GAME_INPUT_PROGRAM_SHA256,type GameInputEvent} from './headless-game-input';
import type { CraftmineImmersionState, CraftmineImmersionShortcut } from "@pi-desktop/shared";
import { NO_IMMERSION, IMMERSION_INPUT_CHANNEL, excludeImmersion, immersionShortcut, immersionBlocksInput } from "../../shared/craftmine-immersion";
import { createImmersionPauseController } from "./immersion-pause-controller";
import {captureBoundGodotView,validateGodotViewCaptureIdentity,type GodotViewCaptureIdentity,type GodotViewCapture} from "./godot-view-capture";
import { nativeFullscreenKeyDecision } from "../../shared/world-fullscreen-shortcuts";
import { WORLD_CURSOR_CHANNEL } from "../../shared/world-cursor-presentation";
import { createGodotStartupProbe } from "./godot-startup-diagnostics";
import {
  GODOT_WORLD_DETACH_CHANNEL,
  GODOT_WORLD_FULLSCREEN_EXIT_CHANNEL,
  GODOT_WORLD_MESSAGE_CHANNEL,
  godotWorldScopeArgument,
} from "../shared/godot-world-chrome";

/**
 * Hosts one Godot Web world runtime per active world build (task C, ADR-C).
 *
 * The game is a top-level document on a private loopback origin because a
 * multi-threaded Web export needs `crossOriginIsolated`, which `file://`
 * cannot provide. It is composited as a sibling `WebContentsView` above the
 * plugin's creation panel: the renderer measures the panel surface, this host
 * insets it by the panel chrome the view page reserves, and the game view is
 * placed there. The plugin page keeps the world selector, mode tabs, checks
 * and workbench; the game view draws only the game.
 *
 * Identity is `worldId + buildId` plus a per-instance `instanceId`. A different
 * world or build always replaces the instance: the previous runtime is saved
 * and disposed only after the replacement is ready, and its late messages are dropped by the protocol layer, so a stale
 * page can never write into the new world.
 */

export type GodotWorldBounds = { x: number; y: number; width: number; height: number };

export type GodotWorldOpenRequest = {
  worldId: string;
  buildId: string;
  /** Durable revision supplied by the trusted host. */
  revision: number;
  /** Absolute path to the built Web export directory. */
  root: string;
  artifacts: Array<{path: string; sha256: string; bytes: number}>;
  entry?: string;
  threads?: boolean;
  /** Snapshot the host loaded from durable progress; replayed after ready. */
  snapshot?: unknown;
  build?: unknown;
  /** Startup budget for the runtime page; a broken candidate fails fast. */
  timeoutMs?: number;
};

export type GodotWorldProgressCall = {
  worldId: string;
  buildId: string;
  revision: number;
  runnerReceipt: Record<string, unknown>;
  snapshot: unknown;
};

export type GodotWorldPersistedReceipt = {
  format: string;
  worldId: string;
  buildId: string;
  revision: number;
  contentHash?: string;
  persistedAt?: number;
};

export type GodotWorldProgressResult =
  | { receipt: GodotWorldPersistedReceipt }
  | { failed: true; error: string };

export type GodotWorldState = {
  worldId: string;
  buildId: string;
  instanceId: string;
  state: "closed" | "loading" | "ready" | "paused" | "saving" | "saved" | "failed";
  error?: string;
  loadingStage?: "resources" | "engine" | "scene";
};

export type GodotWorldSaveResult =
  | { status: "persisted"; runnerReceipt: Record<string, unknown>; receipt: GodotWorldPersistedReceipt; snapshot: unknown }
  | { status: "failed"; error: string; runnerReceipt?: Record<string, unknown> };

/** How often the active world descriptor is re-read while the panel is visible. */
const SYNC_INTERVAL_MS = 2000;
const ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
/** Renderer lines retained per instance so a startup failure is diagnosable. */
const CONSOLE_KEEP = 40;
/** Renderer faults retained per instance; the array must not grow without bound. */
const FAULT_KEEP = 20;
/** Total budget for the diagnostic suffix attached to a startup failure. */
const DIAGNOSTIC_CHARS = 700;
/**
 * Hard cap for one acceptance capture. Readiness is proven by the pixels that
 * arrive, never by waiting: the loop below only ever accepts a real frame at the
 * requested size, and a frame that never arrives fails with its own error.
 */
const CAPTURE_READY_DEADLINE_MS = 4000;
/** Longest single wait for the next offscreen frame before re-checking readiness. */
const CAPTURE_FRAME_WAIT_MS = 120;
/** Bounded number of readiness observations kept for the failure message. */
const CAPTURE_OBSERVATION_KEEP = 8;
/** Distinct pixels sampled as colour evidence, mirroring the acceptance clients. */
const CAPTURE_COLOR_SAMPLE_LIMIT = 65536;

/**
 * A screenshot that was composited at all has at least one non-transparent
 * pixel. An offscreen compositor that has not painted yet returns an all-zero
 * buffer, so this is the structural "the frame is real" probe; whether the scene
 * is interesting is the caller's assertion, not this host's.
 */
function hasPaintedPixels(pixels: Uint8Array): boolean {
  const stride = Math.max(1, Math.floor(pixels.length / 4 / CAPTURE_COLOR_SAMPLE_LIMIT));
  for (let offset = 3; offset < pixels.length; offset += 4 * stride) if (pixels[offset] !== 0) return true;
  return false;
}

/** Distinct sampled colours, the evidence the acceptance clients already assert on. */
function sampledColorCount(pixels: Uint8Array): number {
  const colors = new Set<number>();
  const stride = Math.max(1, Math.floor(pixels.length / 4 / CAPTURE_COLOR_SAMPLE_LIMIT));
  for (let offset = 0; offset + 4 <= pixels.length; offset += 4 * stride) colors.add(pixels[offset] | (pixels[offset + 1] << 8) | (pixels[offset + 2] << 16) | (pixels[offset + 3] << 24));
  return colors.size;
}

/** The frame sources this host reads: the compositor's own paint, or a read. */
type PaintEmitter = {
  on(name: "paint", listener: (event: unknown, dirty: unknown, image: NativeImage) => void): unknown;
  off(name: "paint", listener: (event: unknown, dirty: unknown, image: NativeImage) => void): unknown;
};

/** A frame is evidence only when it is the whole viewport, fully composited. */
type FrameVerdict = { ok: true; pixels: Uint8Array } | { ok: false; detail: string };

function inspectFrame(image: NativeImage, width: number, height: number): FrameVerdict {
  const size = image.getSize();
  if (size.width !== width || size.height !== height) return {ok: false, detail: `image ${size.width}x${size.height}`};
  const pixels = image.toBitmap();
  if (pixels.length !== width * height * 4) return {ok: false, detail: `partial buffer ${pixels.length} of ${width * height * 4}`};
  if (!hasPaintedPixels(pixels)) return {ok: false, detail: `unpainted ${size.width}x${size.height}`};
  return {ok: true, pixels};
}

/**
 * Reads one frame, bounded by the same overall deadline as the readiness loop.
 *
 * `capturePage()` can simply never settle, which would make the loop's deadline
 * unreachable, so the read races the deadline. A read that arrives after the
 * deadline is dropped here and can never be accepted or claim a resource; the
 * outcome carries the failure text instead of swallowing it, so a read that
 * keeps failing is visible in the loop's final error.
 */
function readFrame(contents: WebContents, deadline: number): Promise<{image: NativeImage | null; error: string | null; timedOut: boolean}> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve({image: null, error: null, timedOut: true});
  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (outcome: {image: NativeImage | null; error: string | null; timedOut: boolean}): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(outcome);
    };
    timer = setTimeout(() => done({image: null, error: null, timedOut: true}), Math.max(1, remaining));
    try {
      contents.capturePage().then(
        image => done({image: image ?? null, error: null, timedOut: false}),
        failure => done({image: null, error: failure instanceof Error ? failure.message : String(failure), timedOut: false}),
      );
    } catch (failure) {
      // A read that throws synchronously is recorded like any other read failure.
      done({image: null, error: failure instanceof Error ? failure.message : String(failure), timedOut: false});
    }
  });
}

/**
 * Waits for the next offscreen frame, or for `ms`, whichever comes first.
 *
 * The compositor's own `paint` event carries the frame it just produced, so a
 * paint that already covers the requested viewport is returned as evidence. A
 * partial (dirty-area) image is not evidence and the caller re-reads instead.
 * The timer only bounds one observation; the listener and the timer are always
 * released, and a paint that arrives after the wait is dropped.
 */
function waitForNextFrame(contents: WebContents, ms: number, width: number, height: number): Promise<NativeImage | null> {
  const emitter = contents as unknown as PaintEmitter;
  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (image: NativeImage | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { emitter.off("paint", onPaint); } catch { /* the contents are already gone */ }
      resolve(image);
    };
    const onPaint = (_event: unknown, _dirty: unknown, image: NativeImage): void => {
      const size = image && typeof image.getSize === "function" ? image.getSize() : null;
      done(size && size.width === width && size.height === height ? image : null);
    };
    try { emitter.on("paint", onPaint); } catch { /* destroyed contents resolve on the timer */ }
    timer = setTimeout(() => done(null), Math.max(1, ms));
  });
}

/** Paintability state, so an absent frame is diagnosable instead of assumed. */
function paintableState(contents: WebContents): string {
  const probe = contents as unknown as { isPainting?: () => boolean; getBackgroundThrottling?: () => boolean };
  const painting = typeof probe.isPainting === "function" ? probe.isPainting() : null;
  const throttled = typeof probe.getBackgroundThrottling === "function" ? probe.getBackgroundThrottling() : null;
  return `painting=${String(painting)} throttled=${String(throttled)} offscreen=${String(contents.isOffscreen())}`;
}

/** Drop the per-instance secret origin token from a served request path. */
export function redactRuntimePath(url: string): string {
  return typeof url === "string" ? url.replace(/^\/w\/[a-f0-9]{64}\//, "/w/*/") : "";
}

function requireId(name: string, value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

/** True when `candidate` is inside one of the allowed build roots. */
export function isInsideAllowedRoot(candidate: string, allowedRoots: readonly string[]): boolean {
  const target = resolve(candidate);
  return allowedRoots.some((allowed) => {
    const base = resolve(allowed);
    return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
  });
}

/** The game rect: the measured panel surface minus the panel chrome strip. */
export function gameBounds(bounds: GodotWorldBounds, chromeHeight: number = WORLD_CHROME_HEIGHT): GodotWorldBounds {
  const x = Math.max(0, Math.round(Number(bounds.x) || 0));
  const y = Math.max(0, Math.round(Number(bounds.y) || 0));
  const width = Math.max(0, Math.round(Number(bounds.width) || 0));
  const height = Math.max(0, Math.round(Number(bounds.height) || 0));
  const top = Math.min(height, Math.max(0, Math.round(chromeHeight)));
  return { x, y: y + top, width, height: Math.max(0, height - top) };
}

type LiveInstance = {
  headlessPlayToken?: string;
  runtime: WorldRuntime;
  view: WebContentsView;
  worldId: string;
  buildId: string;
  instanceId: string;
  detach: () => void;
  alive: boolean;
  /** The web contents were already closed; closing twice must be a no-op. */
  closed: boolean;
  closePromise?: Promise<void>;
  retirement?: Promise<void>;
  /** Bounded renderer console tail; evidence for a failed startup. */
  consoleLog: Array<{ at: number; level: string; message: string }>;
  /** Page/renderer faults observed for this instance, newest last. */
  faults: string[];
};

/** Bounded evidence for one native instance; never a claim that it rendered. */
export type GodotWorldDiagnostics = {
  worldId: string;
  buildId: string;
  instanceId: string;
  alive: boolean;
  console: Array<{ at: number; level: string; message: string }>;
  faults: string[];
  requests: Array<{ method: string; path: string; status: number }>;
};

export class GodotWorldViewHost {
  private immersion = NO_IMMERSION;
  private pauseController = createImmersionPauseController();
  private pauseIntentRevision = new WeakMap<LiveInstance, number>();

  async setImmersion(state: CraftmineImmersionState): Promise<void> {
    this.immersion = state;
    const blocked = immersionBlocksInput(state);
    for (const instance of [this.current, this.pending]) {
      if (instance?.alive && !instance.view.webContents.isDestroyed()) {
        instance.view.webContents.send(IMMERSION_INPUT_CHANNEL, blocked);
        instance.view.webContents.send(WORLD_CURSOR_CHANNEL, state.active && !blocked);
      }
    }
    this.applyBounds();
    await this.pauseController.setOverlay(blocked);
    const instance = this.current;
    if (instance?.alive && this.pauseController.has(instance) && ["ready", "paused", "saved"].includes(this.currentState?.state ?? "")) {
      this.publish({...this.identityOf(instance), state:this.pauseController.paused(instance) ? "paused" : "ready"});
    }
  }
  private current: LiveInstance | null = null;
  /** Replacement instance that has not finished starting yet. */
  private pending: LiveInstance | null = null;
  private stagingAttempt: {worldId: string; cancelled: boolean; instance?: LiveInstance; settled: Promise<void>; finish(): void} | null = null;
  private stagedRequest: GodotWorldOpenRequest | null = null;
  /** Supplied only by the trusted candidate coordinator at staging time. */
  private stagedCandidateId: string | null = null;
  private candidateVisible = false;
  private bounds: GodotWorldBounds = { x: 0, y: 0, width: 0, height: 0 };
  private visible = false;
  private surfaceVisible = true;
  private currentState: GodotWorldState | null = null;
  private revision: number | null = null;
  private transitioning = false;
  private generation = 0;
  private savePromise: Promise<GodotWorldSaveResult> | null = null;
  private checkpointPromise: Promise<GodotWorldSaveResult> | null = null;
  private frozen: { instance: LiveInstance; result: GodotWorldSaveResult } | null = null;
  private captureBounds: GodotWorldBounds | null = null;
  private syncHolds = 0;
  private syncing = false;
  private syncPromise: Promise<GodotWorldState | null> = Promise.resolve(null);
  private lastSync = 0;
  /** A failed durable selection waits for an explicit retry or changed input. */
  private failedSyncKey: string | null = null;
  private poll?: ReturnType<typeof setInterval>;
  private disposed = false;
  private closing: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private retiring = new Set<Promise<void>>();
  private starting = new Set<Promise<void>>();
  private retirementFailures: string[] = [];
  private onState?: (state: GodotWorldState) => void;
  /** Bounded readiness budget for one acceptance capture (test seam). */
  private readonly captureReadyMs: number;

  constructor(
    private readonly options: {
      /** The window the game view is composited into. */
      window: () => MainWindow | null;
      /** Commits the runner confirmation through the host progress transaction. */
      progress?: (call: GodotWorldProgressCall) => Promise<GodotWorldProgressResult>;
      /** Build roots the runtime may serve. Defaults to none (everything refused). */
      allowedRoots?: () => readonly string[];
      /**
       * The active world as the host sees it, or null when the panel is not
       * showing a Godot world. `sync()` calls this; the module never invents a
       * world identity of its own.
       */
      descriptor?: () => Promise<GodotWorldOpenRequest | null>;
      onState?: (state: GodotWorldState) => void;
      /** Finite native keyboard action for this host's currently displayed view. */
      onFullscreenShortcut?: (action: "toggle" | "exit") => void;
      onImmersionShortcut?: (action: CraftmineImmersionShortcut) => void;
      /** Test seam: called with every runtime event. */
      onEvent?: (event: RuntimeEvent) => void;
      /**
       * Test seam: readiness budget for one acceptance capture, clamped to a
       * sane range. Production leaves it unset and uses the fixed default.
       */
      captureReadyMs?: number;
    },
  ) {
    this.onState = options.onState;
    this.captureReadyMs = Number.isSafeInteger(options.captureReadyMs) && (options.captureReadyMs as number) > 0
      ? Math.min(Math.max(options.captureReadyMs as number, 250), 30_000)
      : CAPTURE_READY_DEADLINE_MS;
  }

  get state(): GodotWorldState | null {
    return this.currentState;
  }

  get instance(): { worldId: string; buildId: string; instanceId: string; url: string } | null {
    if (!this.current) return null;
    return {
      worldId: this.current.worldId,
      buildId: this.current.buildId,
      instanceId: this.current.instanceId,
      url: this.current.runtime.url,
    };
  }

  /** OS process ownership only. No page script, focus, or runtime mutation. */
  get performanceProcess() {
    const instance = this.current;
    if (!instance?.alive || instance.view.webContents.isDestroyed()) return null;
    if (this.pending || this.transitioning || this.checkpointPromise) throw Error("WORLD_BUSY");
    return {
      worldId: instance.worldId, buildId: instance.buildId, instanceId: instance.instanceId,
      rendererProcessId: instance.view.webContents.getOSProcessId(),
      webContentsId: instance.view.webContents.id,
    };
  }

  async ensure(request: GodotWorldOpenRequest): Promise<GodotWorldState> {
    if (this.transitioning || this.pending || this.stagedRequest) throw new Error("WORLD_BUSY");
    const requestKey = this.selectionKey(request);
    // Explicit open/retry is allowed to attempt the same saved selection again.
    this.failedSyncKey = null;
    this.transitioning = true;
    try { return await this.ensureInner(request); }
    catch (error) {
      if (!this.disposed && !/WORLD_BUSY|GODOT_CANDIDATE_ACTIVE|cancelled/i.test(String(error))) this.failedSyncKey = requestKey;
      throw error;
    }
    finally { this.transitioning = false; }
  }

  private selectionKey(request: GodotWorldOpenRequest): string | null {
    try {
      // Include actual restore inputs, not just worldId: maintenance may replace
      // the build, and a newly saved revision must remain eligible to load.
      return JSON.stringify([request.worldId, request.buildId, request.revision,
        request.root, request.entry, request.threads, request.artifacts,
        request.snapshot, request.build]);
    } catch { return null; }
  }

  private async ensureInner(request: GodotWorldOpenRequest): Promise<GodotWorldState> {
    if (this.disposed) throw new Error("Godot world host is disposed");
    if (this.pending) throw new Error("A world instance is already starting");
    const worldId = requireId("world identity", request.worldId);
    const buildId = requireId("build identity", request.buildId);
    if (!Array.isArray(request.artifacts) || request.artifacts.length < 1) throw new Error("GODOT_RUNTIME_ARTIFACT_MANIFEST_REQUIRED");
    const allowed = this.options.allowedRoots?.() ?? [];
    if (!Number.isSafeInteger(request.revision) || request.revision < 0) throw new Error("Durable world revision is required");
    const root = await realpath(resolve(request.root ?? ""));
    const canonicalAllowed = (await Promise.all(allowed.map((item) => realpath(resolve(item)).catch(() => null)))).filter((item): item is string => item !== null);
    if (this.disposed) throw new Error("Godot world host is disposed");
    if (!isInsideAllowedRoot(root, canonicalAllowed)) {
      throw new Error("World build is outside the allowed build roots");
    }
    if (this.current && this.current.worldId === worldId && this.current.buildId === buildId && this.current.alive) {
      this.applyBounds();
      return this.publish({
        worldId,
        buildId,
        instanceId: this.current.instanceId,
        state: this.currentState?.state ?? "loading",
      });
    }
    // Checkpoint the old runtime before a replacement can start. It must reach ready before the
    // running world is stopped, so a broken candidate build cannot take the
    // player's current world (and its confirmed progress) down with it.
    const previous = this.current;
    const previouslyPaused = previous && this.pauseController.has(previous) ? this.pauseController.manualPaused(previous) : true;
    const checkpointIntent = previous ? (this.pauseIntentRevision.get(previous) ?? 0) + (this.frozen?.instance === previous ? 0 : 1) : 0;
    if (previous?.alive) {
      const saved = await this.checkpoint();
      if (saved.status !== "persisted") throw new Error(saved.error);
    }
    try { return await this.startReplacement(request, root, worldId, buildId, previous); }
    catch (error) {
      if (previous === this.current && previous?.alive && !previouslyPaused && this.pauseIntentRevision.get(previous) === checkpointIntent) await this.resume().catch(() => undefined);
      throw error;
    }
  }

  private startReplacement(request: GodotWorldOpenRequest, root: string, worldId: string, buildId: string, previous: LiveInstance | null, staged = false, attempt: typeof this.stagingAttempt = null): Promise<GodotWorldState> {
    if (this.disposed) return Promise.reject(new Error("World startup was cancelled"));
    const completion = this.startReplacementInner(request, root, worldId, buildId, previous, staged, attempt);
    // Track from before the factory returns, not only after pending is set.
    // A failed creation remains an error for its caller; shutdown waits for its
    // completion and any owned cleanup, rather than treating cancellation as a
    // cleanup failure by itself.
    const settled = completion.then(() => undefined, () => undefined);
    this.starting.add(settled);
    void settled.then(() => this.starting.delete(settled));
    return completion;
  }

  private async startReplacementInner(request: GodotWorldOpenRequest, root: string, worldId: string, buildId: string, previous: LiveInstance | null, staged: boolean, attempt: typeof this.stagingAttempt): Promise<GodotWorldState> {
    const generation = this.generation;
    // The product panel owns startup progress. A pending native world remains
    // behind it with a real compositor surface while restore crosses physics
    // frames, including retained exports whose HTML predates the loading shell.
    const startupState=(loadingStage: GodotWorldState["loadingStage"],instanceId="")=>{
      if(!previous&&!staged)this.publish({worldId,buildId,instanceId,state:"loading",loadingStage});
    };
    startupState("resources");
    const runtime = await createWorldRuntime({
      worldId,
      buildId,
      root,
      artifacts: request.artifacts,
      entry: request.entry,
      threads: request.threads,
      timeoutMs: request.timeoutMs,
    });
    let view: WebContentsView;
    try {
      if (this.disposed || generation !== this.generation || attempt?.cancelled) throw new Error("World startup was cancelled");
      view = this.createView(runtime);
    } catch (error) {
      // A view that cannot be created must not leave a listening server behind.
      await this.trackRetirement(() => runtime.dispose({ graceful: false })).catch(() => undefined);
      throw error;
    }
    const instance: LiveInstance = {
      runtime,
      view,
      worldId,
      buildId,
      instanceId: runtime.instanceId,
      detach: () => {},
      alive: true,
      closed: false,
      consoleLog: [],
      faults: [],
    };
    this.pending = instance;
    if (attempt) attempt.instance = instance;
    instance.detach = runtime.attach((message) => {
      if (!instance.alive || instance.view.webContents.isDestroyed()) return;
      instance.view.webContents.send(GODOT_WORLD_MESSAGE_CHANNEL, message);
    });
    // Renderer console is the only signal a Web export gives before `ready`;
    // keep a bounded tail so a startup failure names the actual cause.
    const onConsole = (event: unknown, legacyLevel?: unknown, legacyMessage?: unknown): void => {
      const details = (event ?? {}) as Record<string, unknown>;
      const message = typeof details.message === "string" ? details.message : typeof legacyMessage === "string" ? legacyMessage : "";
      if (!message) return;
      const level = typeof details.level === "string" ? details.level : typeof legacyLevel === "number" ? String(legacyLevel) : "unknown";
      instance.consoleLog.push({ at: Date.now(), level, message: message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 400) });
      if (instance.consoleLog.length > CONSOLE_KEEP) instance.consoleLog.shift();
    };
    // Electron 43 passes one event object; older builds pass (event, level, message, line, source).
    view.webContents.on("console-message", onConsole as unknown as (event: Electron.Event) => void);
    view.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame) return;
      if (instance !== this.current && instance !== this.pending) return;
      this.recordFault(instance, `did-fail-load ${code} ${description}`);
      // A pending startup can never finish: reject it now instead of waiting
      // out the whole startup budget for a page that is not there.
      runtime.abortStartup(`World view failed to load (${code} ${description})`);
      this.fail(instance, `World view failed to load (${code} ${description})`, true);
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      if (instance !== this.current && instance !== this.pending) return;
      this.recordFault(instance, `render-process-gone ${details.reason} ${details.exitCode}`);
      runtime.abortStartup(`World renderer stopped: ${details.reason} (${details.exitCode})`);
      this.fail(instance, `World renderer stopped: ${details.reason}`, true);
    });
    view.webContents.on("destroyed", () => { this.recordFault(instance, "renderer-destroyed"); });
    const startupProbe = createGodotStartupProbe(view.webContents);
    try {
      if (attempt?.cancelled) throw new Error("World startup was cancelled");
      startupState("engine",runtime.instanceId);
      this.attachStagingView(instance);
      await view.webContents.loadURL(runtime.url);
      // Constructor preferences do not resynchronize the hidden RenderWidget
      // created during navigation. Apply the policy to that loaded widget too.
      view.webContents.setBackgroundThrottling(false);
      startupProbe.phase("wait-ready");
      await runtime.waitReady();
      if (attempt?.cancelled) throw new Error("World startup was cancelled");
      if (hasHeadlessController()) {
        startupProbe.phase("capabilities");
        const capabilities = await runtime.request("capabilities", {});
        // Old retained worlds remain playable but cannot claim the new test API.
        if (capabilities.result?.headlessPlayActionFormat === "craftmine.headless-play-action/1") {
          const token = randomBytes(32).toString("hex");
          const authorization = await runtime.request("headless-play-authorize", { token });
          if (authorization.error) throw Error("PLAY_ACTION_AUTHORIZATION_FAILED");
          instance.headlessPlayToken = token;
        }
      }
      if (request.build !== undefined || request.snapshot !== undefined) {
        startupProbe.phase("scene-load");
        startupState("scene",runtime.instanceId);
        const loaded = await runtime.load({ build: request.build ?? null, snapshot: request.snapshot ?? null });
        if (loaded.error) throw new Error(loaded.error);
      }
      if (this.disposed || generation !== this.generation || !instance.alive || attempt?.cancelled) throw new Error("World startup was cancelled");
      startupProbe.phase("pause");
      await this.pauseController.attach(instance, {
        pause: async () => { const result = await runtime.pause(); if (result.error) throw new Error(result.error); },
        resume: async () => { const result = await runtime.resume(); if (result.error) throw new Error(result.error); },
      });
      if (!staged) await this.pauseController.setManual(instance, false);
    } catch (error) {
      // Freeze the causal evidence before our own close emits `destroyed`.
      const message = error instanceof Error ? error.message : String(error);
      const reason = `${message}${this.describeFailure(instance)}${await startupProbe.failure()}`;
      this.pending = null;
      instance.alive = false;
      instance.detach();
      await this.retireInstance(instance, false).catch(() => undefined);
      if (previous?.alive) {
        // The running world is untouched: report its own identity, not the
        // candidate that failed.
        this.publish({ ...this.identityOf(previous), state: this.currentState?.state === "paused" ? "paused" : "ready", error: message });
      } else {
        this.publish({ worldId, buildId, instanceId: "", state: "failed", error: message });
      }
      throw new Error(`${reason}${previous?.alive ? " (previous world kept running)" : ""}`);
    } finally {
      startupProbe.dispose();
    }
    if (this.disposed || generation !== this.generation || !instance.alive || attempt?.cancelled) {
      this.pending = null;
      this.stagedRequest = null;
      this.stagedCandidateId = null;
      instance.alive = false;
      instance.detach();
      await this.retireInstance(instance, false).catch(() => undefined);
      throw new Error("World startup was cancelled");
    }
    if (staged) {
      runtime.onEvent(event=>{
        if(this.pending!==instance)return;
        if(event.type==="exited"||event.type==="runtime-error") { instance.alive=false; this.pauseController.detach(instance); }
        this.options.onEvent?.(event);
      });
      this.stagedRequest = request;
      return {...this.identityOf(instance), state:"paused"};
    }
    this.pending = null;
    this.current = instance;
    this.revision = request.revision;
    this.frozen = null;
    runtime.onEvent((event) => this.handleEvent(instance, event));
    view.webContents.once("did-finish-load", () => {
      if (!instance.alive) return;
      this.applyBounds();
    });
    this.publish({ worldId, buildId, instanceId: runtime.instanceId, state: this.pauseController.paused(instance) ? "paused" : "ready" });
    this.applyBounds();
    if (previous) {
      previous.alive = false;
      previous.detach();
      try {
        if (!previous.view.webContents.isDestroyed()) previous.view.webContents.send(GODOT_WORLD_DETACH_CHANNEL);
      } catch {
        // The old renderer may already be gone.
      }
      this.detachView(previous.view);
      await this.retireInstance(previous, true).catch(() => undefined);
    }
    return this.currentState!;
  }

  /**
   * Start a candidate in an independent origin while retaining the old formal
   * instance. `first` stages the very first instance of a world that has no
   * formal runtime yet, so the creation flow is not blocked on a world that
   * only a confirmed application can produce.
   */
  async stageCandidate(request: GodotWorldOpenRequest, options: { first?: boolean; candidateId?: string } = {}): Promise<GodotWorldState> {
    if (this.disposed || this.transitioning || this.pending || this.stagedRequest) throw new Error("WORLD_BUSY");
    const worldId = requireId("world identity", request.worldId);
    let finish!: () => void;
    const attempt = {worldId, cancelled: false, settled: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish()};
    this.stagingAttempt = attempt;
    this.transitioning = true;
    try {
      const buildId = requireId("build identity", request.buildId);
      if (options.first) {
        if (this.current?.alive) throw new Error("GODOT_WORLD_ALREADY_RUNNING");
      } else {
        if (!this.current?.alive || this.current.worldId !== worldId) throw new Error("GODOT_WORLD_CHANGED");
      }
      if (!Number.isSafeInteger(request.revision) || request.revision < 0 || !Array.isArray(request.artifacts) || !request.artifacts.length) throw new Error("INVALID_GODOT_CANDIDATE_DESCRIPTOR");
      const root = await realpath(resolve(request.root));
      const roots = (await Promise.all((this.options.allowedRoots?.() ?? []).map(item=>realpath(resolve(item)).catch(()=>null)))).filter((item):item is string=>item!==null);
      if (!isInsideAllowedRoot(root, roots)) throw new Error("Candidate build is outside the allowed build roots");
      const candidateId = options.candidateId === undefined ? null : requireId("candidate identity", options.candidateId);
      if (attempt.cancelled) throw new Error("World startup was cancelled");
      if (!options.first) await this.pause();
      if (attempt.cancelled) throw new Error("World startup was cancelled");
      const result = await this.startReplacement(request, root, worldId, buildId, this.current, true, attempt);
      this.stagedCandidateId = candidateId;
      return result;
    } finally {
      this.transitioning = false;
      if (this.stagingAttempt === attempt) this.stagingAttempt = null;
      attempt.finish();
    }
  }

  /** Abort only this world's in-flight stage; callers retain their own transaction recovery. */
  async cancelStaging(worldId: string): Promise<boolean> {
    const attempt = this.stagingAttempt;
    if (!attempt || attempt.worldId !== worldId) return false;
    attempt.cancelled = true;
    attempt.instance?.runtime.abortStartup("World startup was cancelled");
    await attempt.settled;
    return true;
  }

  get candidateInstance(): {worldId:string;buildId:string;instanceId:string} | null {
    return this.stagedRequest && this.pending?.alive ? this.identityOf(this.pending) : null;
  }

  /** Candidate operations never call the formal progress adapter. */
  async candidateRequest(op: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const candidate = this.pending;
    if (!this.stagedRequest || !candidate?.alive) throw new Error("GODOT_CANDIDATE_UNAVAILABLE");
    const response = await candidate.runtime.request(op, args);
    if (response.error) throw new Error(response.error);
    return (response.result ?? {}) as Record<string, unknown>;
  }

  setCandidateVisible(visible: boolean): void {
    this.candidateVisible = visible;
    this.applyBounds();
  }

  async discardCandidate(): Promise<void> {
    const candidate = this.pending;
    this.pending = null;
    this.stagedRequest = null;
    this.stagedCandidateId = null;
    this.candidateVisible = false;
    if (candidate) {
      candidate.alive = false;
      candidate.detach();
      this.detachView(candidate.view);
      await this.retireInstance(candidate, false);
    }
    this.applyBounds();
  }

  /** Only a descriptor re-read after a confirmed Rust commit authorizes promotion. */
  async promoteCandidate(request: GodotWorldOpenRequest): Promise<GodotWorldState> {
    const candidate = this.pending, staged = this.stagedRequest;
    if (!candidate?.alive || !staged || candidate.worldId !== request.worldId || candidate.buildId !== request.buildId ||
        resolve(staged.root) !== resolve(request.root) || request.revision <= staged.revision ||
        JSON.stringify(staged.artifacts) !== JSON.stringify(request.artifacts)) throw new Error("GODOT_CANDIDATE_PROMOTION_MISMATCH");
    const previous = this.current;
    this.pending = null; this.stagedRequest = null; this.candidateVisible = false;
    this.stagedCandidateId = null;
    this.current = candidate; this.revision = request.revision; this.frozen = null;
    candidate.runtime.onEvent(event=>this.handleEvent(candidate,event));
    this.publish({...this.identityOf(candidate),state:"paused"});
    this.applyBounds();
    if (previous) {
      previous.alive = false; previous.detach(); this.detachView(previous.view);
      await this.retireInstance(previous, true).catch(()=>undefined);
    }
    await this.resume();
    return this.currentState!;
  }

  /** Read only the named, already attached world view; never opens or resizes it. */
  async captureView(input: GodotViewCaptureIdentity): Promise<GodotViewCapture> {
    validateGodotViewCaptureIdentity(input);
    input = {...input};
    const candidate = input.candidateId !== undefined;
    const instance = candidate ? this.pending : this.current;
    const owner = this.options.window();
    if (!instance?.alive || !owner || owner.isDestroyed()) throw Error("GODOT_VIEW_CAPTURE_UNAVAILABLE");
    const view = instance.view, contents = view.webContents, bounds = {...view.getBounds()}, staged = this.stagedRequest;
    const generation = this.generation;
    const verify = () => {
      if (this.disposed || this.closing || this.transitioning || this.starting.size || this.checkpointPromise || this.savePromise || this.captureBounds) throw Error("GODOT_VIEW_CAPTURE_BUSY");
      if (this.generation !== generation || (candidate ? this.pending : this.current) !== instance || !instance.alive || instance.closed ||
          instance.worldId !== input.worldId || instance.buildId !== input.buildId || instance.instanceId !== input.instanceId) throw Error("GODOT_VIEW_CAPTURE_IDENTITY_CHANGED");
      if (candidate) {
        if (!staged || this.stagedRequest !== staged || !this.candidateVisible || this.stagedCandidateId !== input.candidateId ||
            staged.worldId !== input.worldId || staged.buildId !== input.buildId) throw Error("GODOT_VIEW_CAPTURE_CANDIDATE_CHANGED");
      } else {
        if (this.pending || this.stagedRequest || this.candidateVisible) throw Error("GODOT_VIEW_CAPTURE_BUSY");
        if (!["ready", "paused", "saved"].includes(this.currentState?.state ?? "")) throw Error("GODOT_VIEW_CAPTURE_UNAVAILABLE");
      }
      if (this.options.window() !== owner || owner.isDestroyed() || instance.view !== view || view.webContents !== contents || contents.isDestroyed() ||
          !this.visible || !this.surfaceVisible || !owner.contentView.children.includes(view)) throw Error("GODOT_VIEW_CAPTURE_DETACHED");
      const current = view.getBounds();
      if (["x", "y", "width", "height"].some(key => current[key as keyof GodotWorldBounds] !== bounds[key as keyof GodotWorldBounds])) throw Error("GODOT_VIEW_CAPTURE_DIMENSIONS_CHANGED");
    };
    return captureBoundGodotView(contents, input, bounds.width, bounds.height, verify);
  }

  /** Current world state as the runtime reports it; used by the progress transaction. */
  async snapshot(): Promise<Record<string, unknown> | null> {
    const instance = this.current;
    if (!instance?.alive) return null;
    const response = await instance.runtime.snapshot().catch(() => null);
    return (response?.result ?? null) as Record<string, unknown> | null;
  }

  /** Private acceptance capture of the actual game view; never generates input. */
  async headlessCapture(width: number, height: number): Promise<{pngBase64: string; width: number; height: number; pixelStats: {bytes: number; sampledColors: number}; viewportObservation: unknown}> {
    const instance = this.current;
    if (process.env.CRAFTMINE_HEADLESS_TEST === "1" && !instance?.alive) throw Error("GODOT_CAPTURE_RUNTIME_NOT_RUNNING");
    if (process.env.CRAFTMINE_HEADLESS_TEST !== "1" || !instance?.alive ||
        !instance.view.webContents.isOffscreen() || !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) || width < 320 || height < 240 || width > 1920 || height > 1080) {
      throw new Error("GODOT_HEADLESS_CAPTURE_REFUSED");
    }
    const previous = instance.view.getBounds();
    const owner = this.options.window();
    if (!owner || owner.isDestroyed() || owner.isVisible() || owner.isFocusable() || !owner.webContents.isOffscreen()) throw Error("GODOT_CAPTURE_OWNER_NOT_ISOLATED");
    // Fullscreen capture must use captureView's read-only, identity-bound
    // compositor path. Windows may change native focusability while leaving
    // fullscreen, so an acceptance resize must never toggle that state.
    if (owner.isFullScreen()) throw Error("GODOT_HEADLESS_CAPTURE_FULLSCREEN_USE_BOUND_VIEW");
    const previousSize = owner.getContentSize(), minimumSize = owner.getMinimumSize();
    const wasAttached = owner.contentView.children.includes(instance.view);
    if (this.captureBounds) throw Error("GODOT_CAPTURE_ALREADY_RUNNING");
    this.captureBounds = {x: 0, y: 0, width, height};
    ++this.syncHolds;
    let failed = false;
    try {
      // Electron's offscreen child compositor follows its owning window's
      // viewport. Resize this hidden test window as well as the game view.
      owner.setMinimumSize(1, 1); owner.setContentSize(width, height, false);
      // A detached WebContentsView can run its page but has no compositor
      // surface: capturePage keeps returning 0x0 even while isPainting is true.
      // Attach only to this already hidden, non-focusable acceptance owner.
      if (!wasAttached) owner.contentView.addChildView(instance.view);
      instance.view.setBounds({x: 0, y: 0, width, height});
      const frame = await this.awaitCaptureFrame(instance, owner, width, height);
      // The frame and the viewport observation must describe the same instance:
      // a promotion or teardown while the observation was in flight must not
      // return the previous instance's frame as this one's evidence.
      if (this.current !== instance || !instance.alive) throw new Error("GODOT_WORLD_CHANGED");
      if (instance.view.webContents !== frame.contents || frame.contents.isDestroyed()) throw new Error("GODOT_CAPTURE_VIEW_GONE");
      const viewportObservation = await this.request("observe-envelope", {});
      if (this.current !== instance || !instance.alive) throw new Error("GODOT_WORLD_CHANGED");
      if (instance.view.webContents !== frame.contents || frame.contents.isDestroyed()) throw new Error("GODOT_CAPTURE_VIEW_GONE");
      if (owner.isDestroyed() || owner.isVisible() || owner.isFocusable()) throw new Error("GODOT_CAPTURE_OWNER_NOT_ISOLATED");
      return {pngBase64: frame.image.toPNG().toString("base64"), width: frame.width, height: frame.height,
        pixelStats: {bytes: frame.bytes, sampledColors: frame.sampledColors}, viewportObservation};
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // Every release step is independent: a window that refuses to resize must
      // not stop the holds, the capture lock or the view bounds from being
      // released. Restore failures are reported, never swallowed, and never
      // replace the error that aborted the capture.
      const restoreFailures: string[] = [];
      this.captureBounds = null;
      try {
        if (!owner.isDestroyed()) owner.setContentSize(previousSize[0], previousSize[1], false);
      } catch (error) { restoreFailures.push(`owner size: ${error instanceof Error ? error.message : String(error)}`); }
      try {
        if (!owner.isDestroyed()) owner.setMinimumSize(minimumSize[0], minimumSize[1]);
      } catch (error) { restoreFailures.push(`minimum size: ${error instanceof Error ? error.message : String(error)}`); }
      try {
        if (instance.alive && !instance.view.webContents.isDestroyed()) instance.view.setBounds(previous);
      } catch (error) { restoreFailures.push(`view bounds: ${error instanceof Error ? error.message : String(error)}`); }
      try {
        if (!wasAttached && !owner.isDestroyed() && owner.contentView.children.includes(instance.view)) owner.contentView.removeChildView(instance.view);
      } catch (error) { restoreFailures.push(`view attachment: ${error instanceof Error ? error.message : String(error)}`); }
      --this.syncHolds;
      try { this.applyBounds(); } catch (error) { restoreFailures.push(`applyBounds: ${error instanceof Error ? error.message : String(error)}`); }
      if (restoreFailures.length > 0 && !failed) throw new Error(`GODOT_CAPTURE_RESTORE_FAILED: ${restoreFailures.join("; ")}`);
    }
  }

  /**
   * Waits for a real frame of the requested size from this exact instance.
   *
   * The previous version slept for a fixed 350ms and returned whatever
   * `capturePage()` produced, which is how an acceptance capture could come back
   * as 0x0: the only thing the old evidence proved is that `capturePage()`
   * answered with an empty image. So this does not assume the cause. It reads
   * both frame sources the compositor offers (the `paint` event's own image and
   * a bounded `capturePage()` read), records the paintable state of the view
   * when no frame qualifies, re-checks the instance, the view and the hidden
   * owner on every attempt, and fails at the deadline with that diagnosis
   * instead of returning a size. Nothing here shows, focuses or activates a
   * window, and no frame is ever synthesised.
   */
  private async awaitCaptureFrame(instance: LiveInstance, owner: MainWindow, width: number, height: number): Promise<{
    image: NativeImage; contents: WebContents; width: number; height: number; bytes: number; sampledColors: number; attempts: number; waitedMs: number;
  }> {
    const view = instance.view, contents = view.webContents, startedAt = Date.now();
    const deadline = startedAt + this.captureReadyMs;
    const observations: string[] = [];
    const observe = (detail: string): void => { if (observations.length < CAPTURE_OBSERVATION_KEEP) observations.push(detail); };
    let attempts = 0;
    const assertScope = (): void => {
      if (this.current !== instance || !instance.alive) throw new Error("GODOT_WORLD_CHANGED");
      if (view.webContents !== contents || contents.isDestroyed()) throw new Error("GODOT_CAPTURE_VIEW_GONE");
      // The owner must stay hidden and unfocusable for the whole capture: a
      // shown or focusable owner is a violated isolation, not a slower frame.
      if (owner.isDestroyed() || owner.isVisible() || owner.isFocusable()) throw new Error("GODOT_CAPTURE_OWNER_NOT_ISOLATED");
    };
    const accept = (image: NativeImage, pixels: Uint8Array): {image: NativeImage; contents: WebContents; width: number; height: number; bytes: number; sampledColors: number; attempts: number; waitedMs: number} => ({
      image, contents, width, height, bytes: pixels.length, sampledColors: sampledColorCount(pixels), attempts, waitedMs: Date.now() - startedAt,
    });
    for (;;) {
      assertScope();
      attempts += 1;
      if (attempts === 1) observe(`view ${view.getBounds().width}x${view.getBounds().height} attached=${String(owner.contentView.children.includes(view))} ${paintableState(contents)}`);
      contents.invalidate();
      const read = await readFrame(contents, deadline);
      assertScope();
      if (read.image) {
        const verdict = inspectFrame(read.image, width, height);
        if (verdict.ok) return accept(read.image, verdict.pixels);
        observe(`capture ${verdict.detail}`);
      } else if (read.error) {
        observe(`capture failed: ${read.error}`);
      } else if (read.timedOut) {
        observe("capture read timed out at the deadline");
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`GODOT_CAPTURE_EMPTY_FRAME: no painted ${width}x${height} frame from instance ${instance.instanceId} ` +
          `after ${attempts} attempts in ${Date.now() - startedAt}ms (${observations.join(", ") || "no image"})`);
      }
      const painted = await waitForNextFrame(contents, Math.min(remaining, CAPTURE_FRAME_WAIT_MS), width, height);
      if (!painted) continue;
      assertScope();
      const verdict = inspectFrame(painted, width, height);
      if (verdict.ok) return accept(painted, verdict.pixels);
      observe(`paint ${verdict.detail}`);
      const afterPaint = deadline - Date.now();
      if (afterPaint <= 0) {
        throw new Error(`GODOT_CAPTURE_EMPTY_FRAME: no painted ${width}x${height} frame from instance ${instance.instanceId} ` +
          `after ${attempts} attempts in ${Date.now() - startedAt}ms (${observations.join(", ") || "no image"})`);
      }
    }
  }

  /** Forward one runtime operation; the base owns everything but the core ops. */
  async request(op: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
    if (PRIVATE_PLAY_OPS.has(op)) throw Error("PLAY_ACTION_PRIVATE_ROUTE");
    if (op === "engine-performance") throw Error("ENGINE_PERFORMANCE_PRIVATE_ROUTE");
    const instance = this.current;
    if (!instance?.alive) throw new Error("No world runtime is running");
    // A completed checkpoint freezes mutations, while core observation stays
    // available for recovery verification without resuming the simulation.
    const frozenRead = op === "observe-envelope" || op === "snapshot";
    if (this.pending || this.transitioning || this.checkpointPromise || (this.frozen && !frozenRead)) throw new Error("WORLD_BUSY");
    const response = await instance.runtime.request(op, args);
    if (response.error) throw new Error(response.error);
    return (response.result ?? null) as Record<string, unknown> | null;
  }

  /** Only the source/PCK-verified Main service may dispatch this fixed read. */
  async enginePerformance(identity: {worldId:string;buildId:string;instanceId:string}, nonce: string): Promise<Record<string, unknown> | null> {
    return readEnginePerformance({current:()=>this.current,busy:()=>Boolean(this.pending||this.transitioning||this.checkpointPromise)},identity,nonce);
  }

  /** Fixed page input for a finite private operator; no renderer/model route. */
  async headlessGameInput(identity:PlayIdentity,events:GameInputEvent[]):Promise<Record<string,unknown>> {
    if(!hasHeadlessController())throw Error('GAME_INPUT_HEADLESS_ONLY');
    validateGameInputEvents(events);
    const instance=this.current;
    const verify=()=>{
      if(!identity||Object.keys(identity).sort().join(',')!=='buildId,instanceId,worldId'||!instance?.alive||
        this.current!==instance||['worldId','buildId','instanceId'].some(key=>(instance as any)[key]!==identity[key as keyof PlayIdentity]))throw Error('GAME_INPUT_IDENTITY');
      if(this.pending||this.transitioning||this.checkpointPromise||this.frozen||instance.view.webContents.isDestroyed())throw Error('GAME_INPUT_BUSY');
    };
    verify();
    const result=await instance!.view.webContents.executeJavaScript(gameInputScript(identity,events),false);
    verify();return {...result,programSha256:GAME_INPUT_PROGRAM_SHA256};
  }

  /** Fixed test action, only reachable from the validated headless controller. */
  async headlessPlayAction(identity: PlayIdentity, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const instance = this.current;
    validateHeadlessPlayAction(hasHeadlessController(), instance?.alive ? this.identityOf(instance) : null, identity, args);
    if (!instance?.headlessPlayToken) throw Error("PLAY_ACTION_UNAVAILABLE");
    if (this.pending || this.transitioning || this.checkpointPromise || this.frozen) throw Error("WORLD_BUSY");
    try {
      const response = await instance.runtime.request("play-action", { action: "interact", frames: 1, token: instance.headlessPlayToken });
      if (response.error) throw Error(response.error);
      if (this.current !== instance || !instance.alive) throw Error("PLAY_ACTION_IDENTITY");
      return response.result ?? null;
    } catch (error) {
      // The engine also releases before pause/restore/exit. A timed-out reply
      // still gets a bounded cleanup request on the same private instance.
      await instance.runtime.request("headless-play-cancel", { token: instance.headlessPlayToken }, { timeoutMs: 1000 }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Bring the host in line with the active world: start it, reuse it, or stop
   * it when the panel no longer shows a Godot world. Idempotent and safe to
   * call from every bounds/visibility update; the descriptor round-trip is
   * throttled so a resize drag cannot hammer the plugin process.
   */
  async sync({ force = false }: { force?: boolean } = {}): Promise<GodotWorldState | null> {
    if (this.disposed || this.syncHolds) return this.currentState;
    if (!this.options.descriptor) return this.currentState;
    if (this.syncing) return this.syncPromise;
    const now = Date.now();
    if (!force && now - this.lastSync < SYNC_INTERVAL_MS) return this.currentState;
    this.lastSync = now;
    this.syncing = true;
    this.syncPromise = (async () => {
      let request: GodotWorldOpenRequest | null;
      try { request = await this.options.descriptor!(); }
      catch (error) {
        if (this.current) this.publish({ ...this.identityOf(this.current), state: this.currentState?.state ?? "ready", error: String(error) });
        return this.currentState;
      }
      if (this.syncHolds || this.pending || this.stagedRequest || this.transitioning) return this.currentState;
      if (!request) {
        this.failedSyncKey = null;
        await this.switchWorld(null).catch((error) => {
          if (this.current) this.publish({ ...this.identityOf(this.current), state: this.currentState?.state ?? "ready", error: String(error) });
        });
        return this.currentState;
      }
      if (this.current && this.current.alive && this.current.worldId === request.worldId && this.current.buildId === request.buildId) {
        return this.currentState;
      }
      const requestKey = this.selectionKey(request);
      // force bypasses descriptor throttling, including the periodic poll. It
      // is not a player retry and cannot continually recreate a broken world.
      if (requestKey && requestKey === this.failedSyncKey) return this.currentState;
      return this.ensure(request).catch((error) => {
        // A world that cannot start must not take the panel down with it.
        if (this.current?.alive) this.publish({ ...this.identityOf(this.current), state: this.currentState?.state ?? "ready", error: String(error?.message ?? error) });
        else this.publish({ worldId: request.worldId, buildId: request.buildId, instanceId: "", state: "failed", error: String(error?.message ?? error) });
        return this.currentState;
      });
    })().finally(() => {
      this.syncing = false;
    });
    return this.syncPromise;
  }

  /** Keep selection polling outside the host's explicit world-open transaction. */
  async holdSelectionSync(): Promise<() => void> {
    ++this.syncHolds;
    try { await this.syncPromise; }
    catch (error) { --this.syncHolds; throw error; }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      --this.syncHolds;
      if (this.visible) this.startPolling();
    };
  }

  setBounds(bounds: GodotWorldBounds): void {
    this.bounds = bounds;
    this.applyBounds();
    void this.sync();
  }

  setSurfaceVisible(visible: boolean): void {
    this.surfaceVisible = visible;
    this.applyBounds();
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.visible = visible;
    this.applyBounds();
    if (visible) {
      void this.sync({ force: true });
      this.startPolling();
    } else {
      this.stopPolling();
    }
  }

  /**
   * While the panel is on screen, re-read the active world so a world switch
   * inside the plugin page is picked up without a renderer event.
   */
  private startPolling(): void {
    if (this.poll || this.disposed || !this.options.descriptor) return;
    this.poll = setInterval(() => void this.sync({ force: true }), SYNC_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (!this.poll) return;
    clearInterval(this.poll);
    this.poll = undefined;
  }

  /**
   * Snapshot -> host progress transaction -> runner acknowledgement.
   * The three stages stay separate: a runner confirmation is not a durable
   * receipt, and the world is only reported saved after the host committed.
   */
  async save(options: { revision?: number } = {}): Promise<GodotWorldSaveResult> {
    if (this.stagedRequest) return {status:"failed",error:"GODOT_CANDIDATE_ACTIVE"};
    if (this.savePromise) return this.savePromise;
    this.frozen = null;
    this.savePromise = this.saveInner(options).finally(() => { this.savePromise = null; });
    return this.savePromise;
  }

  private async saveInner({ revision }: { revision?: number } = {}): Promise<GodotWorldSaveResult> {
    const instance = this.current;
    if (!instance || !instance.alive) return { status: "failed", error: "No world runtime is running" };
    // The revision advances only after the host transaction committed; using
    // the caller's value for this call keeps a failed save from poisoning the
    // base revision of the next attempt.
    const baseRevision = revision ?? this.revision;
    if (baseRevision === null || !Number.isSafeInteger(baseRevision) || baseRevision < 0) return { status: "failed", error: "Durable world revision is required" };
    this.publish({ ...this.identityOf(instance), state: "saving" });
    const confirmed: { error?: string; result?: Record<string, unknown> } = await instance.runtime.save().catch((error) => ({
      error: String(error?.message ?? error),
    }));
    if (confirmed.error) {
      this.publish({ ...this.identityOf(instance), state: "failed", error: confirmed.error });
      return { status: "failed", error: confirmed.error };
    }
    const result = (confirmed.result ?? {}) as Record<string, unknown>;
    const runnerReceipt = (result.runnerReceipt ?? {}) as Record<string, unknown>;
    if (result.status !== "confirmed") {
      const error = `Runner did not confirm the save: ${String(result.status ?? "unknown")}`;
      this.publish({ ...this.identityOf(instance), state: "failed", error });
      return { status: "failed", error, runnerReceipt };
    }
    if (!this.options.progress) {
      // No durable transaction is wired: report the runner confirmation only.
      this.publish({ ...this.identityOf(instance), state: "failed", error: "Host progress transaction is not connected" });
      return { status: "failed", error: "Host progress transaction is not connected", runnerReceipt };
    }
    const persisted = await this.options.progress({
      worldId: instance.worldId,
      buildId: instance.buildId,
      revision: baseRevision,
      runnerReceipt,
      snapshot: result.state ?? result.snapshot,
    }).catch((error) => ({ failed: true, error: String(error?.message ?? error) }) as GodotWorldProgressResult);
    if (!persisted || "failed" in persisted) {
      const error = persisted?.error ?? "Host progress transaction returned no durable receipt";
      await instance.runtime.acknowledge({ failed: true, error }).catch(() => undefined);
      this.publish({ ...this.identityOf(instance), state: "failed", error });
      return { status: "failed", error, runnerReceipt };
    }
    const receipt = persisted.receipt as GodotWorldPersistedReceipt | undefined;
    if (!receipt || !["craftmine.progress-receipt/1", "craftmine.godot-progress-receipt/1"].includes(receipt.format) || receipt.worldId !== instance.worldId || receipt.buildId !== instance.buildId ||
        !Number.isSafeInteger(receipt.revision) || receipt.revision < baseRevision || !/^[a-f0-9]{64}$/.test(receipt.contentHash ?? "")) {
      const error = "Host progress transaction returned no durable receipt";
      await instance.runtime.acknowledge({ failed: true, error }).catch(() => undefined);
      this.publish({ ...this.identityOf(instance), state: "failed", error });
      return { status: "failed", error, runnerReceipt };
    }
    await instance.runtime.acknowledge({ receipt }).catch(() => undefined);
    if (instance !== this.current) {
      // The world changed while the transaction was in flight: the receipt is
      // still valid for `instance`, but it must not overwrite the new world's
      // visible state.
      return { status: "persisted", runnerReceipt, receipt, snapshot: result.state ?? result.snapshot };
    }
    this.revision = receipt.revision;
    this.publish({ ...this.identityOf(instance), state: "saved" });
    return { status: "persisted", runnerReceipt, receipt, snapshot: result.state ?? result.snapshot };
  }

  async pause(): Promise<void> {
    const instance = this.current;
    if (!instance?.alive) return;
    this.pauseIntentRevision.set(instance, (this.pauseIntentRevision.get(instance) ?? 0) + 1);
    await this.pauseController.setManual(instance, true);
    if (instance === this.current) this.publish({ ...this.identityOf(instance), state: "paused" });
  }

  async resume(): Promise<void> {
    if (this.stagedRequest) throw new Error("GODOT_CANDIDATE_ACTIVE");
    const instance = this.current;
    if (!instance?.alive) return;
    this.frozen = null;
    this.pauseIntentRevision.set(instance, (this.pauseIntentRevision.get(instance) ?? 0) + 1);
    await this.pauseController.setManual(instance, false);
    if (instance === this.current) this.publish({ ...this.identityOf(instance), state: this.pauseController.paused(instance) ? "paused" : "ready" });
  }

  /** Freeze and durably save the current instance; successful checkpoints stay paused. */
  async checkpoint(options: {fresh?: boolean} = {}): Promise<GodotWorldSaveResult> {
    // Private lifecycle callers may require a new confirmation. Invalidate
    // the previous success before starting, so a failed refresh cannot later
    // be mistaken for that old successful checkpoint. Concurrent callers
    // still share the same in-flight freeze/save transaction.
    if (options.fresh === true) this.frozen = null;
    if (this.stagedRequest) return {status:"failed",error:"GODOT_CANDIDATE_ACTIVE"};
    const instance = this.current;
    if (!instance?.alive) return { status: "failed", error: "No world runtime is running" };
    if (this.frozen?.instance === instance) return this.frozen.result;
    if (this.checkpointPromise) return this.checkpointPromise;
    let previouslyPaused = this.pauseController.manualPaused(instance);
    let pauseAcknowledged = false;
    let checkpointIntent = 0;
    this.checkpointPromise = (async () => {
      try {
        // A snapshot already in flight may predate the freeze. Finish it, then
        // take a new snapshot after the pause acknowledgement.
        if (this.savePromise) await this.savePromise;
        if (this.current !== instance || !instance.alive) throw new Error("World changed during checkpoint");
        previouslyPaused = this.pauseController.manualPaused(instance);
        checkpointIntent = (this.pauseIntentRevision.get(instance) ?? 0) + 1;
        await this.pause();
        pauseAcknowledged = true;
        const saved = await this.save();
        if (saved.status !== "persisted") throw new Error(saved.error);
        if (this.current !== instance || !instance.alive) throw new Error("World changed during checkpoint");
        this.frozen = { instance, result: saved };
        this.publish({ ...this.identityOf(instance), state: "paused" });
        return saved;
      } catch (error) {
        if (this.current === instance && instance.alive && pauseAcknowledged && !previouslyPaused && this.pauseIntentRevision.get(instance) === checkpointIntent) await this.resume().catch(() => undefined);
        return { status: "failed" as const, error: String(error instanceof Error ? error.message : error) };
      }
    })().finally(() => { this.checkpointPromise = null; });
    return this.checkpointPromise;
  }

  /** Safe departure, including a switch back to the legacy runner. */
  async switchWorld(request: GodotWorldOpenRequest | null): Promise<GodotWorldState | null> {
    if (this.stagedRequest) throw new Error("GODOT_CANDIDATE_ACTIVE");
    if (request) return this.ensure(request);
    if (this.transitioning) throw new Error("WORLD_BUSY");
    this.transitioning = true;
    try {
      if (this.current?.alive) {
        const saved = await this.checkpoint();
        if (saved.status !== "persisted") throw new Error(saved.error);
      }
      await this.close();
      return this.currentState;
    } finally { this.transitioning = false; }
  }

  /** Snapshot and persist before the client exits; the world is kept on failure. */
  async prepareForQuit(): Promise<{ ok: boolean; error?: string }> {
    if (this.pending || this.stagedRequest) return {ok:false,error:"GODOT_CANDIDATE_ACTIVE"};
    const instance = this.current;
    if (!instance?.alive) return { ok: true };
    const saved = await this.checkpoint();
    if (saved.status !== "persisted") return { ok: false, error: saved.error };
    // The world may have been closed or replaced while the transaction ran;
    // only stop the instance this call actually saved.
    if (this.current === instance) await instance.runtime.exit().catch(() => undefined);
    return { ok: true };
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    const completion = this.closeInternal();
    this.closing = completion;
    void completion.finally(() => { if (this.closing === completion) this.closing = null; }).catch(() => undefined);
    return completion;
  }

  private async closeInternal(): Promise<void> {
    ++this.generation;
    this.stopPolling();
    const instance = this.current;
    const pending = this.pending;
    this.current = null;
    this.pending = null;
    this.stagedRequest = null;
    this.stagedCandidateId = null;
    this.candidateVisible = false;
    this.frozen = null;
    this.revision = null;
    const cleanup: Promise<void>[] = [];
    if (pending) {
      pending.alive = false;
      pending.detach();
      cleanup.push(this.retireInstance(pending, false));
    }
    if (!instance) {
      const results = await Promise.allSettled(cleanup);
      const failures = results.filter(result => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "GODOT_WORLD_CLOSE_INCOMPLETE: " + failures.map(result => String(result.reason)).join("; "));
      this.publishState({ state: "closed" });
      return;
    }
    instance.alive = false;
    instance.detach();
    try {
      if (!instance.view.webContents.isDestroyed()) instance.view.webContents.send(GODOT_WORLD_DETACH_CHANNEL);
    } catch {
      // The renderer may already be gone.
    }
    this.detachView(instance.view);
    cleanup.push(this.retireInstance(instance, true));
    const results = await Promise.allSettled(cleanup);
    const failures = results.filter(result => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "GODOT_WORLD_CLOSE_INCOMPLETE: " + failures.map(result => String(result.reason)).join("; "));
    this.publishState({ state: "closed" });
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.stopPolling();
    this.disposal = (async () => {
      // Close first so a startup waiting for readiness is cancelled by runtime
      // cleanup. Waiting for startup before close would deadlock that path.
      const closing = this.close();
      const startupDrain = this.starting.size ? new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("GODOT_STARTUP_CLOSE_TIMEOUT")), 10000);
        Promise.all([...this.starting]).then(() => { clearTimeout(timer); resolve(); });
      }) : Promise.resolve();
      const outcomes = await Promise.allSettled([closing, startupDrain]);
      if (outcomes[1].status === "rejected") throw outcomes[1].reason;
      // Instances can already be absent from current/pending while their
      // renderer or HTTP cleanup is still outstanding.
      while (this.retiring.size) await Promise.allSettled([...this.retiring]);
      if (this.retirementFailures.length) throw new Error("GODOT_RETIREMENT_INCOMPLETE: " + this.retirementFailures.join("; "));
      if (outcomes[0].status === "rejected") throw outcomes[0].reason;
    })();
    return this.disposal;
  }

  private trackRetirement(operation: () => Promise<void>): Promise<void> {
    const completion = Promise.resolve().then(operation);
    this.retiring.add(completion);
    void completion.then(() => this.retiring.delete(completion), error => {
      this.retiring.delete(completion);
      // Keep failure evidence after the instance is removed, with bounded text.
      this.retirementFailures.push(String(error).slice(0, 1000));
      if (this.retirementFailures.length > 64) this.retirementFailures.shift();
    });
    return completion;
  }

  private retireInstance(instance: LiveInstance, graceful: boolean): Promise<void> {
    this.pauseController.detach(instance);
    instance.retirement ??= this.trackRetirement(async () => {
      const results = await Promise.allSettled([this.closeView(instance), instance.runtime.dispose({graceful})]);
      const failures = results.filter(result => result.status === "rejected");
      if (failures.length) throw new Error(`GODOT_INSTANCE_CLOSE_INCOMPLETE ${instance.instanceId}: ` + failures.map(result => String(result.reason)).join("; "));
    });
    return instance.retirement;
  }

  /** Close a view at most once; `webContents.close()` is asynchronous. */
  private closeView(instance: LiveInstance): Promise<void> {
    if (instance.closePromise) return instance.closePromise;
    this.detachView(instance.view);
    instance.closed = true;
    const contents = instance.view.webContents;
    instance.closePromise = new Promise<void>((resolve, reject) => {
      if (contents.isDestroyed()) { resolve(); return; }
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        contents.removeListener("destroyed", done);
        reject(new Error("GODOT_RENDERER_CLOSE_TIMEOUT"));
      }, 3000);
      contents.once("destroyed", done);
      try { contents.close(); } catch (error) {
        clearTimeout(timer); contents.removeListener("destroyed", done);
        if (contents.isDestroyed()) resolve(); else reject(error);
      }
    });
    // Replacement/startup cleanup also records failure even when its caller is
    // already propagating a different startup error. Retirement tracks this promise.
    void instance.closePromise.catch(error => this.recordFault(instance, String(error)));
    return instance.closePromise;
  }

  private identityOf(instance: LiveInstance): { worldId: string; buildId: string; instanceId: string } {
    return { worldId: instance.worldId, buildId: instance.buildId, instanceId: instance.instanceId };
  }

  /** Keep the newest bounded fault list; a hostile page cannot grow it forever. */
  private recordFault(instance: LiveInstance, text: string): void {
    instance.faults.push(text.slice(0, 200));
    if (instance.faults.length > FAULT_KEEP) instance.faults.splice(0, instance.faults.length - FAULT_KEEP);
  }

  /**
   * Bounded evidence for the instance the caller names. It reports what the
   * renderer actually said; it never claims the view was visible or played.
   * Request paths are returned with the per-instance origin token redacted.
   */
  diagnostics(which: "formal" | "candidate" = "formal"): GodotWorldDiagnostics | null {
    const instance = which === "candidate" ? this.pending : this.current;
    if (!instance) return null;
    return {
      worldId: instance.worldId,
      buildId: instance.buildId,
      instanceId: instance.instanceId,
      alive: instance.alive,
      console: instance.consoleLog.map((entry) => ({ ...entry })),
      faults: instance.faults.slice(-FAULT_KEEP).map((entry) => entry.slice(0, 200)),
      requests: instance.runtime.requests.map((entry) => ({
        method: entry.method.slice(0, 16),
        path: redactRuntimePath(entry.url).slice(0, 300),
        status: entry.status,
      })),
    };
  }

  /** Compact, bounded cause summary appended to a failed startup. */
  private describeFailure(instance: LiveInstance): string {
    const parts: string[] = [];
    const fault = instance.faults[instance.faults.length - 1];
    if (fault) parts.push(`fault=${fault.slice(0, 160)}`);
    const errors = instance.consoleLog.filter((entry) => entry.level === "error");
    const line = errors[errors.length - 1] ?? instance.consoleLog[instance.consoleLog.length - 1];
    // Renderer console is page-controlled: strip control characters before it
    // can reach an error string that a panel renders.
    if (line) parts.push(`console[${line.level}]=${line.message.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200)}`);
    const requests = instance.runtime.requests;
    parts.push(`requests=${requests.filter((item) => item.status === 200).length}/${requests.length}`);
    const text = parts.join("; ").slice(0, DIAGNOSTIC_CHARS);
    return text ? ` [${text}]` : "";
  }

  private handleEvent(instance: LiveInstance, event: RuntimeEvent): void {
    if (instance !== this.current || !instance.alive) return;
    this.options.onEvent?.(event);
    if (event.type === "runtime-error") {
      this.pauseIntentRevision.set(instance, (this.pauseIntentRevision.get(instance) ?? 0) + 1);
      if (this.pauseController.has(instance)) void this.pauseController.setManual(instance, true).catch(() => undefined);
      this.publish({ ...this.identityOf(instance), state: "failed", error: event.error });
      return;
    }
    if (event.type === "exited") {
      instance.alive = false;
      this.pauseController.detach(instance);
      this.publish({ ...this.identityOf(instance), state: "closed" });
    }
  }

  /**
   * Report a failure for the instance the user is looking at. A fatal failure
   * (page load, renderer gone) also marks the instance unusable so the next
   * sync starts a fresh one instead of keeping a dead view on screen.
   */
  private fail(instance: LiveInstance, error: string, fatal = false): void {
    if (instance !== this.current && instance !== this.pending) return;
    if (fatal) { instance.alive = false; this.pauseController.detach(instance); }
    this.publish({ ...this.identityOf(instance), state: "failed", error });
  }

  private publish(state: GodotWorldState): GodotWorldState {
    this.currentState = state;
    this.onState?.(state);
    return state;
  }

  private publishState(patch: { state: GodotWorldState["state"]; error?: string }): void {
    const identity = this.current
      ? this.identityOf(this.current)
      : this.currentState
        ? { worldId: this.currentState.worldId, buildId: this.currentState.buildId, instanceId: this.currentState.instanceId }
        : { worldId: "", buildId: "", instanceId: "" };
    this.publish({ ...identity, ...patch });
  }

  private applyBounds(): void {
    const instance = this.candidateVisible && this.stagedRequest ? this.pending : this.current;
    const other = instance === this.current ? this.pending : this.current;
    if (other === this.pending && other?.alive) this.attachStagingView(other);
    else if (other) this.detachView(other.view);
    const window = this.options.window();
    if (!instance || !instance.alive || !window || window.isDestroyed()) return;
    setMainViewBackground(instance.view, false);
    if (!this.visible || !this.surfaceVisible) {
      this.detachView(instance.view);
      return;
    }
    // The candidate header is 46px and its persistent application explanation
    // reserves 100px in world.html. A sibling native view must not cover it.
    const rect = excludeImmersion(this.captureBounds ?? gameBounds(this.bounds, this.immersion.active ? 0 : this.candidateVisible ? WORLD_CHROME_HEIGHT + 146 : WORLD_CHROME_HEIGHT), this.immersion);
    if (rect.width < 1 || rect.height < 1) { this.detachView(instance.view); return; }
    const children = window.contentView.children;
    if (!children.includes(instance.view)) window.contentView.addChildView(instance.view);
    instance.view.setBounds(rect);
    raiseMainOverlay(window);
  }

  private detachView(view: WebContentsView): void {
    setMainViewBackground(view, false);
    const window = this.options.window();
    if (!window || window.isDestroyed()) return;
    const children = window.contentView.children;
    if (children.includes(view)) {
      window.contentView.removeChildView(view);
      syncMainInputFocus(window);
    }
  }

  private attachStagingView(instance: LiveInstance): void {
    const window = this.options.window();
    if (!instance.alive || instance.view.webContents.isDestroyed() || !window || window.isDestroyed()) return;
    setMainViewBackground(instance.view, true);
    if (!window.contentView.children.includes(instance.view)) window.contentView.addChildView(instance.view, 0);
    raiseMainOverlay(window);
  }

  private createView(runtime: WorldRuntime): WebContentsView {
    const ses = this.prepareSession(runtime.instanceId, runtime.origin);
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        offscreen: isOffscreenAcceptance(),
        backgroundThrottling: false,
        // Pending views are attached for frames, not eligible to take input.
        // Native layer ownership performs the later displayed-view handoff.
        focusOnNavigation: false,
        preload: join(__dirname, "../preload/godot-world.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        additionalArguments: [
          godotWorldScopeArgument({
            protocol: runtime.protocol,
            worldId: runtime.worldId,
            buildId: runtime.buildId,
            instanceId: runtime.instanceId,
          }),
        ],
      },
    });
    // WebGL must get a real viewport before load, even for detached staging.
    // Setting bounds neither attaches nor focuses the view.
    const initial = gameBounds(this.bounds);
    view.setBounds({...initial,width:initial.width || 640,height:initial.height || 360});
    // The runtime page is not a browser: no popups, no extra web contents.
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.ipc.on(GODOT_WORLD_MESSAGE_CHANNEL, (_event, message: unknown) => {
      const owner = this.current?.runtime === runtime ? this.current : this.pending?.runtime === runtime ? this.pending : null;
      if (owner) runtime.receive(message);
    });
    const displayed = (): boolean => {
      const owner = this.candidateVisible && this.stagedRequest ? this.pending : this.current;
      const window = this.options.window();
      return !this.disposed && this.visible && this.surfaceVisible &&
        !!owner?.alive && owner.runtime === runtime && owner.view === view &&
        !view.webContents.isDestroyed() && !!window && !window.isDestroyed() && window.contentView.children.includes(view);
    };
    const shortcut = (action: "toggle" | "exit"): void => {
      try { this.options.onFullscreenShortcut?.(action); }
      catch (error) {
        const owner = this.current?.runtime === runtime ? this.current : this.pending?.runtime === runtime ? this.pending : null;
        if (owner) this.recordFault(owner, `Fullscreen action failed: ${String(error)}`);
      }
    };
    view.webContents.on("before-input-event", (event, input) => {
      if (!displayed()) return;
      const action = this.immersion.active && !this.immersion.blocked ? immersionShortcut(input, this.immersion.overlay !== "closed") : null;
      if (action) { event.preventDefault(); this.options.onImmersionShortcut?.(action); return; }
      const decision = nativeFullscreenKeyDecision(input);
      if (decision.preventDefault) event.preventDefault();
      if (decision.action) shortcut(decision.action);
      if (!decision.preventDefault && immersionBlocksInput(this.immersion) && input.type !== "keyUp") event.preventDefault();
    });
    view.webContents.on("did-finish-load", () => {
      if (!view.webContents.isDestroyed()) {
        const blocked = immersionBlocksInput(this.immersion);
        view.webContents.send(IMMERSION_INPUT_CHANNEL, blocked);
        view.webContents.send(WORLD_CURSOR_CHANNEL, this.immersion.active && !blocked);
      }
    });
    view.webContents.ipc.on(GODOT_WORLD_FULLSCREEN_EXIT_CHANNEL, (event, payload: unknown) => {
      if (!displayed() || event.senderFrame !== view.webContents.mainFrame || !payload || typeof payload !== "object") return;
      const scope = payload as Record<string, unknown>;
      if (Object.keys(scope).length !== 4 || scope.protocol !== runtime.protocol || scope.worldId !== runtime.worldId ||
          scope.buildId !== runtime.buildId || scope.instanceId !== runtime.instanceId) return;
      shortcut("exit");
    });
    return view;
  }

  /**
   * One session per runtime instance. Each instance serves its own loopback
   * origin, and a shared partition would let a new instance inherit the
   * previous one's origin-scoped storage when the OS reuses the port; it would
   * also mean every new view re-registers the request filter, cancelling the
   * still-running world's own requests. Egress is confined to the instance's
   * origin and every permission, including pointer lock, is refused.
   */
  private prepareSession(instanceId: string, origin: string): Session {
    const ses = session.fromPartition(`pi-godot-world-${instanceId}`, { cache: true });
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      callback({ cancel: !details.url.startsWith(`${origin}/`) });
    });
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    return ses;
  }
}

/** Recognize build metadata only. Paths must come from the trusted artifact resolver. */
export function godotEngineOf(build: unknown): { kind: "godot-web"; buildId: string; threads: boolean } | null {
  if (!build || typeof build !== "object") return null;
  const document = build as Record<string, unknown>;
  const scene = document.scene as Record<string, unknown> | undefined;
  const godot = document.godot as Record<string, unknown> | undefined;
  if (scene?.format === "craftmine.godot-scene/1" && godot?.target === "web" && typeof document.id === "string" && ID_PATTERN.test(document.id)) {
    return { kind: "godot-web", buildId: document.id, threads: true };
  }
  // Legacy fixed fixtures may still declare engine metadata. Never forward
  // engine.root or engine.entry: source-authored strings are not host authority.
  const engine = document.engine as Record<string, unknown> | undefined;
  if (engine?.kind !== "godot-web" || typeof engine.buildId !== "string" || !ID_PATTERN.test(engine.buildId)) return null;
  return { kind: "godot-web", buildId: engine.buildId, threads: engine.threads !== false };
}
