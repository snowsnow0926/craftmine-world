import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { pluginWorkPanelTab } from "../lib/work-panel-tabs";
import {
  changeCraftmineLayout,
  loadCraftmineLayout,
  resetCraftmineLayout,
  saveCraftmineLayout,
} from "../lib/craftmine-layout";
import { CRAFTMINE_WORLD_TEXT } from "../lib/craftmine-worlds-text";
import { api } from "../lib/api";
import { CraftmineOverlayControls } from "./CraftmineOverlayControls";

const WORLD = pluginWorkPanelTab("craftmine.world", "world");

export function CraftmineLayoutControls() {
  const { i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const lang = chinese ? "zh" : "en";
  const [layout, setLayout] = useState(() => loadCraftmineLayout(localStorage));
  const [fullscreen, setFullscreen] = useState(() => document.documentElement.dataset.fullscreen === "true");
  const [fullscreenBusy, setFullscreenBusy] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => api.onWindowFullScreen(({ fullScreen }) => setFullscreen(fullScreen)), []);
  const toggleFullscreen = async () => {
    if (fullscreenBusy) return;
    setFullscreenBusy(true); setFullscreenError("");
    try { const state = await api.nativeMenuAction("toggleFullScreen"); setFullscreen(state.fullScreen); }
    catch (error) { setFullscreenError(error instanceof Error ? error.message : String(error)); }
    finally { setFullscreenBusy(false); }
  };
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
  // Reset returns every remembered width and expansion to the documented
  // defaults, and keeps the workspace in the mode the player is already in.
  const reset = () => {
    const state = useAppStore.getState();
    const next = resetCraftmineLayout(localStorage, layout.mode);
    state.setWorkPanelWidth(next.widths[next.mode]);
    setLayout(next);
    window.dispatchEvent(new CustomEvent("craftmine-layout-changed"));
  };
  return (
    <div
      className="craftmine-layout-controls no-drag"
      role="group"
      aria-label={chinese ? "工作台布局" : "Workspace layout"}
      data-craftmine-layout={layout.mode}
    >
      <form onSubmit={(event) => { event.preventDefault(); choose("create"); }}><button type="submit" aria-pressed={layout.mode === "create"} title={chinese ? "保留聊天与作品工作面板" : "Chat and world side by side"}>{layout.mode === "play" ? (chinese ? "回到创作" : "Back to create") : (chinese ? "创作" : "Create")}</button></form>
      <form onSubmit={(event) => { event.preventDefault(); choose("play"); }}><button type="submit" aria-pressed={layout.mode === "play"} title={chinese ? "世界占满工作区；保留当前对话与标签" : "Fill the workspace; preserve your conversation and tabs"}>{chinese ? "游玩" : "Play"}</button></form>
      {layout.mode === "play" && layout.overlay === "closed" && <CraftmineOverlayControls />}
      <button type="button" data-action="reset-layout" onClick={reset} title={CRAFTMINE_WORLD_TEXT.layoutReset[lang]}>
        {CRAFTMINE_WORLD_TEXT.layoutReset[lang]}
      </button>
      <form onSubmit={event => { event.preventDefault(); void toggleFullscreen(); }}>
        <button type="submit" data-action="world-fullscreen" aria-pressed={fullscreen} disabled={fullscreenBusy}>
          {fullscreen ? (chinese ? "退出全屏" : "Exit fullscreen") : (chinese ? "全屏" : "Fullscreen")}
        </button>
      </form>
      <span role="note" style={{ alignSelf: "center", fontSize: "var(--text-2xs)" }}>
        {chinese ? "F11 全屏切换 · Esc 逐层返回后退出全屏" : "F11 fullscreen · Esc dismisses a layer before exiting fullscreen"}
      </span>
      {fullscreenError && <span role="alert">{fullscreenError}</span>}
    </div>
  );
}
