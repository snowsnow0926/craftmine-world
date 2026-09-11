export type CraftmineImmersionOverlay = "closed" | "compact" | "full";
/** `exit-play` returns to the workbench once no overlay is left to dismiss. */
export type CraftmineImmersionShortcut = "compact" | "full" | "escape" | "exit-play";
export type CraftmineImmersionBounds = { x: number; y: number; width: number; height: number };
export type CraftmineImmersionState = {
  active: boolean;
  blocked?: boolean;
  overlay: CraftmineImmersionOverlay;
  overlayBounds: CraftmineImmersionBounds | null;
};
