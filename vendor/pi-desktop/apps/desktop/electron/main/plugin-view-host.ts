import { raiseMainOverlay, syncMainInputFocus } from "./main-window-layers";
import { session, shell, WebContentsView, type BaseWindow } from "electron";
import type { CraftmineImmersionState, CraftmineImmersionShortcut } from "@pi-desktop/shared";
import { NO_IMMERSION, IMMERSION_INPUT_CHANNEL, excludeImmersion, immersionShortcut, immersionBlocksInput } from "../../shared/craftmine-immersion";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OwnedViewClose } from "./owned-view-close";
import { nativeFullscreenKeyDecision } from "../../shared/world-fullscreen-shortcuts";
import { parseAllowedExternalUrl } from "./safe-open-external";
import { prepareWorldViewsForQuit } from "./craftmine-lifecycle";
import { isOffscreenAcceptance } from "./craftmine-headless";
import {
  applyPluginEgressPolicy,
  pluginSessionPartition,
  type PluginPanelBlockedRequest,
} from "./plugin-panel-host";
import {
  PLUGIN_PANEL_EMBEDDED_ARGUMENT,
  PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX,
  PLUGIN_WORLD_SHORTCUT_SCOPE_PREFIX,
  PLUGIN_WORLD_FULLSCREEN_EXIT_CHANNEL,
  type PluginPanelTheme,
} from "../shared/plugin-panel-chrome";

/**
 * Plugin-contributed work panel views (ADR 0104).
 *
 * A view is the same isolated web page as a `ui.panel` window — sandboxed
 * preload, per-plugin persisted partition, `net.domains` egress allowlist — but
 * composited inside the main window at a rect the renderer measures, exactly as
 * `BrowserPane` does for the preview browser. The renderer stays the visibility
 * authority: a `WebContentsView` always draws above renderer content, so it
 * must be hidden whenever the view is not the active panel surface or a
 * blocking overlay is open.
 *
 * Views are cached rather than destroyed on tab switch so a plugin keeps its
 * scroll position and in-page state, bounded by `MAX_LIVE_VIEWS` so a user who
 * browses many plugins does not accumulate renderer processes forever.
 */

/** Live views kept warm; the least recently shown one is evicted past this. */
const MAX_LIVE_VIEWS = 4;

export type PluginViewOpenRequest = {
  pluginId: string;
  viewId: string;
  locale: string;
  theme: PluginPanelTheme;
  /** Absolute path to the view's HTML entry. */
  htmlPath: string;
  /** Egress allowlist from `manifest.net.domains`. */
  netDomains?: readonly string[];
};

export type PluginViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LiveView = {
  key: string;
  pluginId: string;
  view: WebContentsView;
  /** Electron clears view.webContents on destruction; retain the owned handle. */
  contents?: Electron.WebContents;
  /** Monotonic counter; lowest value is the least recently shown. */
  usedAt: number;
};

export function pluginViewKey(pluginId: string, viewId: string): string {
  return `${pluginId}/${viewId}`;
}

export class PluginViewHost {
  private immersion = NO_IMMERSION;
  private requestedBounds: PluginViewBounds = { x:0, y:0, width:0, height:0 };
  onImmersionShortcut?: (action: CraftmineImmersionShortcut) => void;

  setImmersion(state: CraftmineImmersionState): void {
    this.immersion = state;
    this.setBounds(this.requestedBounds);
    const wc = this.headlessWorldContents();
    if (wc && !wc.isDestroyed()) wc.send(IMMERSION_INPUT_CHANNEL, immersionBlocksInput(state));
    if (wc && !wc.isDestroyed()) wc.send("pi-plugin-panel-event:craftmine-immersion", immersionBlocksInput(state));
    if (wc && !wc.isDestroyed()) wc.send("pi-plugin-panel-event:craftmine-presentation", {active: state.active, overlay: state.overlay});
  }
  private views = new Map<string, LiveView>();
  private disposed = false;
  private disposal: Promise<void> | null = null;
  private readonly retiring = new OwnedViewClose("PLUGIN_RENDERER");
  private window: BaseWindow | null = null;
  /** The one view currently attached to the window, if any. */
  private visibleKey: string | null = null;
  private bounds: PluginViewBounds = { x: 0, y: 0, width: 0, height: 0 };
  private clock = 0;
  private onBlockedRequest?: PluginPanelBlockedRequest;

  constructor(onBlockedRequest?: PluginPanelBlockedRequest) {
    this.onBlockedRequest = onBlockedRequest;
  }

  /** Main-owned window action, available only to the embedded Craftmine world. */
  onWorldFullscreenShortcut?: (action: "toggle" | "exit") => void;

  /**
   * Fired when the visible plugin view changes. The work-panel browser guest
   * clamps itself to this rect so it cannot cover chat/composer.
   */
  onSurface?: (
    surface: {
      pluginId: string;
      viewId: string;
      visible: boolean;
      bounds: PluginViewBounds;
    } | null,
  ) => void;

  /**
   * Push a one-way event to every live docked view. Detached panel windows
   * are broadcast separately by `PluginPanelHost`; both surfaces share the
   * preload channel `pi-plugin-panel-event:<event>`.
   */
  broadcast(event: string, payload: unknown): void {
    const channel = `pi-plugin-panel-event:${event}`;
    for (const entry of this.views.values()) {
      const wc = entry.view.webContents;
      if (wc.isDestroyed()) continue;
      wc.send(channel, payload);
    }
  }

  setWindow(window: BaseWindow | null): void {
    if (this.disposed) return;
    if (this.window === window) return;
    this.detachVisible();
    this.window = window;
  }

  /** Whether a live web contents exists for this view. */
  has(pluginId: string, viewId: string): boolean {
    return this.views.has(pluginViewKey(pluginId, viewId));
  }

  /** Read-only handle for the isolated native acceptance controller. */
  headlessWorldContents(): Electron.WebContents | null {
    return [...this.views.values()].find(entry => entry.pluginId === "craftmine.world")?.view.webContents || null;
  }

  /**
   * The plugin owning a web contents, so `PluginPanelHost` can accept bridge
   * calls from docked views on the same channel it serves panel windows.
   */
  pluginIdForSender(senderId: number): string | null {
    for (const entry of this.views.values()) {
      const wc = entry.view.webContents;
      if (!wc.isDestroyed() && wc.id === senderId) return entry.pluginId;
    }
    return null;
  }

  /**
   * Create the view if needed and mark it as the most recently used. Nothing is
   * attached here: the renderer follows with `setBounds` / `setVisible` once it
   * has measured the panel surface.
   */
  open(request: PluginViewOpenRequest): void {
    if (this.disposed) throw new Error("PLUGIN_VIEWS_DISPOSED");
    const key = pluginViewKey(request.pluginId, request.viewId);
    const existing = this.views.get(key);
    if (existing) {
      existing.usedAt = ++this.clock;
      return;
    }
    const view = this.createView(request);
    if (this.disposed) { void this.retiring.close(view.webContents, view); throw new Error("PLUGIN_VIEWS_DISPOSED"); }
    this.views.set(key, {
      key,
      pluginId: request.pluginId,
      view,
      contents: view.webContents,
      usedAt: ++this.clock,
    });
    void view.webContents
      .loadURL(pathToFileURL(request.htmlPath).toString())
      .catch(() => {
        // Load failures surface to the user as the tab's empty state; the view
        // stays cached so a plugin reload can retry into the same slot.
      });
    this.evictBeyondLimit();
  }

  setBounds(bounds: PluginViewBounds): void {
    if (this.disposed) return;
    this.requestedBounds = {
      x: Math.max(0, Math.round(Number(bounds.x) || 0)),
      y: Math.max(0, Math.round(Number(bounds.y) || 0)),
      width: Math.max(0, Math.round(Number(bounds.width) || 0)),
      height: Math.max(0, Math.round(Number(bounds.height) || 0)),
    };
    this.bounds = excludeImmersion(this.requestedBounds, this.immersion);
    const visible = this.visibleKey ? this.views.get(this.visibleKey) : null;
    visible?.view.setBounds(this.bounds);
    this.emitSurface();
  }

  /**
   * Show exactly one view, or none.
   *
   * Only one work panel surface is on screen at a time, so showing a view
   * implicitly detaches whichever was attached before. That keeps a stale view
   * from lingering above the renderer when the user switches tabs quickly.
   */
  setVisible(pluginId: string, viewId: string, visible: boolean): void {
    if (this.disposed) return;
    const key = pluginViewKey(pluginId, viewId);
    if (!visible) {
      if (this.visibleKey === key) this.detachVisible();
      return;
    }
    const entry = this.views.get(key);
    if (!entry) return;
    if (this.visibleKey && this.visibleKey !== key) this.detachVisible();
    entry.usedAt = ++this.clock;
    if (!this.window || this.window.isDestroyed()) return;
    const children = this.window.contentView.children;
    if (!children.includes(entry.view)) {
      this.window.contentView.addChildView(entry.view);
    }
    entry.view.setBounds(this.bounds);
    this.visibleKey = key;
    raiseMainOverlay(this.window);
    this.emitSurface();
  }

  async close(pluginId: string, viewId: string): Promise<void> {
    const entry = this.views.get(pluginViewKey(pluginId, viewId));
    if (entry) { entry.contents ??= entry.view.webContents; await this.prepareEntries([entry]); }
    if (entry) await this.destroy(entry.key, entry);
  }

  /** Drop every view a plugin owns — disable, uninstall, reload, or crash. */
  async closePlugin(pluginId: string): Promise<void> {
    const results = await Promise.allSettled([...this.views].filter(([, entry]) => entry.pluginId === pluginId).map(([key, entry]) => this.destroy(key, entry)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "PLUGIN_RENDERER_CLOSE_INCOMPLETE");
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.disposal = Promise.resolve().then(async () => {
      await Promise.allSettled([...this.views.keys()].map(key => this.destroy(key)));
      await this.retiring.drain();
    });
    return this.disposal;
  }

  async prepareCraftmineForQuit(): Promise<void> {
    await this.prepareEntries([...this.views.values()]);
  }

  /** Restore owns an in-flight panel request, so it must not await prepareClose. */
  async restoreCraftmine(phase: "begin" | "finish", request: Record<string, unknown>): Promise<unknown> {
    const entry = this.views.get(pluginViewKey("craftmine.world", "world"));
    if (!entry || entry.view.webContents.isDestroyed()) return {absent: true};
    const method = phase === "begin" ? "beginRestore" : "finishRestore";
    return entry.view.webContents.executeJavaScript(
      `globalThis.craftmineView.${method}(${JSON.stringify(request)})`, false,
    );
  }

  async navigateCraftmine(request: Record<string, unknown>): Promise<unknown> {
    const entry = this.views.get(pluginViewKey("craftmine.world", "world"));
    if (!entry) throw new Error("WORLD_VIEW_NOT_CREATED");
    if (entry.view.webContents.isDestroyed()) throw new Error("WORLD_VIEW_DESTROYED");
    const deadline = Date.now() + 15_000;
    while (!entry.view.webContents.isDestroyed()) {
      const ready = !entry.view.webContents.isLoading() && await entry.view.webContents.executeJavaScript(
        "typeof globalThis.craftmineView?.navigate === 'function' && (document.body.dataset.worldLoaded === 'true' || document.body.dataset.godot === 'true')", false).catch(() => false);
      if (ready) break;
      if (Date.now() >= deadline) throw new Error("WORLD_VIEW_START_TIMEOUT");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // JSON is a JavaScript value here, never shell text. The method is fixed and
    // the destination is the trusted product panel, never authored gameplay.
    return entry.view.webContents.executeJavaScript(
      `globalThis.craftmineView.navigate(${JSON.stringify(request)})`, false,
    );
  }

  /** Opens a panel surface (workbench tab, checks, world) without mutating a world. */
  async showCraftmineSurface(request: Record<string, unknown>): Promise<unknown> {
    const entry = this.views.get(pluginViewKey("craftmine.world", "world"));
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error("WORLD_VIEW_UNAVAILABLE");
    return entry.view.webContents.executeJavaScript(
      `globalThis.craftmineView.showSurface(${JSON.stringify(request)})`, false,
    );
  }

  /** Overlay controls use the same retained-page application transaction. */
  async previewCraftmineControl(request: Record<string, unknown>): Promise<unknown> {
    const entry = this.views.get(pluginViewKey("craftmine.world", "world"));
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error("WORLD_VIEW_UNAVAILABLE");
    // Fixed method on the trusted product page; authored game frames receive no
    // apply capability and no arbitrary script is accepted from the renderer.
    return entry.view.webContents.executeJavaScript(
      `globalThis.craftmineView.previewControl(${JSON.stringify(request)})`, false,
    );
  }

  /** Native directory grant, executed by the retained view that owns the permission. */
  async pickCraftmineDirectory(): Promise<unknown> {
    const entry = this.views.get(pluginViewKey("craftmine.world", "world"));
    if (!entry || entry.view.webContents.isDestroyed()) throw new Error("WORLD_VIEW_UNAVAILABLE");
    return entry.view.webContents.executeJavaScript("globalThis.craftmineView.pickDirectory()", false);
  }

  private async prepareEntries(entries: LiveView[]): Promise<void> {
    await prepareWorldViewsForQuit(entries.map((entry) => ({
      pluginId: entry.pluginId,
      prepare: () => entry.view.webContents.executeJavaScript("globalThis.craftmineView.prepareClose()", false),
      cancel: () => entry.view.webContents.executeJavaScript("globalThis.craftmineView.cancelClose()", false),
    })));
  }

  private destroy(key: string, expected?: LiveView): Promise<void> {
    const entry = expected ?? this.views.get(key);
    if (!entry) return Promise.resolve();
    if (this.views.get(key) === entry) {
      try { if (this.visibleKey === key) this.detachVisible(); }
      catch (error) { this.retiring.recordFailure(error); }
      this.views.delete(key);
    }
    const contents = entry.contents ??= entry.view.webContents;
    return this.retiring.close(contents, entry.view);
  }

  private detachVisible(): void {
    const entry = this.visibleKey ? this.views.get(this.visibleKey) : null;
    this.visibleKey = null;
    if (entry && this.window && !this.window.isDestroyed()) {
      const children = this.window.contentView.children;
      if (children.includes(entry.view)) {
        this.window.contentView.removeChildView(entry.view);
        syncMainInputFocus(this.window);
      }
    }
    this.emitSurface();
  }

  private emitSurface(): void {
    if (!this.onSurface) return;
    if (!this.visibleKey) {
      this.onSurface(null);
      return;
    }
    const separator = this.visibleKey.indexOf("/");
    if (separator <= 0) {
      this.onSurface(null);
      return;
    }
    this.onSurface({
      pluginId: this.visibleKey.slice(0, separator),
      viewId: this.visibleKey.slice(separator + 1),
      visible: true,
      bounds: this.bounds,
    });
  }

  /** Evict least-recently-shown views, never the one currently on screen. */
  private evictBeyondLimit(): void {
    while (this.views.size > MAX_LIVE_VIEWS) {
      const candidates = [...this.views.values()]
        .filter((entry) => entry.key !== this.visibleKey && entry.pluginId !== "craftmine.world")
        .sort((a, b) => a.usedAt - b.usedAt);
      const oldest = candidates[0];
      if (!oldest) return;
      void this.destroy(oldest.key);
    }
  }

  private createView(request: PluginViewOpenRequest): WebContentsView {
    const worldShortcutScope = request.pluginId === "craftmine.world" && request.viewId === "world" ? randomUUID() : null;
    const ses = session.fromPartition(pluginSessionPartition(request.pluginId), {
      cache: true,
    });
    applyPluginEgressPolicy(ses, {
      pluginId: request.pluginId,
      netDomains: request.netDomains,
      onBlockedRequest: this.onBlockedRequest,
    });

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        offscreen: isOffscreenAcceptance(),
        preload: join(__dirname, "../preload/plugin-panel.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        additionalArguments: [
          `${PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX}${encodeURIComponent(request.locale)}`,
          `--pi-plugin-panel-theme=${request.theme}`,
          PLUGIN_PANEL_EMBEDDED_ARGUMENT,
          ...(worldShortcutScope ? [PLUGIN_WORLD_SHORTCUT_SCOPE_PREFIX + worldShortcutScope] : []),
        ],
      },
    });

    const wc = view.webContents;
    if (worldShortcutScope) {
      const current = (): boolean => {
        const entry = this.views.get(pluginViewKey("craftmine.world", "world"));
        return this.visibleKey === entry?.key && entry?.view === view &&
          !wc.isDestroyed() && !!this.window && !this.window.isDestroyed() &&
          this.bounds.width > 0 && this.bounds.height > 0 && this.window.contentView.children.includes(view);
      };
      wc.on("before-input-event", (event, input) => {
        if (!current()) return;
        const action = this.immersion.active && !this.immersion.blocked ? immersionShortcut(input, this.immersion.overlay !== "closed") : null;
        if (action && action !== "escape") { event.preventDefault(); this.onImmersionShortcut?.(action); return; }
        const decision = nativeFullscreenKeyDecision(input);
        if (decision.preventDefault) event.preventDefault();
        if (decision.action) this.onWorldFullscreenShortcut?.(decision.action);
      });
      wc.on("did-finish-load", () => {
        if (!wc.isDestroyed()) wc.send(IMMERSION_INPUT_CHANNEL, immersionBlocksInput(this.immersion));
        if (!wc.isDestroyed()) wc.send("pi-plugin-panel-event:craftmine-immersion", immersionBlocksInput(this.immersion));
        if (!wc.isDestroyed()) wc.send("pi-plugin-panel-event:craftmine-presentation", {active: this.immersion.active, overlay: this.immersion.overlay});
      });
      wc.ipc.on(PLUGIN_WORLD_FULLSCREEN_EXIT_CHANNEL, (event, payload: unknown) => {
        if (!current() || event.senderFrame !== wc.mainFrame || !payload || typeof payload !== "object") return;
        const value = payload as Record<string, unknown>;
        if (Object.keys(value).length !== 1 || value.scope !== worldShortcutScope || this.immersion.blocked) return;
        // Preload has already allowed plugin menus, IME and pointer release to
        // consume Escape. Only then may the main renderer close its overlay.
        if (this.immersion.active && this.immersion.overlay !== "closed") this.onImmersionShortcut?.("escape");
        else this.onWorldFullscreenShortcut?.("exit");
      });
    }
    // A docked view gets exactly one web contents. `window.open` would mint a
    // chromeless window outside the egress policy applied above.
    wc.setWindowOpenHandler(({ url }) => {
      const allowed = parseAllowedExternalUrl(url);
      if (allowed) void shell.openExternal(allowed);
      return { action: "deny" };
    });
    return view;
  }
}
