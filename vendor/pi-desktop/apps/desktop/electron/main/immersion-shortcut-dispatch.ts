import type { CraftmineImmersionShortcut, CraftmineImmersionState } from "@pi-desktop/shared";

/** Send before focus moves. Main layers hand off only after the overlay exists. */
export function deliverImmersionShortcut(action: CraftmineImmersionShortcut, options: {
  state: CraftmineImmersionState;
  window: {isDestroyed(): boolean; webContents: {isDestroyed(): boolean}} | null;
  send: (action: CraftmineImmersionShortcut) => void;
}): boolean {
  if (!options.state.active || options.state.blocked || !options.window || options.window.isDestroyed() || options.window.webContents.isDestroyed()) return false;
  options.send(action);
  return true;
}
