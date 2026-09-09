import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Box } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { pluginWorkPanelTab } from "../lib/work-panel-tabs";
import { CraftmineLayoutControls } from "./CraftmineLayoutControls";
import { loadCraftmineLayout } from "../lib/craftmine-layout";

const WORLD = pluginWorkPanelTab("craftmine.world", "world");

export function CraftmineNavigation() {
  const { i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const ready = useAppStore((s) => s.ready);
  const available = useAppStore((s) => s.pluginViews.some((view) => view.ref === WORLD.resource));
  const active = useAppStore((s) => s.page === "chat" && s.workPanelOpen && s.activeWorkPanelTabId === WORLD.id);
  const initialized = useRef(false);
  const open = () => {
    const state = useAppStore.getState();
    state.setPage("chat");
    state.openWorkPanelTab(WORLD);
  };
  useEffect(() => {
    // Plugin metadata may arrive before bootstrap restores the session context.
    // Opening earlier lets that restoration immediately clear the new world tab.
    if (!ready || !available || initialized.current) return;
    initialized.current = true;
    const state = useAppStore.getState();
    if (!state.activeSessionId && state.workPanelTabs.length === 0) {
      state.openWorkPanelTab(WORLD);
      const layout = loadCraftmineLayout(localStorage);
      state.setWorkPanelWidth(layout.widths[layout.mode]);
    }
  }, [ready, available]);
  return (
    <nav className="craftmine-navigation no-drag" aria-label={chinese ? "世界创作" : "World creation"}>
      <button type="button" className={`craftmine-world-nav ${active ? "active" : ""}`} onClick={open} disabled={!available} data-nav="world" aria-current={active ? "page" : undefined}>
        <Box size={16} aria-hidden />
        <span>{chinese ? "世界" : "World"}</span>
        <span className="craftmine-world-nav-hint">{chinese ? (available ? "打开工作台" : "正在载入") : (available ? "Open workspace" : "Loading")}</span>
      </button>
      {available && <CraftmineLayoutControls />}
    </nav>
  );
}
