import { contextBridge, ipcRenderer } from "electron";
import { installHeadlessInputGuard } from "../shared/craftmine-headless-input";
import {
  GODOT_WORLD_DETACH_CHANNEL,
  GODOT_WORLD_MESSAGE_CHANNEL,
  parseGodotWorldScopeArgument,
} from "../shared/godot-world-chrome";

/**
 * Transport for the isolated Godot build-check runtime page.
 *
 * The page is a sandboxed, context-isolated document on its own loopback
 * origin. It exposes exactly one object, with no filesystem, no plugin bridge
 * and no arbitrary IPC: the instance scope is fixed by the host before the
 * document loads, and every outbound message goes through one channel the host
 * re-validates. The headless input guard is installed in the main world before
 * any application or engine script, so the check cannot steal focus or request
 * pointer lock.
 */

const WIRE_LIMIT = 8 * 1024 * 1024;
const INSTALLED_MARKER = "__craftmineGodotCheckPreload";

/**
 * Reports uncaught page-script failures as `runtime-error` frames.
 *
 * The engine bridge already reports Godot's own `onPrintError` output. An
 * arbitrary exception thrown by authored game script (or a rejected promise it
 * leaves behind) never reaches that path, so the isolated check would otherwise
 * call a page "error free" while it is visibly broken. The hook is installed in
 * the main world at document start, before any engine or application script.
 */
function installGameErrorHooks(): void {
  const transport = (globalThis as unknown as {
    craftmineRuntime?: { scope?: unknown; post?: (message: unknown) => void };
  }).craftmineRuntime;
  if (typeof transport?.post !== "function" || !transport.scope) return;
  const report = (detail: string): void => {
    try { transport.post!({ ...(transport.scope as object), type: "runtime-error", error: detail.slice(0, 2000) }); }
    catch { /* the transport is detached; nothing to report to */ }
  };
  globalThis.addEventListener("error", (event: ErrorEvent) => {
    // Resource load failures surface here without a message; the console
    // channel already reports those, so only real script failures are sent.
    if (typeof event?.message !== "string" || !event.message) return;
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    report(`uncaught-error: ${event.message}${where}`);
  }, true);
  globalThis.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event?.reason;
    report(`unhandled-rejection: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)}`);
  });
}

const scope = process.argv
  .map(parseGodotWorldScopeArgument)
  .find((value): value is NonNullable<typeof value> => value !== null);

// The host registers this preload both as the window preload and as a
// frame-scoped preload so subframes are covered by the same guard. Electron can
// execute it twice in one frame, and `exposeInMainWorld` refuses to rebind an
// existing key, so the transport is installed once per isolated world.
const marker = globalThis as unknown as Record<string, unknown>;

if (scope && marker[INSTALLED_MARKER] !== true) {
  marker[INSTALLED_MARKER] = true;
  contextBridge.executeInMainWorld({ func: installHeadlessInputGuard });
  contextBridge.exposeInMainWorld("craftmineRuntime", {
    scope,
    post(message: unknown) {
      try {
        if (new TextEncoder().encode(JSON.stringify(message)).byteLength > WIRE_LIMIT) throw new Error("wire limit");
      } catch {
        const id = (message as { id?: unknown } | null)?.id;
        ipcRenderer.send(GODOT_WORLD_MESSAGE_CHANNEL, { ...scope,
          type: Number.isSafeInteger(id) ? "response" : "runtime-error", id,
          error: "Invalid or oversized runtime message",
        });
        return;
      }
      ipcRenderer.send(GODOT_WORLD_MESSAGE_CHANNEL, message);
    },
    on(handler: (message: unknown) => void) {
      const listener = (_event: unknown, message: unknown) => handler(message);
      ipcRenderer.on(GODOT_WORLD_MESSAGE_CHANNEL, listener);
      return () => ipcRenderer.removeListener(GODOT_WORLD_MESSAGE_CHANNEL, listener);
    },
    onDetach(handler: () => void) {
      const listener = () => handler();
      ipcRenderer.on(GODOT_WORLD_DETACH_CHANNEL, listener);
      return () => ipcRenderer.removeListener(GODOT_WORLD_DETACH_CHANNEL, listener);
    },
  });
  // Installed after the transport exists and still at document start, so an
  // exception thrown by the first application script is reported.
  contextBridge.executeInMainWorld({ func: installGameErrorHooks });
}
