import { contextBridge, ipcRenderer } from "electron";
import {
  GODOT_WORLD_DETACH_CHANNEL,
  GODOT_WORLD_MESSAGE_CHANNEL,
  parseGodotWorldScopeArgument,
} from "../shared/godot-world-chrome";

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
  contextBridge.exposeInMainWorld("craftmineRuntime", {
    scope,
    post(message: unknown) {
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
