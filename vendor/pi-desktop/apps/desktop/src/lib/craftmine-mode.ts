import { useAppStore } from "../stores/app-store";
import {
  changeCraftmineLayout,
  loadCraftmineLayout,
  saveCraftmineLayout,
  type CraftmineLayout,
} from "./craftmine-layout";
import { pluginWorkPanelTab } from "./work-panel-tabs";
import { shouldOpenCraftmineWorldTab } from "./craftmine-mode-presentation";

const WORLD = pluginWorkPanelTab("craftmine.world", "world");

/** Return to the two primary modes without changing the active world or task. */
export function openCraftmineModeEntry(): void {
  window.dispatchEvent(new CustomEvent("craftmine-mode-entry-open"));
}

/**
 * Switches the workspace presentation only. Like every other layout change it
 * never creates a session, submits a prompt or stops a running task: the world,
 * its conversation and its progress stay bound to the same context.
 *
 * `explicit` records a player's stated preference instead of a transient one.
 * Automatic entry into play (see `decideCraftmineActivation`) never sets it, so
 * an automatic switch can never turn the default on or off by itself.
 */
export function enterCraftmineMode(
  mode: CraftmineLayout["mode"],
  options: { explicit?: boolean } = {},
): CraftmineLayout {
  const state = useAppStore.getState();
  const next = changeCraftmineLayout(
    loadCraftmineLayout(localStorage),
    mode,
    state.workPanelWidth,
    options,
  );
  saveCraftmineLayout(localStorage, next);
  // This is presentation within the current conversation. Starting a new
  // navigation intent here would cancel an in-flight history selection whose
  // sidebar highlight is already visible but whose transcript is still loading.
  if (state.page !== "chat") state.setPage("chat");
  if (shouldOpenCraftmineWorldTab(mode, state.activeWorkPanelTabId, state.workPanelTabs)) {
    state.openWorkPanelTab(WORLD);
  } else {
    state.openWorkPanel();
  }
  state.setWorkPanelWidth(next.widths[mode]);
  window.dispatchEvent(new CustomEvent("craftmine-layout-changed"));
  return next;
}
