import type { GodotWorldViewHost } from "./godot-world-view-host";
import type { createGodotRuntimeAdapter } from "./godot-runtime-adapter";

type Options = {
  host: GodotWorldViewHost;
  adapter: ReturnType<typeof createGodotRuntimeAdapter>;
  selection: () => Promise<string | null>;
  invoke: (channel: string, payload: Record<string, unknown>) => Promise<unknown>;
};
/** Authenticated panel actions may choose a world; they never supply runtime data or paths. */
export function createGodotPanelCoordinator(options: Options) {
  let switching = false;
  const requireCurrent = async (payload: Record<string, unknown>, fields: string[]) => {
    if (Object.keys(payload).some(key => !fields.includes(key))) throw new Error("INVALID_GODOT_PANEL_ACTION");
    const current = options.host.instance;
    if (!current || payload.worldId !== current.worldId || await options.selection() !== current.worldId) throw new Error("GODOT_WORLD_CHANGED");
    return current;
  };
  return {
    async invoke(channel: string, payload: Record<string, unknown> = {}): Promise<unknown> {
      if (channel === "godot.runtimeState") { await requireCurrent(payload, ["worldId"]); return options.host.state; }
      if (channel === "godot.runtimeSave") {
        await requireCurrent(payload, ["worldId", "freeze"]);
        if (switching || typeof payload.freeze !== "boolean") throw new Error("WORLD_BUSY");
        const result = payload.freeze ? await options.host.checkpoint() : await options.host.save();
        if (result.status !== "persisted") throw new Error(result.error);
        return result.receipt;
      }
      if (channel === "godot.runtimeResume") { if (switching) throw new Error("WORLD_BUSY"); await requireCurrent(payload, ["worldId"]); await options.host.resume(); return {ok:true}; }
      if (channel === "godot.runtimeSurface") {
        if (switching) throw new Error("WORLD_BUSY");
        await requireCurrent(payload, ["worldId", "visible"]);
        if (typeof payload.visible !== "boolean") throw new Error("INVALID_GODOT_PANEL_ACTION");
        options.host.setSurfaceVisible(payload.visible);
        if (payload.visible) await options.host.resume(); else await options.host.pause();
        return {ok:true};
      }
      if (channel !== "world.open") return options.invoke(channel, payload);
      if (switching || typeof payload.id !== "string" || Object.keys(payload).some(key => key !== "id")) throw new Error("WORLD_BUSY");
      switching = true;
      let previous: string | null = null;
      let release: (() => void) | undefined;
      try {
        release = await options.host.holdSelectionSync();
        previous = await options.selection();
        // The descriptor resolves only a verified applied artifact; errors are
        // not a legacy fallback and do not change the saved selection.
        const next = await options.adapter.describe(payload.id);
        await options.host.switchWorld(next);
        const result = await options.invoke("world.open", {id:payload.id});
        options.host.setSurfaceVisible(true);
        return result;
      } catch (error) {
        // A lost selection reply can mean the new selection was committed.
        // Never run a view whose identity is uncertain relative to the panel.
        let recoveryError: unknown;
        try {
          const actual = await options.selection();
          if (actual !== previous) throw new Error("GODOT_SELECTION_CHANGED_DURING_FAILED_OPEN");
          if (options.host.instance?.worldId !== previous) {
            await options.host.switchWorld(previous ? await options.adapter.describe(previous) : null);
          }
          await options.host.resume();
        } catch (failure) {
          recoveryError = failure;
          options.host.setSurfaceVisible(false);
          await options.host.pause().catch(() => undefined);
        }
        if (recoveryError) throw new Error(`${String(error)}; world recovery failed: ${String(recoveryError)}. Runtime hidden and paused; reopen the world to retry.`);
        throw error;
      } finally { release?.(); switching = false; }
    },
  };
}
