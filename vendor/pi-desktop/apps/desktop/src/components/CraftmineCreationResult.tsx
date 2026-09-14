import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { useCreationTaskStatus } from "../hooks/use-creation-task-status";
import { canUseCreationResult, creationResultError, creationTaskEvidence, creationTaskLabel } from "../lib/creation-task-status";
import { enterCraftmineMode } from "../lib/craftmine-mode";
import { loadCraftmineLayout, setCraftmineOverlay } from "../lib/craftmine-layout";
import { readLiveComposerDraft } from "../lib/composer-draft-cache";
import "./CraftminePreviewControls.css";

/** Re-read persisted job facts on every session entry; model prose never supplies an action identity. */
export function CraftmineCreationResult({autoOpen = false}: {autoOpen?: boolean}) {
  const {i18n} = useTranslation();
  const chinese = (i18n.language ?? "zh-CN").startsWith("zh");
  const text = (zh:string,en:string) => chinese ? zh : en;
  const sessionId = useAppStore(state => state.activeSessionId) ?? null;
  const running = useAppStore(state => state.isRunning);
  const result = useCreationTaskStatus(sessionId, running);
  const status = result.status;
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<"open"|"adopt"|"switch"|"play"|"checks"|null>(null);
  const pending = pendingAction !== null;
  const locked = useRef(false);
  const pendingOwner = useRef("");
  const context = useRef(""); context.current = `${sessionId}:${status?.worldId}:${status?.jobId}`;
  const confirmation = useRef(result); confirmation.current = result;
  const seen = useRef("");
  const observedSession = useRef<string | null>(null);
  const hasInitialStatus = useRef(false);
  const automaticLive = useRef<{sessionId:string|null;worldId?:string;jobId?:string;started:boolean;running?:boolean;consumed?:string}>({sessionId:null,started:false});
  useEffect(() => {setError("");}, [sessionId, status?.worldId, status?.jobId]);
  useEffect(() => {
    if(automaticLive.current.sessionId!==sessionId)automaticLive.current={sessionId,started:false};
    const live=automaticLive.current;
    if(running&&!live.running){live.started=true;live.worldId=undefined;live.jobId=undefined;}
    live.running=running;
    if(result.refreshing || result.unavailable)return;
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
      return !cancelled&&!confirmation.current.refreshing&&!confirmation.current.unavailable&&confirmation.current.status===status&&automaticLive.current===live&&state.activeSessionId===sessionId&&!state.isRunning&&permission==="auto"&&status.selectedWorldId===status.worldId
        &&layout.mode==="play"&&layout.overlay==="compact"&&!!draft&&!draft.text.trim()&&draft.fileReferences.length===0;
    };
    if(stillOwned())void (async()=>{
      try{
        const runtime=await api.pluginPanelInvoke("craftmine.world","godot.runtimeState",{worldId:status.worldId}) as {worldId?:string;buildId?:string;state?:string};
        const selection=await api.pluginPanelInvoke("craftmine.world","world.list",{}) as {activeWorldId?:string};
        if(selection.activeWorldId!==status.worldId)return;
        if(!stillOwned()||runtime?.worldId!==status.worldId||runtime.buildId!==status.buildId||!["ready","paused","saved"].includes(runtime.state??""))return;
        live.consumed=status.jobId;seen.current=`${status.sessionId}:${status.jobId}:${status.phase}`;
        setCraftmineOverlay("closed");useAppStore.getState().showToast(text("已放入世界，F2 可查看对话","Added to the world. Press F2 to view the conversation."),{variant:"success"});
      }catch{/* Preserve the conversation when the real runtime cannot confirm handoff. */}
    })();
    return ()=>{cancelled=true;window.removeEventListener("craftmine-world-changed",invalidate);window.removeEventListener("craftmine-layout-changed",invalidate);};
  }, [status, sessionId, running, result.refreshing, result.unavailable, chinese]);
  useEffect(() => {
    if (observedSession.current !== sessionId) {
      observedSession.current = sessionId;
      hasInitialStatus.current = false;
      seen.current = "";
    }
    if (!status || result.refreshing || result.unavailable) return;
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
  }, [autoOpen, status, sessionId, result.refreshing, result.unavailable]);
  const refresh = () => window.dispatchEvent(new Event("craftmine-creation-edit-status"));
  const run = async (action: "open" | "adopt" | "switch" | "play" | "checks") => {
    if (!status || !sessionId || locked.current || result.refreshing || result.unavailable) return;
    if(confirmation.current.status!==status||confirmation.current.refreshing||confirmation.current.unavailable)return;
    if((action==="open"||action==="adopt")&&status.phase!=="ready"||action==="play"&&status.phase!=="applied")return;
    if(["open","adopt","play"].includes(action)&&!canUseCreationResult(status,{running,...result}))return;
    if(action!=="switch"&&status.selectedWorldId!==status.worldId)return;
    locked.current = true; setPendingAction(action); setError("");
    const owner = context.current;
    pendingOwner.current = owner;
    try {
      if (action === "switch") await api.pluginPanelInvoke("craftmine.world", "world.switch", {id: status.worldId});
      else if(action === "play" || action === "checks") {
        await api.pluginPanelInvoke("craftmine.world", "world.surface", {surface:{kind:action === "play" ? "world" : "checks"},section:action === "play" ? "world" : "checks"});
        if(context.current!==owner)return;
        enterCraftmineMode(action === "play" ? "play" : "create",{explicit:true});
        if(action === "play")setCraftmineOverlay("closed");
      }
      else await api.pluginPanelInvoke("craftmine.world", "world.previewControl", {
        action, worldId: status.worldId, sessionId, jobId: status.jobId,
        candidateId: status.candidateId, buildId: status.buildId,
      });
      refresh();
    } catch (failure) {
      if (context.current === owner) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {locked.current = false; setPendingAction(null);}
  };
  if ((!status || status.phase === "idle") && !result.unavailable && !running) return null;
  const differentWorld = !!status && status.selectedWorldId !== undefined && status.selectedWorldId !== status.worldId;
  const fresh = canUseCreationResult(status,{running,...result});
  const actionable = status?.phase === "ready" && !!status.candidateId && fresh && status.requirementStatus!=="failed";
  const rawError = error || status?.error;
  const disabled = pending || result.refreshing || result.unavailable;
  return <section className="craftmine-preview-controls craftmine-creation-result no-drag" aria-label={text("世界创作结果","World creation result")} aria-busy={pending || result.refreshing}
    data-session-id={sessionId ?? ""} data-world-id={status?.worldId} data-job-id={status?.jobId}
    data-candidate-id={status?.candidateId} data-build-id={status?.buildId} data-phase={status?.phase ?? "unavailable"}
    data-confirmation={result.unavailable ? "unavailable" : result.refreshing ? "refreshing" : "current"}
    data-request-relation={status?.resultRequestRelation} data-request-turn-id={status?.latestRequest?.turnId}>
    <div className="craftmine-preview-controls-copy">
      <strong>{result.unavailable ? text("需处理 · 结果暂不可用","Needs attention · result unavailable") : pendingAction==="adopt" && pendingOwner.current===context.current ? text("应用中","Applying") : status && status.phase !== "idle" ? creationTaskLabel(status, chinese) : running ? text("正在创作世界…","Creating world…") : text("创作结果暂时无法读取","Creation result unavailable")}</strong>
      {status?.worldTitle && <p>{text("目标世界：","World: ")}{status.worldTitle}</p>}
      {pending && pendingOwner.current!==context.current && <p role="status">{text("等待上次操作结束…","Waiting for the previous operation…")}</p>}
      {status?.resultRequestRelation === "previous-request" && <p role="status">{text("这是之前的结果，本轮尚无新的检查回执。","This is a previous result; no new check is recorded for this request.")}</p>}
      {status?.resultRequestRelation === "unresolved" && <p role="status">{text("尚不能确认此结果属于本轮请求。","This result has not been matched to the current request.")}</p>}
      {status?.phase === "applied" && status.laterVersion && <p>{text("当前世界还包含后续更新。","The current world also contains later changes.")}</p>}
      {status?.phase === "applying" && <p role="status">{text("正在处理保存与应用，请稍候。","Saving and applying the result. Please wait.")}</p>}
      {status?.phase === "deferred" && <p role="status">{text("世界可用后将自动继续，无需重复应用。","Application will continue when the world is available.")}</p>}
      {status?.phase === "repairing" && <p role="status">{text("正在修复草稿，随后重新检查。","Repairing the draft before another check.")}</p>}
      {status?.phase === "ready" && differentWorld && <p>{text("切回目标世界后可查看结果。","Switch to the target world to view this result.")}</p>}
      {rawError && <p role="alert">{creationResultError(rawError,chinese)}</p>}
      {result.unavailable ? <p role="status">{text("最新结果尚未确认，请重新读取。","The latest result is unconfirmed. Refresh to check.")}</p> : result.refreshing && <p role="status">{text("正在确认最新结果…","Confirming the latest result…")}</p>}
      {(rawError || status && ["ready","applied","historical","failed"].includes(status.phase)) && <details className="creation-result-details">
        <summary>{text("检查与诊断详情","Check and diagnostic details")}</summary>
        {status && <p>{creationTaskEvidence(status,chinese)}</p>}
        {rawError && <pre>{rawError}</pre>}
      </details>}
    </div>
    <div className="craftmine-preview-controls-actions">
      {differentWorld && <button disabled={disabled || running} onClick={() => void run("switch")}>{text("切换到目标世界","Switch to target world")}</button>}
      {status?.phase==="ready" && !!status.candidateId && !differentWorld && <>
        <button className="primary" disabled={!actionable || disabled} onClick={() => void run("open")}>{text("试玩副本","Try preview")}</button>
        <button disabled={!actionable || disabled} onClick={() => void run("adopt")}>{text("应用到世界","Add to world")}</button>
      </>}
      {status?.phase==="applied" && !differentWorld && <button className="primary" disabled={!fresh || disabled} onClick={()=>void run("play")}>{text("进入世界试玩","Try in world")}</button>}
      {status && !differentWorld && (["failed","interrupted","historical"].includes(status.phase)||status.phase==="ready"&&!status.candidateId) && <button className="primary" disabled={disabled} onClick={()=>void run("checks")}>{text("查看检查记录","View checks")}</button>}
      {(rawError || result.unavailable || status?.sourceStale || ["failed", "interrupted", "cancelled"].includes(status?.phase ?? "")) && <button disabled={pending || result.refreshing} onClick={refresh}>{text("重新读取结果","Refresh result")}</button>}
    </div>
  </section>;
}
