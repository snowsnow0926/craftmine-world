import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { pluginWorkPanelTab } from "../lib/work-panel-tabs";
import { CraftmineLayoutControls } from "./CraftmineLayoutControls";
import { loadCraftmineLayout } from "../lib/craftmine-layout";
import { craftmineLang, worldErrorMessage } from "../lib/craftmine-worlds";
import { CRAFTMINE_WORLD_TEXT } from "../lib/craftmine-worlds-text";
import type { CraftmineAuxSurface } from "../lib/craftmine-aux";
import { useCraftmineWorlds } from "../hooks/use-craftmine-worlds";
import { WorldListPanel } from "./craftmine/WorldListPanel";
import { WorldAuxSections } from "./craftmine/WorldAuxSections";
import { AssetLibraryPanel } from "./craftmine/assets/AssetLibraryPanel";
import { GodotHistoryPanel } from "./craftmine/GodotHistoryPanel";
import { CopyWorldButton } from "./craftmine/CopyWorldButton";

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
        onClick={open}
        disabled={!available}
        data-nav="world"
        aria-current={active ? "page" : undefined}
      >
        <Box size={16} aria-hidden />
        <span>{CRAFTMINE_WORLD_TEXT.worldsTitle[lang]}</span>
        <span className="craftmine-world-nav-hint">
          {available ? CRAFTMINE_WORLD_TEXT.openWorld[lang] : CRAFTMINE_WORLD_TEXT.loading[lang]}
        </span>
      </button>

      {available && (
        <>
          <WorldListPanel controller={controller} lang={lang} onOpenWorld={open} />
          <CopyWorldButton bridge={controller.bridge} worldId={controller.activeWorldId} onCopied={open} />

          {activeSessionId && (
            <div className="craftmine-world-session" data-world-session={activeSessionId}>
              <span className="craftmine-world-session-label">{CRAFTMINE_WORLD_TEXT.sessionTitle[lang]}</span>
              <span className="craftmine-world-session-title" title={sessionTitle || activeSessionId}>
                {sessionTitle || activeSessionId}
              </span>
            </div>
          )}

          <WorldAuxSections controller={controller} lang={lang} onOpenSurface={openSurface} />
          <form data-history-open-form onSubmit={event => { event.preventDefault(); if (controller.activeWorldId) setHistoryOpen(true); }}><button type="submit" data-godot-history-open disabled={!controller.activeWorldId}>版本与创作分支</button></form>
          {historyOpen && <div className="craftmine-asset-sheet" role="dialog" aria-label="版本与创作分支" data-history-sheet>
            <div className="craftmine-asset-sheet-head"><span>版本与创作分支</span><form data-history-close-form onSubmit={event => { event.preventDefault(); setHistoryOpen(false); }}><button type="submit">关闭</button></form></div>
            <GodotHistoryPanel bridge={controller.bridge} worldId={controller.activeWorldId} onOpenChecks={() => { setHistoryOpen(false); openSurface({ kind: "checks" }, "checks"); }}/>
          </div>}
          {surfaceError && (
            <p className="craftmine-world-error" role="alert" data-surface-error="true">{surfaceError}</p>
          )}
          <CraftmineLayoutControls />
          {assetsOpen && (
            <div className="craftmine-asset-sheet" role="dialog" aria-modal="true"
              aria-label={CRAFTMINE_WORLD_TEXT.assetsTitle[lang]} data-asset-sheet="true">
              <div className="craftmine-asset-sheet-head">
                <span>{CRAFTMINE_WORLD_TEXT.assetsTitle[lang]}</span>
                <button type="button" data-asset-sheet-close="true" onClick={() => setAssetsOpen(false)}>
                  {CRAFTMINE_WORLD_TEXT.assetsClose[lang]}
                </button>
              </div>
              <AssetLibraryPanel
                bridge={controller.bridge}
                lang={lang}
                worldId={controller.activeWorldId}
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
