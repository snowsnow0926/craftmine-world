import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { setCraftmineOverlay } from "../lib/craftmine-layout";
import { enterCraftmineMode, openCraftmineModeEntry } from "../lib/craftmine-mode";
import { useCraftmineLayout } from "../lib/use-craftmine-immersion";
import { useCreationTaskStatus } from "../hooks/use-creation-task-status";
import { creationTaskLabel } from "../lib/creation-task-status";

export function CraftmineOverlayControls() {
  const { i18n, t } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const { overlay } = useCraftmineLayout();
  const running = useAppStore(state => state.isRunning);
  const sessionId = useAppStore(state => state.activeSessionId);
  const creation = useCreationTaskStatus(sessionId ?? null, running);
  const status = useAppStore(state => state.activeSessionId ? state.agentStatuses[state.activeSessionId] : undefined);
  const activity = status?.activity;
  const showHost = !!creation.status && creation.status.phase !== "idle" && (!running || ["checking", "applying"].includes(creation.status.phase));
  const showUnavailable = creation.unavailable && !running;
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
      {/* Every state that can be reached by keyboard is reachable by mouse too. */}
      <button type="button" data-action="exit-play" onClick={() => enterCraftmineMode("create", { explicit: true })}
        title={chinese ? "返回工作台，保留当前世界和任务" : "Return to the workbench, keeping the current world and task"}>
        {chinese ? "回到创作" : "Back to create"}
      </button>
      <button type="button" data-action="choose-mode" onClick={openCraftmineModeEntry}>
        {chinese ? "选择模式" : "Choose mode"}
      </button>
      {(creation.status?.phase !== "idle" && creation.status) || creation.unavailable || running ? <span className="craftmine-overlay-task" role="status" aria-live="polite"
        data-task-stage={status?.pendingToolConfirmations ? "approval" : showHost ? creation.status!.phase : showUnavailable ? "unavailable" : activity?.phase ?? "running"}
        title={showHost ? creation.status?.error : undefined}>
        {status?.pendingToolConfirmations ? stage : showHost ? creationTaskLabel(creation.status!, chinese)
          : showUnavailable ? (chinese ? "任务状态暂不可用 · 打开工作台查看" : "Task status unavailable · open workbench") : stage}
      </span> : null}
    </div>
  );
}
