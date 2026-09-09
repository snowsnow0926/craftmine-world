import type { GodotWorldViewHost } from "./godot-world-view-host";
import type { createGodotRuntimeAdapter } from "./godot-runtime-adapter";
import type { createGodotWorldFactory } from "./godot-world-creation";

type Options = {
  host: GodotWorldViewHost;
  adapter: ReturnType<typeof createGodotRuntimeAdapter>;
  selection: () => Promise<string | null>;
  invoke: (channel: string, payload: Record<string, unknown>) => Promise<unknown>;
  /** Client-side Godot creation. Absent only in tests that never create worlds. */
  creation?: (() => ReturnType<typeof createGodotWorldFactory> | null) | null;
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
  const legacyCreateOptions = async (): Promise<Record<string, unknown>> => {
    const value = await options.invoke("world.createOptions", {}).catch(() => ({}));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  };
  const currentCreation = () => options.creation?.() ?? null;
  /** The legacy base stays available; the Godot bases come from the catalog. */
  const mergedCreateOptions = async (): Promise<Record<string, unknown>> => {
    const legacy = await legacyCreateOptions();
    const creation = currentCreation();
    if (!creation) return legacy;
    const legacyBases = Array.isArray(legacy.bases) ? legacy.bases as Array<Record<string, unknown>> : [];
    return {
      ...legacy,
      create: true,
      createActions: true,
      bases: [
        ...legacyBases,
        ...creation.options.bases.map(base => ({
          id: base.id, label: base.label, description: base.description, delivered: base.delivered,
          starters: base.templates.map(template => ({
            id: template.id, label: template.label, description: template.description, delivered: template.delivered,
          })),
        })),
      ],
      starters: [
        ...(Array.isArray(legacy.starters) ? legacy.starters : []),
        ...(creation.options.bases[0]?.templates ?? []).map(template => ({
          id: template.id, label: template.label, description: template.description, delivered: template.delivered,
        })),
      ],
    };
  };
  /** Adds the core's real initialization state to every Godot world row. */
  const augmentWorldList = async (result: unknown): Promise<unknown> => {
    const creation = currentCreation();
    if (!creation || !result || typeof result !== "object" || Array.isArray(result)) return result;
    const list = result as {worlds?: Array<Record<string, unknown>>; activeWorldId?: string | null};
    if (!Array.isArray(list.worlds)) return result;
    const worlds = await Promise.all(list.worlds.slice(0, 64).map(async world => {
      if (world?.runtimeKind !== "godot" || typeof world.id !== "string") return world;
      const status = await creation.status(world.id);
      if (!status) return world;
      return {...world, state: status.state, creation: status.creation};
    }));
    return {...list, worlds: [...worlds, ...list.worlds.slice(64)]};
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
      if (channel === "world.createOptions") return mergedCreateOptions();
      if (channel === "world.list") return augmentWorldList(await options.invoke(channel, payload));
      if (channel === "world.create") {
        const creation = currentCreation();
        const baseId = typeof payload.baseId === "string" ? payload.baseId : "";
        // A Godot base is created here; every other base keeps the legacy path.
        if (creation && creation.options.bases.some(base => base.id === baseId)) return creation.create(payload);
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
