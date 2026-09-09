/** Main-window navigation gateway. World mutations run in the retained view,
 * which owns the live snapshot and serializes save/create/switch operations. */
export const NAVIGATION_READ_CHANNELS = new Set([
  "world.list", "world.createOptions", "workbench.capabilities", "task.current", "task.recoverable",
  "verification.list", "library.search", "memory.search", "backup.status",
  // Asset browsing reads (R6's contract). Writes stay behind the player flow.
  "asset.search", "asset.read", "asset.versions", "asset.usage", "asset.scan",
  "asset.probe", "asset.previewRead",
]);

type Request = { pluginId?: unknown; channel?: unknown; payload?: unknown };
type Dependencies = {
  invoke: (channel: string, payload: Record<string, unknown>) => Promise<unknown>;
  navigate: (request: Record<string, unknown>) => Promise<unknown>;
  /** Opens a surface inside the retained world view (no world mutation). */
  showSurface: (request: Record<string, unknown>) => Promise<unknown>;
  /** Host-owned directory grant, performed by the retained view. */
  pickDirectory: () => Promise<unknown>;
};

const SURFACE_KINDS = new Set(["workbench", "checks", "world"]);
const boundedToken = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 40 && pattern.test(value);

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
  if (channel === "world.surface") {
    const surface = payload.surface as Record<string, unknown> | undefined;
    if (!surface || typeof surface !== "object" || Array.isArray(surface)
      || !SURFACE_KINDS.has(String(surface.kind))) throw new Error("INVALID_SURFACE_REQUEST");
    if (surface.kind === "workbench" && !boundedToken(surface.tab, /^[a-z][a-z0-9-]*$/)) {
      throw new Error("INVALID_SURFACE_REQUEST");
    }
    if (payload.section != null && !boundedToken(payload.section, /^[a-z][a-z0-9-]*$/)) {
      throw new Error("INVALID_SURFACE_REQUEST");
    }
    return deps.showSurface({ operation: "surface", surface, section: payload.section ?? null });
  }
  if (channel === "world.pickDirectory") {
    if (Object.keys(payload).length > 0) throw new Error("INVALID_NAVIGATION_REQUEST");
    return deps.pickDirectory();
  }
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
    // A stable operation id lets a retried submit reach the same world.
    if (payload.operationId != null
      && (typeof payload.operationId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(payload.operationId))) {
      throw new Error("INVALID_OPERATION_ID");
    }
    return deps.navigate({
      operation: "create", title: payload.title.trim(),
      baseId: payload.baseId, starterId: payload.starterId, operationId: payload.operationId,
    });
  }
  // No renderer path for raw progress writes, executor registration, application
  // tokens or the plugin's broader authoring/lifecycle channels.
  throw new Error("PERMISSION_DENIED");
}
