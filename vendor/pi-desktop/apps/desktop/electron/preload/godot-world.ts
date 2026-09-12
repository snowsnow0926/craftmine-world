import { contextBridge, ipcRenderer } from "electron";
import { attachImmersionInput, IMMERSION_INPUT_CHANNEL } from "../../shared/craftmine-immersion";
import {
  GODOT_WORLD_DETACH_CHANNEL,
  GODOT_WORLD_FULLSCREEN_EXIT_CHANNEL,
  GODOT_WORLD_MESSAGE_CHANNEL,
  parseGodotWorldScopeArgument,
} from "../shared/godot-world-chrome";
import { attachFullscreenEscape } from "../../shared/world-fullscreen-shortcuts";
import { attachWorldCursor, WORLD_CURSOR_CHANNEL } from "../../shared/world-cursor-presentation";

/**
 * Transport for the Godot world runtime page (`craftmine.godot-runtime/2`).
 *
 * The page is a sandboxed, context-isolated top-level document on a loopback
 * origin. It exposes exactly one object, with no filesystem, no plugin bridge
 * and no arbitrary IPC: the instance scope is fixed by the host before the
 * document loads, and every outbound message goes through one channel the host
 * re-validates.
 */
const scope = process.argv
  .map(parseGodotWorldScopeArgument)
  .find((value): value is NonNullable<typeof value> => value !== null);

if (scope) {
  const disposeCursor = attachWorldCursor(window, listener => {
    const wrapped = (_event: unknown, hide: boolean) => listener(hide);
    ipcRenderer.on(WORLD_CURSOR_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(WORLD_CURSOR_CHANNEL, wrapped);
  });
  ipcRenderer.once(GODOT_WORLD_DETACH_CHANNEL, disposeCursor);
  window.addEventListener("pagehide", disposeCursor, {once: true});
  const disposeInput = attachImmersionInput(window, listener => {
    const wrapped = (_event: unknown, blocked: boolean) => listener(blocked);
    ipcRenderer.on(IMMERSION_INPUT_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(IMMERSION_INPUT_CHANNEL, wrapped);
  });
  ipcRenderer.once(GODOT_WORLD_DETACH_CHANNEL, disposeInput);
  window.addEventListener("pagehide", disposeInput, {once:true});
  const disposeEscape = attachFullscreenEscape(window, {
    onExit: () => { ipcRenderer.send(GODOT_WORLD_FULLSCREEN_EXIT_CHANNEL, scope); },
  });
  ipcRenderer.once(GODOT_WORLD_DETACH_CHANNEL, disposeEscape);
  window.addEventListener("pagehide", disposeEscape, {once: true});
  contextBridge.exposeInMainWorld("craftmineRuntime", {
    scope,
    post(message: unknown) {
      try {
        if (new TextEncoder().encode(JSON.stringify(message)).byteLength > 8 * 1024 * 1024) throw new Error("wire limit");
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
}
