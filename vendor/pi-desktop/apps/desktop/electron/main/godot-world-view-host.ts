import { BrowserWindow, WebContentsView, session, type Session } from "electron";
import { join, resolve, sep } from "node:path";
import {
  createWorldRuntime,
  WORLD_CHROME_HEIGHT,
  type RuntimeEvent,
  type WorldRuntime,
} from "../../../../../../desktop/godot/web/runtime.mjs";
import { isHeadlessAcceptance } from "./craftmine-headless";
import {
  GODOT_WORLD_DETACH_CHANNEL,
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
 * world or build always replaces the instance: the previous runtime is disposed
 * first, and its late messages are dropped by the protocol layer, so a stale
 * page can never write into the new world.
 */

export type GodotWorldBounds = { x: number; y: number; width: number; height: number };

export type GodotWorldOpenRequest = {
  worldId: string;
  buildId: string;
  /** Absolute path to the built Web export directory. */
  root: string;
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
};

export type GodotWorldSaveResult =
  | { status: "persisted"; runnerReceipt: Record<string, unknown>; receipt: GodotWorldPersistedReceipt }
  | { status: "failed"; error: string; runnerReceipt?: Record<string, unknown> };

/** How often the active world descriptor is re-read while the panel is visible. */
const SYNC_INTERVAL_MS = 2000;
const ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

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
export function gameBounds(bounds: GodotWorldBounds, chromeHeight = WORLD_CHROME_HEIGHT): GodotWorldBounds {
  const x = Math.max(0, Math.round(Number(bounds.x) || 0));
  const y = Math.max(0, Math.round(Number(bounds.y) || 0));
  const width = Math.max(0, Math.round(Number(bounds.width) || 0));
  const height = Math.max(0, Math.round(Number(bounds.height) || 0));
  const top = Math.min(height, Math.max(0, Math.round(chromeHeight)));
  return { x, y: y + top, width, height: Math.max(0, height - top) };
}

type LiveInstance = {
  runtime: WorldRuntime;
  view: WebContentsView;
  worldId: string;
  buildId: string;
  instanceId: string;
  detach: () => void;
  alive: boolean;
  /** The web contents were already closed; closing twice must be a no-op. */
  closed: boolean;
};

export class GodotWorldViewHost {
  private current: LiveInstance | null = null;
  /** Replacement instance that has not finished starting yet. */
  private pending: LiveInstance | null = null;
  private bounds: GodotWorldBounds = { x: 0, y: 0, width: 0, height: 0 };
  private visible = false;
  private currentState: GodotWorldState | null = null;
  private revision = 0;
  private syncing = false;
  private syncPromise: Promise<GodotWorldState | null> = Promise.resolve(null);
  private lastSync = 0;
  private poll?: ReturnType<typeof setInterval>;
  private disposed = false;
  private onState?: (state: GodotWorldState) => void;

  constructor(
    private readonly options: {
      /** The window the game view is composited into. */
      window: () => BrowserWindow | null;
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
      /** Test seam: called with every runtime event. */
      onEvent?: (event: RuntimeEvent) => void;
    },
  ) {
    this.onState = options.onState;
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

  async ensure(request: GodotWorldOpenRequest): Promise<GodotWorldState> {
    if (this.disposed) throw new Error("Godot world host is disposed");
    if (this.pending) throw new Error("A world instance is already starting");
    const worldId = requireId("world identity", request.worldId);
    const buildId = requireId("build identity", request.buildId);
    const allowed = this.options.allowedRoots?.() ?? [];
    const root = resolve(request.root ?? "");
    if (!isInsideAllowedRoot(root, allowed)) {
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
    // Transactional switch: the replacement runtime must reach ready before the
    // running world is stopped, so a broken candidate build cannot take the
    // player's current world (and its confirmed progress) down with it.
    const previous = this.current;
    const runtime = await createWorldRuntime({
      worldId,
      buildId,
      root,
      entry: request.entry,
      threads: request.threads,
      timeoutMs: request.timeoutMs,
    });
    let view: WebContentsView;
    try {
      view = this.createView(runtime);
    } catch (error) {
      // A view that cannot be created must not leave a listening server behind.
      await runtime.dispose({ graceful: false }).catch(() => undefined);
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
    };
    this.pending = instance;
    instance.detach = runtime.attach((message) => {
      if (!instance.alive || instance.view.webContents.isDestroyed()) return;
      instance.view.webContents.send(GODOT_WORLD_MESSAGE_CHANNEL, message);
    });
    view.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame) return;
      if (instance !== this.current && instance !== this.pending) return;
      this.fail(instance, `World view failed to load (${code} ${description})`, true);
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      if (instance !== this.current && instance !== this.pending) return;
      this.fail(instance, `World renderer stopped: ${details.reason}`, true);
    });
    try {
      await view.webContents.loadURL(runtime.url);
      await runtime.waitReady();
      if (request.build !== undefined || request.snapshot !== undefined) {
        const loaded = await runtime.load({ build: request.build ?? null, snapshot: request.snapshot ?? null });
        if (loaded.error) throw new Error(loaded.error);
      }
    } catch (error) {
      this.pending = null;
      instance.alive = false;
      instance.detach();
      this.closeView(instance);
      await runtime.dispose({ graceful: false }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      if (previous?.alive) {
        // The running world is untouched: report its own identity, not the
        // candidate that failed.
        this.publish({ ...this.identityOf(previous), state: this.currentState?.state === "paused" ? "paused" : "ready", error: message });
      } else {
        this.publish({ worldId, buildId, instanceId: "", state: "failed", error: message });
      }
      throw new Error(`${message}${previous?.alive ? " (previous world kept running)" : ""}`);
    }
    this.pending = null;
    this.current = instance;
    this.revision = 0;
    runtime.onEvent((event) => this.handleEvent(instance, event));
    view.webContents.once("did-finish-load", () => {
      if (!instance.alive) return;
      this.applyBounds();
    });
    this.publish({ worldId, buildId, instanceId: runtime.instanceId, state: "ready" });
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
      this.closeView(previous);
      await previous.runtime.dispose({ graceful: true }).catch(() => undefined);
    }
    return this.currentState!;
  }

  /** Current world state as the runtime reports it; used by the progress transaction. */
  async snapshot(): Promise<Record<string, unknown> | null> {
    const instance = this.current;
    if (!instance?.alive) return null;
    const response = await instance.runtime.snapshot().catch(() => null);
    return (response?.result ?? null) as Record<string, unknown> | null;
  }

  /** Forward one runtime operation; the base owns everything but the core ops. */
  async request(op: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
    const instance = this.current;
    if (!instance?.alive) throw new Error("No world runtime is running");
    const response = await instance.runtime.request(op, args);
    if (response.error) throw new Error(response.error);
    return (response.result ?? null) as Record<string, unknown> | null;
  }

  /**
   * Bring the host in line with the active world: start it, reuse it, or stop
   * it when the panel no longer shows a Godot world. Idempotent and safe to
   * call from every bounds/visibility update; the descriptor round-trip is
   * throttled so a resize drag cannot hammer the plugin process.
   */
  async sync({ force = false }: { force?: boolean } = {}): Promise<GodotWorldState | null> {
    if (this.disposed) return this.currentState;
    if (!this.options.descriptor) return this.currentState;
    if (this.syncing) return this.syncPromise;
    const now = Date.now();
    if (!force && now - this.lastSync < SYNC_INTERVAL_MS) return this.currentState;
    this.lastSync = now;
    this.syncing = true;
    this.syncPromise = (async () => {
      const request = await this.options.descriptor!().catch(() => null);
      if (!request) {
        await this.close();
        return this.currentState;
      }
      if (this.current && this.current.alive && this.current.worldId === request.worldId && this.current.buildId === request.buildId) {
        return this.currentState;
      }
      return this.ensure(request).catch((error) => {
        // A world that cannot start must not take the panel down with it.
        this.publish({ worldId: request.worldId, buildId: request.buildId, instanceId: "", state: "failed", error: String(error?.message ?? error) });
        return this.currentState;
      });
    })().finally(() => {
      this.syncing = false;
    });
    return this.syncPromise;
  }

  setBounds(bounds: GodotWorldBounds): void {
    this.bounds = bounds;
    this.applyBounds();
    void this.sync();
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
  async save({ revision }: { revision?: number } = {}): Promise<GodotWorldSaveResult> {
    const instance = this.current;
    if (!instance || !instance.alive) return { status: "failed", error: "No world runtime is running" };
    // The revision advances only after the host transaction committed; using
    // the caller's value for this call keeps a failed save from poisoning the
    // base revision of the next attempt.
    const baseRevision = revision ?? this.revision;
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
    if ("failed" in persisted) {
      await instance.runtime.acknowledge({ failed: true, error: persisted.error }).catch(() => undefined);
      this.publish({ ...this.identityOf(instance), state: "failed", error: persisted.error });
      return { status: "failed", error: persisted.error, runnerReceipt };
    }
    const receipt = persisted.receipt as GodotWorldPersistedReceipt | undefined;
    if (!receipt || typeof receipt !== "object" || typeof receipt.revision !== "number") {
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
      return { status: "persisted", runnerReceipt, receipt };
    }
    this.revision = receipt.revision;
    this.publish({ ...this.identityOf(instance), state: "saved" });
    return { status: "persisted", runnerReceipt, receipt };
  }

  async pause(): Promise<void> {
    const instance = this.current;
    if (!instance?.alive) return;
    await instance.runtime.pause().catch(() => undefined);
    this.publish({ ...this.identityOf(instance), state: "paused" });
  }

  async resume(): Promise<void> {
    const instance = this.current;
    if (!instance?.alive) return;
    await instance.runtime.resume().catch(() => undefined);
    this.publish({ ...this.identityOf(instance), state: "ready" });
  }

  /** Snapshot and persist before the client exits; the world is kept on failure. */
  async prepareForQuit(): Promise<{ ok: boolean; error?: string }> {
    const instance = this.current;
    if (!instance?.alive) return { ok: true };
    const saved = await this.save();
    if (saved.status !== "persisted") return { ok: false, error: saved.error };
    // The world may have been closed or replaced while the transaction ran;
    // only stop the instance this call actually saved.
    if (this.current === instance) await instance.runtime.exit().catch(() => undefined);
    return { ok: true };
  }

  async close(): Promise<void> {
    this.stopPolling();
    const instance = this.current;
    const pending = this.pending;
    this.current = null;
    this.pending = null;
    if (pending) {
      pending.alive = false;
      pending.detach();
      this.closeView(pending);
      await pending.runtime.dispose({ graceful: false }).catch(() => undefined);
    }
    if (!instance) {
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
    this.closeView(instance);
    await instance.runtime.dispose({ graceful: true }).catch(() => undefined);
    this.publishState({ state: "closed" });
  }

  dispose(): void {
    this.disposed = true;
    this.stopPolling();
    void this.close().catch(() => undefined);
  }

  /** Close a view at most once; `webContents.close()` is asynchronous. */
  private closeView(instance: LiveInstance): void {
    if (instance.closed) return;
    instance.closed = true;
    try {
      if (!instance.view.webContents.isDestroyed()) instance.view.webContents.close();
    } catch {
      // The renderer may already be gone.
    }
  }

  private identityOf(instance: LiveInstance): { worldId: string; buildId: string; instanceId: string } {
    return { worldId: instance.worldId, buildId: instance.buildId, instanceId: instance.instanceId };
  }

  private handleEvent(instance: LiveInstance, event: RuntimeEvent): void {
    if (instance !== this.current || !instance.alive) return;
    this.options.onEvent?.(event);
    if (event.type === "runtime-error") {
      this.publish({ ...this.identityOf(instance), state: "failed", error: event.error });
      return;
    }
    if (event.type === "exited") {
      instance.alive = false;
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
    if (fatal) instance.alive = false;
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
    const instance = this.current;
    const window = this.options.window();
    if (!instance || !instance.alive || !window || window.isDestroyed()) return;
    if (!this.visible) {
      this.detachView(instance.view);
      return;
    }
    const children = window.contentView.children;
    if (!children.includes(instance.view)) window.contentView.addChildView(instance.view);
    instance.view.setBounds(gameBounds(this.bounds));
  }

  private detachView(view: WebContentsView): void {
    const window = this.options.window();
    if (!window || window.isDestroyed()) return;
    const children = window.contentView.children;
    if (children.includes(view)) window.contentView.removeChildView(view);
  }

  private createView(runtime: WorldRuntime): WebContentsView {
    const ses = this.prepareSession(runtime.instanceId, runtime.origin);
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        offscreen: isHeadlessAcceptance(),
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
    // The runtime page is not a browser: no popups, no extra web contents.
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.ipc.on(GODOT_WORLD_MESSAGE_CHANNEL, (_event, message: unknown) => {
      const owner = this.current?.runtime === runtime ? this.current : this.pending?.runtime === runtime ? this.pending : null;
      if (owner) runtime.receive(message);
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

/** True when a world document declares a Godot Web build this host can run. */
export function godotEngineOf(
  build: unknown,
): { kind: string; root?: string; buildId?: string; entry?: string; threads?: boolean } | null {
  if (!build || typeof build !== "object") return null;
  const engine = (build as Record<string, unknown>).engine;
  if (!engine || typeof engine !== "object") return null;
  const record = engine as Record<string, unknown>;
  if (record.kind !== "godot-web") return null;
  return {
    kind: "godot-web",
    root: typeof record.root === "string" ? record.root : undefined,
    buildId: typeof record.buildId === "string" ? record.buildId : undefined,
    entry: typeof record.entry === "string" ? record.entry : undefined,
    threads: record.threads !== false,
  };
}
