export const CRAFTMINE_WORLD_TAB_ID = "plugin:craftmine.world/world";

/** Artifacts remain selected in the store for the workbench, behind the world. */
export function craftminePresentedTabId(
  mode: "create" | "play",
  activeTabId: string | null,
  tabs: ReadonlyArray<{ id: string }>,
): string | null {
  if (mode === "play" && tabs.some(tab => tab.id === CRAFTMINE_WORLD_TAB_ID)) {
    return CRAFTMINE_WORLD_TAB_ID;
  }
  return activeTabId;
}

/** Returning to the workbench reveals its last selected artifact if retained. */
export function shouldOpenCraftmineWorldTab(
  mode: "create" | "play",
  activeTabId: string | null,
  tabs: ReadonlyArray<{ id: string }>,
): boolean {
  return mode === "play" || !tabs.some(tab => tab.id === activeTabId);
}
