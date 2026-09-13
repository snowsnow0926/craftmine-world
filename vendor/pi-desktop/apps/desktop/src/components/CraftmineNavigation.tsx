import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Package } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { pluginWorkPanelTab } from "../lib/work-panel-tabs";
import { CraftmineLayoutControls } from "./CraftmineLayoutControls";
import { decideCraftmineActivation, loadCraftmineLayout, saveCraftmineLayout } from "../lib/craftmine-layout";
import { craftmineLang, worldErrorMessage } from "../lib/craftmine-worlds";
import { CRAFTMINE_WORLD_TEXT } from "../lib/craftmine-worlds-text";
import type { CraftmineAuxSurface } from "../lib/craftmine-aux";
import { useCraftmineWorlds } from "../hooks/use-craftmine-worlds";
import { enterCraftmineMode, openCraftmineModeEntry } from "../lib/craftmine-mode";
import { WorldAuxSections } from "./craftmine/WorldAuxSections";
import { AssetLibraryPanel } from "./craftmine/assets/AssetLibraryPanel";
import { GodotHistoryPanel } from "./craftmine/GodotHistoryPanel";
import { worldAssetPrompt } from "../lib/world-asset-request";

const WORLD = pluginWorkPanelTab("craftmine.world", "world");

/**
 * Left-column world navigation: the world list, the session bound to the
 * current world, and the auxiliary surfaces on demand. The existing session and
 * project navigation below it is untouched, so nothing is lost by switching.
 */
export function CraftmineNavigation() {
  const { i18n } = useTranslation();
  const lang = craftmineLang(i18n.language);
  const ready = useAppStore((s) => s.ready);
  const available = useAppStore((s) => s.pluginViews.some((view) => view.ref === WORLD.resource));
  const active = useAppStore((s) => s.page === "chat" && s.workPanelOpen && s.activeWorkPanelTabId === WORLD.id);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const initialized = useRef(false);
  const controller = useCraftmineWorlds(lang);

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

  // Entering a world fills the workspace by default. The automatic switch runs
  // once per activated world, states no preference, and leaves an already
  // playing workspace alone: the visible 游玩/创作 controls remain the only way
  // to change what gets stored.
  useEffect(() => {
    if (!available || !active || !controller.activeWorldId) return;
    const layout = loadCraftmineLayout(localStorage);
    const decision = decideCraftmineActivation({
      worldId: controller.activeWorldId,
      enteredWorldId: layout.enteredWorldId,
      playWhenWorldActivates: layout.playWhenWorldActivates,
      playing: layout.mode === "play",
    });
    if (decision.enteredWorldId !== layout.enteredWorldId) {
      saveCraftmineLayout(localStorage, { ...layout, enteredWorldId: decision.enteredWorldId });
    }
    if (decision.switchToPlay) enterCraftmineMode("play");
  }, [available, active, controller.activeWorldId]);

  const sessionTitle = useMemo(() => {
    if (!activeSessionId) return "";
    return sessions.find((session) => session.id === activeSessionId)?.title ?? "";
  }, [sessions, activeSessionId]);

  // The deep surface lives inside the world view. Opening the world tab is a
  // real action; the surface request is sent over the documented navigation
  // channel, which the host routes into the retained view.
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    const open = assetsOpen || historyOpen;
    window.dispatchEvent(new CustomEvent("craftmine-sheet-visibility", {detail: {open}}));
    return () => { window.dispatchEvent(new CustomEvent("craftmine-sheet-visibility", {detail: {open: false}})); };
  }, [assetsOpen, historyOpen]);
  const openSurface = (surface: CraftmineAuxSurface, section: string) => {
    open();
    setSurfaceError(null);
    // The asset library is a main-window panel, not a plugin-panel tab.
    if (surface.kind === "assets") {
      setAssetsOpen(true);
      return;
    }
    const bridge = controller.bridge;
    if (!bridge) {
      setSurfaceError(CRAFTMINE_WORLD_TEXT.unavailable[lang]);
      return;
    }
    void bridge
      .call("world.surface", { surface, section })
      .catch((failure) => setSurfaceError(worldErrorMessage(failure, lang)));
  };

  return (
    <nav className="craftmine-navigation no-drag" aria-label={CRAFTMINE_WORLD_TEXT.worldsTitle[lang]}>
      <button
        type="button"
        className={`craftmine-world-nav ${active ? "active" : ""}`}
        onClick={openCraftmineModeEntry}
        disabled={!available}
        data-nav="world"
        aria-current={active ? "page" : undefined}
      >
        <Box size={16} aria-hidden />
        <span title={controller.activeWorld?.title}>{controller.activeWorld?.title || (lang==="zh"?"选择世界":"Choose world")}</span>
        <span className="craftmine-world-nav-hint">
          {available ? (lang === "zh" ? "切换" : "Switch") : CRAFTMINE_WORLD_TEXT.loading[lang]}
        </span>
      </button>

      {available && (
        <>
          <form data-world-assets-open onSubmit={event => { event.preventDefault(); openSurface({kind: "assets"}, "assets"); }}>
            <button type="submit" className="craftmine-world-nav"><Package size={16} aria-hidden /><span>{CRAFTMINE_WORLD_TEXT.assetsTitle[lang]}</span></button>
          </form>
          {activeSessionId && (
            <div className="craftmine-world-session" data-world-session={activeSessionId}>
              <span className="craftmine-world-session-label">{CRAFTMINE_WORLD_TEXT.sessionTitle[lang]}</span>
              <span className="craftmine-world-session-title" title={sessionTitle || activeSessionId}>
                {sessionTitle || activeSessionId}
              </span>
            </div>
          )}

          <details><summary>{lang==="zh"?"更多工具":"More tools"}</summary><WorldAuxSections controller={controller} lang={lang} onOpenSurface={openSurface} /></details>
          <form data-history-open-form onSubmit={event => { event.preventDefault(); if (controller.activeWorldId) setHistoryOpen(true); }}><button type="submit" data-godot-history-open disabled={!controller.activeWorldId}>版本与创作分支</button></form>
          {historyOpen && <div className="craftmine-asset-sheet" role="dialog" aria-label="版本与创作分支" data-history-sheet>
            <div className="craftmine-asset-sheet-head"><span>版本与创作分支</span><form data-history-close-form onSubmit={event => { event.preventDefault(); setHistoryOpen(false); }}><button type="submit">关闭</button></form></div>
            <GodotHistoryPanel bridge={controller.bridge} worldId={controller.activeWorldId} onOpenChecks={() => { setHistoryOpen(false); openSurface({ kind: "checks" }, "checks"); }}/>
          </div>}
          {surfaceError && (
            <p className="craftmine-world-error" role="alert" data-surface-error="true">{surfaceError}</p>
          )}
          <details><summary>{lang==="zh"?"高级布局":"Advanced layout"}</summary><CraftmineLayoutControls /></details>
          {assetsOpen && (
            <div className="craftmine-asset-sheet" role="dialog" aria-modal="true"
              aria-label={CRAFTMINE_WORLD_TEXT.assetsTitle[lang]} data-asset-sheet="true" data-asset-owner={controller.activeWorldId ?? ""}>
              <div className="craftmine-asset-sheet-head">
                <span>{CRAFTMINE_WORLD_TEXT.assetsTitle[lang]}</span>
                <form data-asset-close-form onSubmit={event => {event.preventDefault(); setAssetsOpen(false);}}><button type="submit" data-asset-sheet-close="true">
                  {CRAFTMINE_WORLD_TEXT.assetsClose[lang]}
                </button></form>
              </div>
              <AssetLibraryPanel key={controller.activeWorldId ?? "global"}
                bridge={controller.bridge}
                lang={lang}
                worldId={controller.activeWorldId}
                onUseAsset={async (asset, modify) => {
                  const worldId = controller.activeWorldId, bridge = controller.bridge;
                  const original = useAppStore.getState(), sessionId = original.activeSessionId;
                  if (!worldId || !bridge) throw Error(lang === "zh" ? "请先打开一个世界。" : "Open a world first.");
                  const selected = await bridge.list();
                  const bound = sessionId ? await bridge.call("world.conversation", {worldId, sessionId}) as {worldId?: string; sessionId?: string} : null;
                  if (selected.activeWorldId !== worldId || useAppStore.getState().activeSessionId !== sessionId || (sessionId && (bound?.worldId !== worldId || bound.sessionId !== sessionId)))
                    throw Error(lang === "zh" ? "请先回到此世界的对话，再加入素材。" : "Return to this world's conversation before adding the asset.");
                  const text = worldAssetPrompt(asset, modify, lang === "zh");
                  const pending = useAppStore.getState().composerPrefill;
                  if (pending) throw Error(lang === "zh" ? "请先处理对话中待填入的内容。" : "Finish the pending conversation draft first.");
                  useAppStore.setState({composerPrefill: {sessionId, worldId, text, fileReferences: [], append: true, focus: false}});
                  setAssetsOpen(false);
                  enterCraftmineMode("create", {explicit: true});
                }}
                onImportRequest={async () => {
                  const bridge = controller.bridge;
                  if (!bridge) return null;
                  // The retained trusted view owns the native directory grant,
                  // exactly like the legacy import picker.
                  const picked = await bridge.call("world.pickDirectory", {}) as {sourceRoot?: unknown} | null;
                  const sourceRoot = typeof picked?.sourceRoot === "string" ? picked.sourceRoot : "";
                  return sourceRoot ? {sourceRoot, sourcePath: ""} : null;
                }}
              />
            </div>
          )}
        </>
      )}
    </nav>
  );
}
