import type { BaseWindow, WebContentsView } from "electron";
import type { CraftmineImmersionState } from "@pi-desktop/shared";
import { immersionBlocksInput, NO_IMMERSION } from "../../shared/craftmine-immersion";

const owners = new WeakMap<BaseWindow, {renderer: WebContentsView; state: CraftmineImmersionState; input: Electron.WebContents | null; headless: boolean}>();

/** Only the trusted application renderer may occupy the native overlay layer. */
export function registerMainLayers(window: BaseWindow, renderer: WebContentsView, options: {headless: boolean}): void {
  owners.set(window, {renderer, state: NO_IMMERSION, input: null, headless: options.headless});
}

export function setMainImmersion(window: BaseWindow, state: CraftmineImmersionState): void {
  const owner = owners.get(window);
  if (!owner || window.isDestroyed()) return;
  owner.state = state;
  const children = window.contentView.children;
  const index = immersionBlocksInput(state) ? children.length - 1 : 0;
  if (children[index] !== owner.renderer) window.contentView.addChildView(owner.renderer, index);
  syncMainInputFocus(window);
}

/** A newly attached world/candidate must stay underneath an already open overlay. */
export function raiseMainOverlay(window: BaseWindow): void {
  const owner = owners.get(window);
  if (owner && immersionBlocksInput(owner.state)) setMainImmersion(window, owner.state);
  else syncMainInputFocus(window);
}

/** Return the current input owner without activating or manipulating a window. */
export function mainInputContents(window: BaseWindow): Electron.WebContents | null {
  const owner = owners.get(window);
  if (!owner || window.isDestroyed()) return null;
  if (!owner.state.active || immersionBlocksInput(owner.state)) return owner.renderer.webContents;
  const views = window.contentView.children as WebContentsView[];
  return [...views].reverse().find(view => view.webContents && !view.webContents.isDestroyed())?.webContents ?? null;
}

/**
 * Hand input to a newly displayed child inside an already focused window.
 * Geometry updates for the same owner do nothing; they must not steal focus
 * from a menu or other native control. An actual window-focus event can restore
 * the current owner even when the native child identity has not changed.
 */
export function syncMainInputFocus(window: BaseWindow, reason: "view-change" | "window-focus" = "view-change"): void {
  const owner = owners.get(window);
  if (!owner || window.isDestroyed()) return;
  const contents = mainInputContents(window);
  const changed = owner.input !== contents;
  owner.input = contents;
  if (!changed && reason !== "window-focus") return;
  if (owner.headless || !window.isFocused() || !contents || contents.isDestroyed() || contents.isFocused()) return;
  contents.focus();
}
