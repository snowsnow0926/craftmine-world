import type { CraftmineOverlay } from "./craftmine-layout";
import { toggleCraftmineOverlay } from "./craftmine-layout";

export type ImmersionKey = {
  key: string; repeat?: boolean; isComposing?: boolean; keyCode?: number;
  altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean;
  defaultPrevented?: boolean;
};

/**
 * `exit-play` returns to the workbench when no overlay is left to dismiss: the
 * first Escape closes the open overlay, a later one leaves play. Fully close
 * F11/OS fullscreen after that.
 */
export type ImmersionKeyResult = CraftmineOverlay | "exit-play" | null;

/** A local application key decision, shared by controls and state tests. */
export function immersionKeyAction(
  event: ImmersionKey,
  overlay: CraftmineOverlay,
  blocked: boolean,
): ImmersionKeyResult {
  if (blocked || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "F2") return toggleCraftmineOverlay(overlay, event.shiftKey ? "full" : "compact");
  if (event.key === "Escape" && !event.shiftKey) return overlay === "closed" ? "exit-play" : "closed";
  return null;
}

/**
 * The single application point for a decided key action, so the renderer hook
 * and the checks that cover it share one implementation instead of two copies
 * of the same branch.
 */
export function applyImmersionKey(
  action: ImmersionKeyResult,
  host: { setOverlay: (overlay: CraftmineOverlay) => void; exitPlay: () => void },
): boolean {
  if (action === null) return false;
  if (action === "exit-play") { host.exitPlay(); return true; }
  host.setOverlay(action);
  return true;
}

/** The finite actions a native child surface forwards to the renderer. */
export type ImmersionShortcutAction = "compact" | "full" | "escape" | "exit-play";

/**
 * The native surface and the main frame must agree on what a key means, so a
 * forwarded action is mapped by the same module the local decision uses.
 */
export function immersionShortcutAction(action: ImmersionShortcutAction, overlay: CraftmineOverlay): ImmersionKeyResult {
  if (action === "escape") return "closed";
  if (action === "exit-play") return "exit-play";
  return toggleCraftmineOverlay(overlay, action);
}
