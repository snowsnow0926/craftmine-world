import type { CraftmineOverlay } from "./craftmine-layout";
import { toggleCraftmineOverlay } from "./craftmine-layout";

export type ImmersionKey = {
  key: string; repeat?: boolean; isComposing?: boolean; keyCode?: number;
  altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean;
  defaultPrevented?: boolean;
};

/** A local application key decision, shared by controls and state tests. */
export function immersionKeyAction(
  event: ImmersionKey,
  overlay: CraftmineOverlay,
  blocked: boolean,
): CraftmineOverlay | null {
  if (blocked || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "F2") return toggleCraftmineOverlay(overlay, event.shiftKey ? "full" : "compact");
  if (event.key === "Escape" && !event.shiftKey && overlay !== "closed") return "closed";
  return null;
}
