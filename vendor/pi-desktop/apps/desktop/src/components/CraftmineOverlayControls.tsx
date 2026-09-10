import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { setCraftmineOverlay } from "../lib/craftmine-layout";
import { useCraftmineLayout } from "../lib/use-craftmine-immersion";

export function CraftmineOverlayControls() {
  const { i18n, t } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const { overlay } = useCraftmineLayout();
  const running = useAppStore(state => state.isRunning);
  const status = useAppStore(state => state.activeSessionId ? state.agentStatuses[state.activeSessionId] : undefined);
  const activity = status?.activity;
  const stage = status?.pendingToolConfirmations ? (chinese ? "等待确认" : "Awaiting approval")
    : activity?.phase === "waiting-model" ? t("chat.waitingForModel")
    : activity?.phase === "retrying" ? t("chat.retryingModel", {attempt: activity.attempt})
    : activity?.phase === "waiting-subagents" ? t("chat.waitingForSubagents", {count: activity.subagentCount})
    : activity?.phase === "starting" ? (chinese ? "正在启动任务" : "Starting task")
    : (chinese ? "任务执行中" : "Task running");
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
      {running && <span className="craftmine-overlay-task" role="status" data-task-stage={status?.pendingToolConfirmations ? "approval" : activity?.phase ?? "running"}>{stage}</span>}
    </div>
  );
}
