import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { useCreationTaskStatus } from "../hooks/use-creation-task-status";
import { creationTaskLabel } from "../lib/creation-task-status";
import { loadCraftmineLayout, setCraftmineOverlay } from "../lib/craftmine-layout";
import { readLiveComposerDraft } from "../lib/composer-draft-cache";
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
  const automaticLive = useRef<{sessionId:string|null;worldId?:string;jobId?:string;started:boolean;running?:boolean;consumed?:string}>({sessionId:null,started:false});
  useEffect(() => {setError("");}, [sessionId, status?.jobId]);
  useEffect(() => {
    if(automaticLive.current.sessionId!==sessionId)automaticLive.current={sessionId,started:false};
    const live=automaticLive.current;
    if(running&&!live.running){live.started=true;live.worldId=undefined;live.jobId=undefined;}
    live.running=running;
    if(running&&status?.worldId&&status.selectedWorldId===status.worldId){live.started=true;live.worldId=status.worldId;}
    if(status?.resultRequestRelation==="previous-request")return;
    if(live.started&&status?.resultRequestRelation==="current-request"&&status.selectedWorldId===status.worldId)live.worldId=status.worldId;
    if(live.started&&live.worldId===status?.worldId&&status?.jobId&&(["editing","checking","deferred","repairing","applying"].includes(status.phase)
      ||status.resultRequestRelation==="current-request"&&status.phase==="applied"))live.jobId=status.jobId;
    if(status?.phase === "applied") {
      const consumed = !window.dispatchEvent(new CustomEvent("craftmine-dialogue-world-applied", {
        cancelable: true, detail:{worldId:status.worldId,sessionId:status.sessionId,jobId:status.jobId},
      }));
      // The dialogue flow deliberately enters a playable, closed-overlay world.
      // Record that handoff before autoOpen becomes true on the next render.
      if (consumed) {seen.current = `${status.sessionId}:${status.jobId}:${status.phase}`;return;}
    }
    if(!status||status.phase!=="applied"||status.automaticallyApplied!==true||running||!live.started||live.jobId!==status.jobId||live.worldId!==status.worldId||live.consumed===status.jobId||status.error)return;
    let cancelled=false;
    const invalidate=()=>{cancelled=true;};
    window.addEventListener("craftmine-world-changed",invalidate);
    window.addEventListener("craftmine-layout-changed",invalidate);
    const stillOwned=()=>{
      const state=useAppStore.getState(),session=state.sessions.find(item=>item.id===sessionId),layout=loadCraftmineLayout(localStorage);
      const permission=session?.permissionMode&&session.permissionMode!=="inherit"?session.permissionMode:state.settings?.defaultPermissionMode;
      const draft=sessionId?readLiveComposerDraft(sessionId):undefined;
      return !cancelled&&automaticLive.current===live&&state.activeSessionId===sessionId&&!state.isRunning&&permission==="auto"&&status.selectedWorldId===status.worldId
        &&layout.mode==="play"&&layout.overlay==="compact"&&!!draft&&!draft.text.trim()&&draft.fileReferences.length===0;
    };
    if(stillOwned())void (async()=>{
      try{
        const runtime=await api.pluginPanelInvoke("craftmine.world","godot.runtimeState",{worldId:status.worldId}) as {worldId?:string;buildId?:string;state?:string};
        const selection=await api.pluginPanelInvoke("craftmine.world","world.list",{}) as {activeWorldId?:string};
        if(selection.activeWorldId!==status.worldId)return;
        if(!stillOwned()||runtime?.worldId!==status.worldId||runtime.buildId!==status.buildId||!["ready","paused","saved"].includes(runtime.state??""))return;
        live.consumed=status.jobId;seen.current=`${status.sessionId}:${status.jobId}:${status.phase}`;
        setCraftmineOverlay("closed");useAppStore.getState().showToast("已放入世界，F2 可查看对话",{variant:"success"});
      }catch{/* Preserve the conversation when the real runtime cannot confirm handoff. */}
    })();
    return ()=>{cancelled=true;window.removeEventListener("craftmine-world-changed",invalidate);window.removeEventListener("craftmine-layout-changed",invalidate);};
  }, [status, sessionId, running]);
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
    // A live automatic result belongs in the playable world. Its earlier
    // conversation remains available through F2, without reopening it here.
    if(status.phase==="applied"&&status.automaticallyApplied&&automaticLive.current.jobId===status.jobId)return;
    if (!autoOpen || status.resultRequestRelation==="previous-request" || !["ready", "applied", "failed"].includes(status.phase)) return;
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
    data-candidate-id={status?.candidateId} data-build-id={status?.buildId} data-phase={status?.phase ?? "unavailable"}
    data-request-relation={status?.resultRequestRelation} data-request-turn-id={status?.latestRequest?.turnId}>
    <div className="craftmine-preview-controls-copy">
      <strong>{status && status.phase !== "idle" ? creationTaskLabel(status, true) : running ? "正在创作世界…" : "创作结果暂时无法读取"}</strong>
      {status?.worldTitle && <p>目标世界：{status.worldTitle}</p>}
      {status?.resultRequestRelation === "previous-request" && <p role="status">这是之前的创作结果，本轮尚无新的检查回执。</p>}
      {status?.phase === "applied" && status.resultRequestRelation !== "previous-request" && <p role="status">{status.laterVersion ? "结果已采用，当前世界还包含后续更新。" : "结果已进入正式世界，世界进度已保留。"}</p>}
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
