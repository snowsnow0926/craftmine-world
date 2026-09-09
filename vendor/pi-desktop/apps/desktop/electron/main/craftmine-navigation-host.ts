/** Main-window navigation gateway. World mutations run in the retained view,
 * which owns the live snapshot and serializes save/create/switch operations. */
export const NAVIGATION_READ_CHANNELS = new Set([
  "world.list", "world.createOptions", "workbench.capabilities", "task.current", "verification.list",
  "library.search", "memory.search", "backup.status",
]);

type Request = { pluginId?: unknown; channel?: unknown; payload?: unknown };
type Dependencies = {
  invoke: (channel: string, payload: Record<string, unknown>) => Promise<unknown>;
  navigate: (request: Record<string, unknown>) => Promise<unknown>;
};

export async function invokeCraftmineNavigation(input: Request, deps: Dependencies): Promise<unknown> {
  if (input?.pluginId !== "craftmine.world" || typeof input.channel !== "string") {
    throw new Error("PERMISSION_DENIED");
  }
  if (input.payload != null && (typeof input.payload !== "object" || Array.isArray(input.payload))) {
    throw new Error("INVALID_NAVIGATION_REQUEST");
  }
  const payload = (input.payload ?? {}) as Record<string, unknown>;
  const channel = input.channel;
  if (NAVIGATION_READ_CHANNELS.has(channel)) return deps.invoke(channel, payload);
  if (channel === "world.switch" || channel === "world.open") {
    if (typeof payload.id !== "string" || !payload.id || payload.id.length > 128) {
      throw new Error("INVALID_WORLD_ID");
    }
    return deps.navigate({ operation: "switch", id: payload.id });
  }
  if (channel === "world.create") {
    if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 80) {
      throw new Error("INVALID_WORLD_TITLE");
    }
    return deps.navigate({
      operation: "create", title: payload.title.trim(),
      baseId: payload.baseId, starterId: payload.starterId,
    });
  }
  // No renderer path for raw progress writes, executor registration, application
  // tokens or the plugin's broader authoring/lifecycle channels.
  throw new Error("PERMISSION_DENIED");
}
