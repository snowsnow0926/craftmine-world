import type { PermissionMode } from "@pi-desktop/shared";
export const CREATION_WORLD_TAB = "plugin:craftmine.world/world";

/** A world conversation defaults to automatic creation, not an implicit Ask.
 * Explicit session/global choices and ordinary workbench sessions stay intact. */
export function creationSessionPermission(input: {
  worldFlow: boolean;
  sessionPermission?: PermissionMode;
  globalPermission?: string | null;
}): PermissionMode | undefined {
  if (!input.worldFlow || (input.sessionPermission && input.sessionPermission !== "inherit") || input.globalPermission != null) {
    return input.sessionPermission;
  }
  return "auto";
}

export function immersiveCreationContext(mode: string, tabs: readonly { id: string }[]): boolean {
  return mode === "play" && tabs.some(tab => tab.id === CREATION_WORLD_TAB);
}
