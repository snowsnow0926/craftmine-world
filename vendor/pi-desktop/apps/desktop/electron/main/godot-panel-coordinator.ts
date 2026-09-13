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
  resumeRestored?: (worldId: string) => Promise<void>;
  /** Host-owned exact-source compatibility work; never accepts player patches. */
  compatibility?: {
    required: (worldId: string) => Promise<boolean>;
    apply: (worldId: string) => Promise<{status: string; reason?: string}>;
  };
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
        ...legacyBases.map(base => ({...base, starters: Array.isArray(base.starters) ? base.starters : (Array.isArray(legacy.starters) ? legacy.starters : [])})),
        ...creation.options.bases.map(base => ({
          id: base.id, label: base.label, description: base.description, delivered: base.delivered,
          starters: base.templates.map(template => ({
            id: template.id, label: template.label, description: template.description, delivered: template.delivered,
            kind: template.kind, preview: template.preview, source: template.source, initialState: template.initialState,
          })),
        })),
      ],
      starters: [
        ...(Array.isArray(legacy.starters) ? legacy.starters : []),
        ...(creation.options.bases[0]?.templates ?? []).map(template => ({
          id: template.id, label: template.label, description: template.description, delivered: template.delivered,
          kind: template.kind, source: template.source, initialState: template.initialState,
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
      const status = await creation.status(world.id, {resume: false});
      if (!status) return world;
      return {...world, state: status.state, creation: status.creation};
    }));
    return {...list, worlds: [...worlds, ...list.worlds.slice(64)]};
  };
  return {
    async invoke(channel: string, payload: Record<string, unknown> = {}): Promise<unknown> {
      if (channel === "godot.runtimeState") {
        if (Object.keys(payload).some(key => key !== "worldId") || typeof payload.worldId !== "string") throw Error("INVALID_GODOT_PANEL_ACTION");
        if (!options.host.instance && await options.selection() === payload.worldId) {
          const initialization = await currentCreation()?.status(payload.worldId);
          if (initialization && initialization.state !== "ready") return {worldId: payload.worldId, state: "loading", initializing: true};
          if (options.host.state?.worldId === payload.worldId && options.host.state.state === "failed") return options.host.state;
        }
        await requireCurrent(payload, ["worldId"]); return options.host.state;
      }
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
      if (channel === "world.creationCancel") {
        if (typeof payload.worldId !== "string" || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(payload.worldId) || Object.keys(payload).some(key => key !== "worldId")) throw Error("INVALID_GODOT_PANEL_ACTION");
        const creation = currentCreation();if (!creation) throw Error("GODOT_BASES_UNAVAILABLE");
        return creation.cancel(payload.worldId);
      }
      if (channel === "world.creationRetry") {
        if (typeof payload.worldId !== "string" || Object.keys(payload).some(key => key !== "worldId")) throw Error("INVALID_GODOT_PANEL_ACTION");
        if (switching || await options.selection()!==payload.worldId) throw Error("GODOT_WORLD_CHANGED");
        const creation=currentCreation();if(!creation)throw Error("GODOT_BASES_UNAVAILABLE");
        void creation.retry(payload.worldId);
        return {status: "running", worldId: payload.worldId};
      }
      if (channel === "world.create") {
        const creation = currentCreation();
        const baseId = typeof payload.baseId === "string" ? payload.baseId : "";
        // A Godot base is created here; every other base keeps the legacy path.
        if (creation && creation.options.bases.some(base => base.id === baseId)) {
          if (switching) throw Error("WORLD_BUSY");
          switching = true;
          let release: (() => void) | undefined;
          try {
            release = await options.host.holdSelectionSync();
            const result = await creation.create(payload);
            await options.host.switchWorld(null);
            await options.invoke("world.open", {id: result.id});
            return result;
          } finally { release?.(); switching = false; }
        }
      }
      if (channel !== "world.open") return options.invoke(channel, payload);
      if (switching || typeof payload.id !== "string" || Object.keys(payload).some(key => key !== "id")) throw new Error("WORLD_BUSY");
      switching = true;
      let previous: string | null = null;
      let compatibilitySelection = false;
      let release: (() => void) | undefined;
      try {
        release = await options.host.holdSelectionSync();
        previous = await options.selection();
        const initializing = await currentCreation()?.status(payload.id);
        if (initializing && initializing.state !== "ready") {
          await options.host.switchWorld(null);
          await options.invoke("world.open", {id: payload.id});
          await options.resumeRestored?.(payload.id);
          return options.invoke("world.open", {id: payload.id});
        }
        // The descriptor resolves only a verified applied artifact; errors are
        // not a legacy fallback and do not change the saved selection.
        let next = await options.adapter.describe(payload.id);
        if (next && await options.compatibility?.required(payload.id)) {
          // Save the healthy world through its normal checkpoint before
          // selecting an old world whose PCK cannot restore its saved state.
          if (await options.selection() !== previous) throw Error("GODOT_SELECTION_CHANGED_DURING_COMPATIBILITY");
          await options.host.switchWorld(null);
          if (await options.selection() !== previous) throw Error("GODOT_SELECTION_CHANGED_DURING_COMPATIBILITY");
          compatibilitySelection = true;
          await options.invoke("world.open", {id: payload.id});
          if (await options.selection() !== payload.id) throw Error("GODOT_SELECTION_CHANGED_DURING_COMPATIBILITY");
          const result = await options.compatibility!.apply(payload.id);
          if (result.status !== "applied" && !(result.status === "skipped" && result.reason === "already-current")) throw Error("GODOT_COMPATIBILITY_APPLY_UNCONFIRMED");
          if (await options.selection() !== payload.id) throw Error("GODOT_SELECTION_CHANGED_DURING_COMPATIBILITY");
          next = await options.adapter.describe(payload.id);
          if (await options.selection() !== payload.id) throw Error("GODOT_SELECTION_CHANGED_DURING_COMPATIBILITY");
        }
        await options.host.switchWorld(next);
        const result = await options.invoke("world.open", {id:payload.id});
        options.host.setSurfaceVisible(true);
        return result;
      } catch (error) {
        // A lost selection reply can mean the new selection was committed.
        // Never run a view whose identity is uncertain relative to the panel.
        let recoveryError: unknown;
        try {
          let actual = await options.selection();
          if (compatibilitySelection && actual === payload.id && previous && actual !== previous) {
            // Restore only the selection this transaction owns. A newer
            // third-world selection must never be overwritten by rollback.
            if (options.host.instance?.worldId === payload.id) await options.host.switchWorld(null);
            if (await options.selection() !== payload.id) throw Error("GODOT_SELECTION_CHANGED_DURING_FAILED_OPEN");
            await options.invoke("world.open", {id: previous});
            actual = await options.selection();
          }
          if (actual !== previous) throw new Error("GODOT_SELECTION_CHANGED_DURING_FAILED_OPEN");
          if (options.host.instance?.worldId !== previous) {
            await options.host.switchWorld(previous ? await options.adapter.describe(previous) : null);
          }
          if (options.host.instance) await options.host.resume();
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
