/**
 * Channels shared by the Godot world view preload and its host.
 *
 * The runtime page is a top-level document on its own loopback origin. It has
 * no plugin bridge and no desktop authority: this preload is the only channel
 * it can use, and the host validates every message against the instance scope
 * it minted before the page was created.
 */

/** Page -> host: one protocol message (ready/response/event/runtime-error/exited). */
export const GODOT_WORLD_MESSAGE_CHANNEL = "pi-desktop/godot-world/message";

/** Host -> page: the view is being torn down; stop sending. */
export const GODOT_WORLD_DETACH_CHANNEL = "pi-desktop/godot-world/detach";

/** Trusted preload -> host: exit fullscreen for this currently displayed scope. */
export const GODOT_WORLD_FULLSCREEN_EXIT_CHANNEL = "pi-desktop/godot-world/fullscreen-exit";

/**
 * Instance scope handed to the preload through `additionalArguments`. The page
 * cannot change it: it is fixed before the document is created.
 */
export const GODOT_WORLD_SCOPE_ARGUMENT_PREFIX = "--craftmine-godot-scope=";

export type GodotWorldScope = {
  protocol: string;
  worldId: string;
  buildId: string;
  instanceId: string;
};

export function godotWorldScopeArgument(scope: GodotWorldScope): string {
  return `${GODOT_WORLD_SCOPE_ARGUMENT_PREFIX}${encodeURIComponent(JSON.stringify(scope))}`;
}

export function parseGodotWorldScopeArgument(argument: string): GodotWorldScope | null {
  if (!argument.startsWith(GODOT_WORLD_SCOPE_ARGUMENT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(argument.slice(GODOT_WORLD_SCOPE_ARGUMENT_PREFIX.length)));
    if (!parsed || typeof parsed !== "object") return null;
    const { protocol, worldId, buildId, instanceId } = parsed as Record<string, unknown>;
    for (const value of [protocol, worldId, buildId, instanceId]) {
      if (typeof value !== "string" || !value.length || value.length > 128) return null;
    }
    return { protocol: protocol as string, worldId: worldId as string, buildId: buildId as string, instanceId: instanceId as string };
  } catch {
    return null;
  }
}
