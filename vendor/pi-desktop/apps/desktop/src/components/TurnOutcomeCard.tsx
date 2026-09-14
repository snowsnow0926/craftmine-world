import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import type { UiMessage } from "@pi-desktop/shared";
import type { AgentTurnResult } from "../stores/app-store";
import { useAppStore } from "../stores/app-store";
import { IconCircleAlert } from "./icons";
import { api } from "../lib/api";
import { isExecutionLimitFailure, releaseAndContinueTask } from "../lib/execution-limit-recovery";

type TurnOutcomeCardProps = {
  messages: UiMessage[];
  result?: AgentTurnResult;
};

function latestTurnMessages(messages: UiMessage[]) {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return lastUserIndex < 0 ? messages : messages.slice(lastUserIndex + 1);
}

export function TurnOutcomeCard({
  messages,
  result,
}: TurnOutcomeCardProps) {
  const { t } = useTranslation();
  const sendPrompt = useAppStore((state) => state.sendPrompt);
  const sessionId = useAppStore((state) => state.activeSessionId);
  const running = useAppStore((state) => state.isRunning);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  useEffect(() => {setError(""); setPending(false);}, [sessionId]);

  if (!result || result.status === "completed") return null;

  const tail = latestTurnMessages(messages);
  const localLimit = tail.some(message => isExecutionLimitFailure(message.error?.code));
  const continueAfterRelease = async () => {
    if (!sessionId || running || locked.current) return;
    locked.current = true; setPending(true); setError("");
    const owner = sessionId;
    let released = false;
    try {
      await releaseAndContinueTask({
        sessionId: owner,
        call: (channel, payload) => api.pluginPanelInvoke("craftmine.world", channel, payload),
        assertSession: () => {
          const current = useAppStore.getState();
          if (current.activeSessionId !== owner || current.isRunning) throw Error("TASK_SESSION_CHANGED");
        },
        onReleased: () => {released = true;},
      });
    } catch (failure) {
      if (useAppStore.getState().activeSessionId === owner) setError(released
        ? t("playerBudget.releaseIncomplete") : failure instanceof Error ? failure.message : String(failure));
    } finally {
      locked.current = false;
      if (useAppStore.getState().activeSessionId === owner) setPending(false);
    }
  };
  const toolCount = tail.filter((message) => message.role === "tool").length;
  const hasVisibleTurn = tail.some(
    (message) =>
      Boolean(message.content.trim()) ||
      message.role === "tool" ||
      Boolean(message.error),
  );

  if (!hasVisibleTurn) return null;

  return (
    <section
      className="turn-outcome-card failed"
      data-testid="turn-outcome-card"
      data-outcome="failed"
      role="status"
      aria-live="polite"
    >
      <div className="turn-outcome-heading">
        <span className="turn-outcome-icon" aria-hidden>
          <IconCircleAlert size={16} />
        </span>
        <div className="turn-outcome-copy">
          <strong>{t("chat.resultNeedsAttention")}</strong>
          <span>{t(localLimit ? "playerBudget.releaseBody" : "chat.resultFailedBody")}</span>
        </div>
      </div>
      {toolCount > 0 ? (
        <div className="turn-outcome-stats">
          <span>{t("chat.resultSteps", { count: toolCount })}</span>
        </div>
      ) : null}
      <div className="turn-outcome-actions">
        <button
          type="button"
          className="copy-btn primary"
          disabled={pending || running}
          onClick={() =>
            localLimit ? void continueAfterRelease() : void sendPrompt(t("chat.continueUnfinishedTaskPrompt"))
          }
        >
          {localLimit ? t("playerBudget.releaseContinue") : t("chat.resultContinue")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
