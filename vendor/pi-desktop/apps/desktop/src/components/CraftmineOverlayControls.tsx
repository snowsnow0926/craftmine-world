import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { setCraftmineOverlay } from "../lib/craftmine-layout";
import { useCraftmineLayout } from "../lib/use-craftmine-immersion";

export function CraftmineOverlayControls() {
  const { i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const { overlay } = useCraftmineLayout();
  const running = useAppStore(state => state.isRunning);
  return (
    <div className="craftmine-overlay-controls no-drag" role="group" aria-label={chinese ? "游戏内创作" : "Create in world"}>
      <button type="button" onClick={() => setCraftmineOverlay("compact")} aria-pressed={overlay === "compact"} title="F2">
        {chinese ? "轻量对话" : "Compact chat"}
      </button>
      <button type="button" onClick={() => setCraftmineOverlay("full")} aria-pressed={overlay === "full"} title="Shift+F2">
        {chinese ? "完整工作台" : "Full workbench"}
      </button>
      {overlay !== "closed" && <button type="button" onClick={() => setCraftmineOverlay("closed")} title="Escape">
        {chinese ? "收起" : "Close"}
      </button>}
      {running && <span className="craftmine-overlay-task" role="status">{chinese ? "任务执行中" : "Task running"}</span>}
    </div>
  );
}
