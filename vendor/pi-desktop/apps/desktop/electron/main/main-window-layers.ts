import type { BaseWindow, WebContentsView } from "electron";
import type { CraftmineImmersionState } from "@pi-desktop/shared";
import { immersionBlocksInput, NO_IMMERSION } from "../../shared/craftmine-immersion";

const owners = new WeakMap<BaseWindow, {renderer: WebContentsView; state: CraftmineImmersionState}>();

/** Only the trusted application renderer may occupy the native overlay layer. */
export function registerMainLayers(window: BaseWindow, renderer: WebContentsView): void {
  owners.set(window, {renderer, state: NO_IMMERSION});
}

export function setMainImmersion(window: BaseWindow, state: CraftmineImmersionState): void {
  const owner = owners.get(window);
  if (!owner || window.isDestroyed()) return;
  owner.state = state;
  const children = window.contentView.children;
  const index = immersionBlocksInput(state) ? children.length - 1 : 0;
  if (children[index] !== owner.renderer) window.contentView.addChildView(owner.renderer, index);
}

/** A newly attached world/candidate must stay underneath an already open overlay. */
export function raiseMainOverlay(window: BaseWindow): void {
  const owner = owners.get(window);
  if (owner && immersionBlocksInput(owner.state)) setMainImmersion(window, owner.state);
}

/** Return the current input owner without activating or manipulating a window. */
export function mainInputContents(window: BaseWindow): Electron.WebContents | null {
  const owner = owners.get(window);
  if (!owner || window.isDestroyed()) return null;
  if (!owner.state.active || immersionBlocksInput(owner.state)) return owner.renderer.webContents;
  const views = window.contentView.children as WebContentsView[];
  return [...views].reverse().find(view => view.webContents && !view.webContents.isDestroyed())?.webContents ?? null;
}
