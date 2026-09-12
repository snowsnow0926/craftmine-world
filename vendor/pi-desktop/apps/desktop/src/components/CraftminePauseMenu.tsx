import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import "./CraftminePauseMenu.css";

/** Trusted renderer surface; the immersion host pauses the world beneath it. */
export function CraftminePauseMenu({ onResume, onWorkbench, onSettings, runtimeError }: {
  onResume: () => void;
  onWorkbench: () => void;
  onSettings: () => void;
  runtimeError?: string;
}) {
  const { i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  const [error, setError] = useState("");
  const [quitPhase, setQuitPhase] = useState<"confirming" | "saving" | null>(null);
  const pending = useRef(false);
  const attempt = useRef(0);
  const awaitingAttemptAfter = useRef<number | null>(null);
  // An invoke acknowledgement only says app.quit was requested. The host's
  // ordered checkpoint lifecycle owns completion/cancellation of this action.
  useEffect(() => api.onCraftmineQuitState(state => {
    if (!Number.isSafeInteger(state?.attemptId) || state.attemptId < attempt.current || state.attemptId < 1
      || (awaitingAttemptAfter.current !== null && state.attemptId <= awaitingAttemptAfter.current)
      || !["confirming", "saving", "failed", "cancelled"].includes(state.phase)) return;
    awaitingAttemptAfter.current = null;
    attempt.current = state.attemptId;
    const busy = state.phase === "confirming" || state.phase === "saving";
    pending.current = busy;
    setQuitPhase(busy ? state.phase as "confirming" | "saving" : null);
    setError(state.phase === "failed" ? (state.error || (chinese ? "世界尚未保存，已暂停退出。请重试。" : "Your world has not been saved. Quitting was stopped; please retry.")) : "");
  }), [chinese]);
  const quit = () => {
    if (pending.current) return;
    pending.current = true;setQuitPhase("confirming");setError("");
    const before = attempt.current;
    awaitingAttemptAfter.current = before;
    void api.nativeMenuAction("quit").catch(() => {
      // If a lifecycle event already arrived, its state is more authoritative
      // than a delayed transport failure for the original request.
      if (attempt.current !== before) return;
      awaitingAttemptAfter.current = null;pending.current = false;setQuitPhase(null);
      setError(chinese ? "未能请求保存并退出，请重试。" : "Could not request save and exit. Please retry.");
    });
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!pending.current) onResume();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onResume]);
  return <div className="craftmine-pause-backdrop" data-craftmine-pause>
    <section className="craftmine-pause-menu no-drag" role="dialog" aria-modal="true" aria-labelledby="craftmine-pause-title">
      <h1 id="craftmine-pause-title">{chinese ? "已暂停" : "Paused"}</h1>
      <button type="button" data-pause-action="resume" disabled={!!quitPhase} onClick={() => {if (!pending.current) onResume();}}>{chinese ? "继续游玩" : "Resume"}</button>
      <button type="button" data-pause-action="workbench" disabled={!!quitPhase} onClick={() => {if (!pending.current) onWorkbench();}}>{chinese ? "切换世界" : "Switch world"}</button>
      <button type="button" data-pause-action="settings" disabled={!!quitPhase} onClick={() => {if (!pending.current) onSettings();}}>{chinese ? "设置" : "Settings"}</button>
      <button type="button" data-pause-action="exit" disabled={!!quitPhase} onClick={quit}>{chinese ? "保存并退出" : "Save and exit"}</button>
      {quitPhase && <p role="status" data-quit-phase={quitPhase}>{quitPhase === "saving"
        ? chinese ? "正在保存世界并退出…" : "Saving your world and exiting…"
        : chinese ? "正在确认退出…" : "Waiting for quit confirmation…"}</p>}
      {(error || runtimeError) && <p role="alert">{error || runtimeError}</p>}
      {!quitPhase && <small>{chinese ? "Esc 继续游玩" : "Esc to resume"}</small>}
    </section>
  </div>;
}
