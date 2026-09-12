import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { useCreationTaskStatus } from "../hooks/use-creation-task-status";
import { creationTaskLabel } from "../lib/creation-task-status";
import { loadCraftmineLayout, setCraftmineOverlay } from "../lib/craftmine-layout";
import "./CraftminePreviewControls.css";

/** Re-read persisted job facts on every session entry; model prose never supplies an action identity. */
export function CraftmineCreationResult({autoOpen = false}: {autoOpen?: boolean}) {
  const sessionId = useAppStore(state => state.activeSessionId) ?? null;
  const running = useAppStore(state => state.isRunning);
  const result = useCreationTaskStatus(sessionId, running);
  const status = result.status;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const context = useRef(sessionId); context.current = sessionId;
  const seen = useRef("");
  const observedSession = useRef<string | null>(null);
  const hasInitialStatus = useRef(false);
  useEffect(() => {setError("");}, [sessionId, status?.jobId]);
  useEffect(() => {
    if(status?.phase === "applied") {
      const consumed = !window.dispatchEvent(new CustomEvent("craftmine-dialogue-world-applied", {
        cancelable: true, detail:{worldId:status.worldId,sessionId:status.sessionId,jobId:status.jobId},
      }));
      // The dialogue flow deliberately enters a playable, closed-overlay world.
      // Record that handoff before autoOpen becomes true on the next render.
      if (consumed) seen.current = `${status.sessionId}:${status.jobId}:${status.phase}`;
    }
  }, [status?.phase, status?.worldId, status?.sessionId, status?.jobId]);
  useEffect(() => {
    if (observedSession.current !== sessionId) {
      observedSession.current = sessionId;
      hasInitialStatus.current = false;
      seen.current = "";
    }
    if (!status) return;
    const key = `${status.sessionId}:${status.jobId}:${status.phase}`;
    // First read after mount/session entry is persisted history. Keep its card
    // available, but do not pause a resumed game to announce an old result.
    if (!hasInitialStatus.current) { hasInitialStatus.current = true; seen.current = key; return; }
    if (seen.current === key) return;
    seen.current = key;
    if (!autoOpen || !["ready", "applied", "failed"].includes(status.phase)) return;
    if (loadCraftmineLayout(localStorage).overlay === "closed") setCraftmineOverlay("compact");
  }, [autoOpen, status, sessionId]);
  const refresh = () => window.dispatchEvent(new Event("craftmine-creation-edit-status"));
  const run = async (action: "open" | "adopt" | "switch") => {
    if (!status || !sessionId || locked.current) return;
    locked.current = true; setPending(true); setError("");
    const owner = sessionId;
    try {
      if (action === "switch") await api.pluginPanelInvoke("craftmine.world", "world.switch", {id: status.worldId});
      else await api.pluginPanelInvoke("craftmine.world", "world.previewControl", {
        action, worldId: status.worldId, sessionId: owner, jobId: status.jobId,
        candidateId: status.candidateId, buildId: status.buildId,
      });
      refresh();
    } catch (failure) {
      if (context.current === owner) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {locked.current = false; setPending(false);}
  };
  if ((!status || status.phase === "idle") && !result.unavailable && !running) return null;
  const differentWorld = !!status && status.selectedWorldId !== undefined && status.selectedWorldId !== status.worldId;
  const actionable = status?.phase === "ready" && !!status.candidateId && !!status.buildId && !!status.jobId && !status.sourceStale;
  return <section className="craftmine-preview-controls craftmine-creation-result no-drag" aria-label="世界创作结果"
    data-session-id={sessionId ?? ""} data-world-id={status?.worldId} data-job-id={status?.jobId}
    data-candidate-id={status?.candidateId} data-build-id={status?.buildId} data-phase={status?.phase ?? "unavailable"}>
    <div className="craftmine-preview-controls-copy">
      <strong>{status && status.phase !== "idle" ? creationTaskLabel(status, true) : running ? "正在创作世界…" : "创作结果暂时无法读取"}</strong>
      {status?.worldTitle && <p>目标世界：{status.worldTitle}</p>}
      {status?.phase === "applied" && <p role="status">{status.laterVersion ? "结果已采用，当前世界还包含后续更新。" : "结果已进入正式世界，世界进度已保留。"}</p>}
      {status?.phase === "applying" && <p role="status">正在保存当前进度、验证并采用结果，请稍候。</p>}
      {status?.phase === "deferred" && <p role="status">当前操作结束、目标世界可用后将自动继续，无需再次点击采用。</p>}
      {status?.phase === "repairing" && <p role="status">正在根据检查结果修复草稿，随后会重新检查并继续。原世界保持可用。</p>}
      {status?.phase === "ready" && <p role="status">{status.sourceStale ? "已有更新的草稿；请继续创作并检查最新版本。" : differentWorld ? "结果已保存。切回目标世界后即可预览或采用。" : "检查结果已保存，可直接试玩，或采用到当前世界。"}</p>}
      {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
      {result.unavailable && <p role="status">正在重新连接并读取真实结果，尚未确认完成。</p>}
    </div>
    <div className="craftmine-preview-controls-actions">
      {differentWorld && <button disabled={pending} onClick={() => void run("switch")}>切换到目标世界</button>}
      {actionable && !differentWorld && <>
        <button disabled={pending} onClick={() => void run("open")}>预览副本</button>
        <button disabled={pending} onClick={() => void run("adopt")}>应用到世界</button>
      </>}
      {(error || result.unavailable || ["failed", "interrupted", "cancelled"].includes(status?.phase ?? "")) && <button disabled={pending} onClick={refresh}>重新读取结果</button>}
    </div>
  </section>;
}
