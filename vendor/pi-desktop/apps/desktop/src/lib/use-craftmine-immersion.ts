import { useEffect, useState } from "react";
import { loadCraftmineLayout } from "./craftmine-layout";
import { pluginWorkPanelTab } from "./work-panel-tabs";

/** A layout preference only: never activates a window or enters OS fullscreen. */
export function useCraftmineImmersion(page: string, open: boolean, activeTabId: string | null, blocked = false): boolean {
  const [mode, setMode] = useState(() => loadCraftmineLayout(localStorage).mode);
  useEffect(() => {
    const sync = () => setMode(loadCraftmineLayout(localStorage).mode);
    window.addEventListener("craftmine-layout-changed", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("craftmine-layout-changed", sync); window.removeEventListener("storage", sync); };
  }, []);
  return mode === "play" && page === "chat" && open && !blocked && activeTabId === pluginWorkPanelTab("craftmine.world", "world").id;
}
