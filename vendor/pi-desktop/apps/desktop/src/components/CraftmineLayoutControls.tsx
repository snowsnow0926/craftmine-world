import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { pluginWorkPanelTab } from "../lib/work-panel-tabs";
import { changeCraftmineLayout, loadCraftmineLayout, saveCraftmineLayout } from "../lib/craftmine-layout";

const WORLD = pluginWorkPanelTab("craftmine.world", "world");

export function CraftmineLayoutControls() {
  const { i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const [layout, setLayout] = useState(() => loadCraftmineLayout(localStorage));
  useEffect(() => {
    const sync = () => setLayout(loadCraftmineLayout(localStorage));
    window.addEventListener("craftmine-layout-changed", sync);
    return () => window.removeEventListener("craftmine-layout-changed", sync);
  }, []);
  const choose = (mode: "create" | "play") => {
    const state = useAppStore.getState();
    const next = changeCraftmineLayout(loadCraftmineLayout(localStorage), mode, state.workPanelWidth);
    saveCraftmineLayout(localStorage, next);
    state.setPage("chat");
    state.openWorkPanelTab(WORLD);
    state.setWorkPanelWidth(next.widths[mode]);
    setLayout(next);
    window.dispatchEvent(new CustomEvent("craftmine-layout-changed"));
  };
  return (
    <div className="craftmine-layout-controls no-drag" role="group" aria-label={chinese ? "工作台布局" : "Workspace layout"}>
      <form onSubmit={(event) => { event.preventDefault(); choose("create"); }}><button type="submit" aria-pressed={layout.mode === "create"} title={chinese ? "保留聊天与作品工作面板" : "Chat and world side by side"}>{layout.mode === "play" ? (chinese ? "回到创作" : "Back to create") : (chinese ? "创作" : "Create")}</button></form>
      <form onSubmit={(event) => { event.preventDefault(); choose("play"); }}><button type="submit" aria-pressed={layout.mode === "play"} title={chinese ? "世界占满工作区；保留当前对话与标签" : "Fill the workspace; preserve your conversation and tabs"}>{chinese ? "游玩" : "Play"}</button></form>
    </div>
  );
}
