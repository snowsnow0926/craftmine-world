import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { setCraftmineOverlay } from "../lib/craftmine-layout";
import { toolWorkPanelTab } from "../lib/work-panel-tabs";
import { FilesTab } from "./workpanel/FilesTab";
import { ReviewTab } from "./workpanel/ReviewTab";
import "../styles/craftmine-workbench.css";

/** The chat stays mounted while renderer-owned artifacts cover the world. */
export function CraftmineWorkbenchSurface({ immersive, full, children }: {
  immersive: boolean;
  full: boolean;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const tabs = useAppStore(state => state.workPanelTabs);
  const activeId = useAppStore(state => state.activeWorkPanelTabId);
  const fileRequest = useAppStore(state => state.workPanelFileRequest);
  const activate = useAppStore(state => state.activateWorkPanelTab);
  const open = useAppStore(state => state.openWorkPanelTab);
  const close = useAppStore(state => state.closeWorkPanelTab);
  const artifacts = tabs.filter(tab => tab.kind === "file" || tab.kind === "review");
  const active = artifacts.find(tab => tab.id === activeId);
  const previous = useRef({ activeId, fileRequest });

  useEffect(() => {
    const changed = previous.current.activeId !== activeId || previous.current.fileRequest !== fileRequest;
    previous.current = { activeId, fileRequest };
    // A new artifact is visible immediately, including reopening the same file.
    // Entering play alone must not open a window over the world.
    if (immersive && active && changed) setCraftmineOverlay("full");
  }, [immersive, active, activeId, fileRequest]);

  const showArtifacts = immersive && full;
  return (
    <div className={`craftmine-workbench-surface${showArtifacts ? " has-artifacts" : ""}`}>
      <div className="craftmine-workbench-chat">{children}</div>
      {showArtifacts && <section className="craftmine-workbench-artifacts" aria-label={chinese ? "文件与评审" : "Files and review"}>
        <div className="craftmine-workbench-artifact-toolbar">
          <select aria-label={chinese ? "选择文件或评审" : "Select file or review"} value={active?.id ?? ""}
            onChange={event => activate(event.target.value)}>
            <option value="" disabled>{chinese ? "选择已打开的内容" : "Select an open artifact"}</option>
            {artifacts.map(tab => <option key={tab.id} value={tab.id}>
              {tab.kind === "review" ? t("panel.tabs.review") : tab.resource?.split(/[/\\]/).pop() || t("panel.tabs.file")}
            </option>)}
          </select>
          <button type="button" onClick={() => open(toolWorkPanelTab("review"))}>{t("panel.tabs.review")}</button>
          {active && <button type="button" onClick={() => close(active.id)}>{chinese ? "关闭内容" : "Close artifact"}</button>}
        </div>
        <div className="craftmine-workbench-artifact-body" data-artifact-kind={active?.kind ?? "empty"}>
          {active?.kind === "file" ? <FilesTab key={active.id} /> : active?.kind === "review" ? <ReviewTab /> :
            <p className="craftmine-workbench-empty">{chinese ? "从对话中打开文件，或查看本次修改评审。" : "Open a file from the conversation, or review this task's changes."}</p>}
        </div>
      </section>}
    </div>
  );
}
