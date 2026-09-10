export type CraftmineImmersionOverlay = "closed" | "compact" | "full";
export type CraftmineImmersionShortcut = "compact" | "full" | "escape";
export type CraftmineImmersionBounds = { x: number; y: number; width: number; height: number };
export type CraftmineImmersionState = {
  active: boolean;
  blocked?: boolean;
  overlay: CraftmineImmersionOverlay;
  overlayBounds: CraftmineImmersionBounds | null;
};
