type Data = Record<string, any>;
type Dependencies = {
  domain: (method: string, payload: Data) => Promise<any>;
  list: () => Promise<{worlds: Data[]; activeWorldId: string | null}>;
  selection: () => Promise<string | null>;
  navigate: (worldId: string) => Promise<unknown>;
  createFallback: () => Promise<{id: string}>;
  blocked: (worldId: string) => string | null;
  settleMaintenance: () => Promise<void>;
  changed: () => void;
};
const checkedId = (payload: Data) => {
  if (!payload || Object.keys(payload).length !== 1 || typeof payload.worldId !== "string"
    || !/^[A-Za-z0-9_-]{1,80}$/.test(payload.worldId)) throw Error("INVALID_WORLD_ID");
  return payload.worldId;
};

/** Player deletion is a durable, reversible archive. Sources and session
 * history stay owned by core. Only a failed, idle world can be removed. */
export function createCraftmineWorldRemoval(deps: Dependencies) {
  let busy = false, allowedOpen: string | null = null;
  return {
    get busy() { return busy; },
    permitsOpen(id: unknown) { return typeof id === "string" && id === allowedOpen; },
    async invoke(channel: string, payload: Data = {}): Promise<any> {
      if (channel === "world.archivedList") {
        if (Object.keys(payload).length) throw Error("INVALID_WORLD_REMOVAL_REQUEST");
        return {worlds: await deps.domain("world.archivedList", {})};
      }
      if (!["world.archiveFailed", "world.restoreArchived"].includes(channel)) throw Error("INVALID_WORLD_REMOVAL_REQUEST");
      const worldId = checkedId(payload);
      if (busy) throw Error("WORLD_REMOVAL_BUSY");
      busy = true;
      try {
        if (channel === "world.restoreArchived") {
          let restored;
          try {restored = await deps.domain("world.restoreArchived", {id: worldId});}
          catch (error) {restored = await deps.domain("world.archiveStatus", {id: worldId}).catch(() => null);if (restored?.archived !== false) throw error;}
          if (restored.archived !== false || restored.worldId !== worldId) throw Error("WORLD_RESTORE_UNCONFIRMED");
          deps.changed();return restored;
        }
        const prior = await deps.domain("world.archiveStatus", {id: worldId});
        if (prior.archived === true) {deps.changed();return prior;}
        const blocked = deps.blocked(worldId);if (blocked) throw Error(blocked);
        const list = await deps.list(), entry = list.worlds.find(world => world.id === worldId);
        if (!entry || entry.state !== "failed") throw Error("WORLD_REMOVAL_REQUIRES_FAILED_INITIALIZATION");
        await deps.settleMaintenance();
        const freshBlocked = deps.blocked(worldId);if (freshBlocked) throw Error(freshBlocked);
        const original = await deps.domain("world.read", {id: worldId});
        if (await deps.selection() === worldId) {
          const fallback = list.worlds.find(world => world.id !== worldId && (world.state === "ready" || world.state == null))
            ?? await deps.createFallback();
          allowedOpen = fallback.id;
          await deps.navigate(fallback.id);
          allowedOpen = null;
          if (await deps.selection() !== fallback.id) throw Error("WORLD_SELECTION_CHANGED");
        }
        if (await deps.selection() === worldId) throw Error("WORLD_REMOVAL_CURRENT_WORLD");
        const finalBlocked = deps.blocked(worldId);if (finalBlocked) throw Error(finalBlocked);
        let result;
        try {result = await deps.domain("world.archiveFailed", {id: worldId, revision: original.revision, baseBuild: original.world.build.id});}
        catch (error) {result = await deps.domain("world.archiveStatus", {id: worldId}).catch(() => null);if (result?.archived !== true) throw error;}
        if (result.worldId !== worldId || result.archived !== true) throw Error("WORLD_REMOVAL_UNCONFIRMED");
        deps.changed();return {...result, activeWorldId: await deps.selection()};
      } finally { allowedOpen = null;busy = false; }
    },
  };
}
