import { useEffect, useState } from "react";
import { isCraftmineWorldWorkspace, loadCraftmineLayout } from "./craftmine-layout";

export function useCraftmineLayout() {
  const [layout, setLayout] = useState(() => loadCraftmineLayout(localStorage));
  useEffect(() => {
    const sync = () => setLayout(loadCraftmineLayout(localStorage));
    window.addEventListener("craftmine-layout-changed", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("craftmine-layout-changed", sync); window.removeEventListener("storage", sync); };
  }, []);
  return layout;
}

/** A layout preference only: never activates a window or enters OS fullscreen. */
export function useCraftmineImmersion(page: string, open: boolean, activeTabId: string | null, blocked = false): boolean {
  return useCraftmineLayout().mode === "play" && isCraftmineWorldWorkspace(page, open, activeTabId, blocked);
}
