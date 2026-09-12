import { useEffect, useRef, useState } from "react";
import { useAppStore, createCopiedWorldSession, restoreWorldEntrySession } from "../stores/app-store";
import { craftmineWorldBridge, isWorldPlayable } from "./craftmine-worlds";
import { enterCraftmineMode, openCraftmineModeEntry } from "./craftmine-mode";
import { loadCraftmineLayout, saveCraftmineLayout } from "./craftmine-layout";
import { pluginWorkPanelTab } from "./work-panel-tabs";
import { readLiveComposerDraft, writeComposerDraft } from "./composer-draft-cache";

type DialogueWorld = { phase: "preparing" | "chat" | "error"; worldId?: string; sessionId?: string; error?: string; draft: string; queued: boolean; cancelling?: boolean; submitting?: boolean; resultReady?:boolean };
const DRAFT_KEY = "craftmine.dialogue-preparation-draft.v1";
function retainedDraft(): string { try { return localStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; } }
function retainDraft(text: string): void { try { if(text)localStorage.setItem(DRAFT_KEY,text);else localStorage.removeItem(DRAFT_KEY); } catch { /* The live draft still survives cancellation. */ } }
/** A real independent world and ordinary session; only its presentation is hidden. */
export function useDialogueWorld() {
  const [state, setState] = useState<DialogueWorld | null>(null);
  type Operation = { cancelled: boolean; originalWorld: string | null; originalCaptured?:boolean; originalSession?: string; layout: ReturnType<typeof loadCraftmineLayout>; id: string; worldId?: string; sessionId?: string; draft: string; queued: boolean; submitting?: boolean; cancellation?: Promise<unknown>; cancelError?: unknown; prepare?:()=>Promise<void> };
  const operation = useRef<Operation | null>(null);
  const preparing = useRef<Promise<void> | null>(null);
  const savedDraft = useRef(retainedDraft());
  const bridge = useRef(craftmineWorldBridge()).current;
  const preserveDraft = (text: string) => {savedDraft.current=text;retainDraft(text);};
  const cancelInitialization = async (op: Operation) => {
    if (!op.worldId || !bridge) return;
    op.cancelError=undefined;
    op.cancellation ??= bridge.call("world.creationCancel", {worldId:op.worldId}).catch(error => { op.cancellation = undefined; op.cancelError=error; throw error; });
    await op.cancellation;
  };
  const setDraft = (draft: string) => {
    const op = operation.current;
    if(!op || (op.cancelled&&state?.phase!=="error") || op.queued || op.submitting) return;
    op.draft = draft; preserveDraft(draft); setState(value=>value?{...value,draft}:value);
  };
  const queue = () => {
    const op = operation.current;
    if(!op || op.cancelled || !op.draft.trim() || state?.phase!=="preparing")return;
    op.queued=true;setState(value=>value?{...value,queued:true}:value);
  };
  const editQueued = () => {const op=operation.current;if(!op||op.cancelled||op.submitting)return;op.queued=false;setState(value=>value?{...value,queued:false}:value);};
  const cancel = async () => {
    const op = operation.current;
    if (!op) return;
    op.cancelled = true;
    preserveDraft(op.draft);
    setState(value=>value?{...value,cancelling:true}:value);
    try {
      // Stop only this world's initializer before waiting for its in-flight
      // reply. A create acknowledgement arriving later cancels by the same id.
      await cancelInitialization(op);
      const active=useAppStore.getState();
      if(op.sessionId===active.activeSessionId&&active.isRunning)await active.abort();
      // A pending create/switch/session reply must settle before restoring the
      // original context, otherwise its late commit could steal selection back.
      await preparing.current;
      if(op.cancelError)throw op.cancelError;
      const current = useAppStore.getState();
      if (op.sessionId === current.activeSessionId && current.isRunning) await current.abort();
      if (op.originalWorld && bridge) {
        const result = await bridge.switchWorld(op.originalWorld);
        if (!result.ok) throw Error(result.error);
        window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
      }
      await restoreWorldEntrySession(op.originalSession);
      saveCraftmineLayout(localStorage, op.layout);
      window.dispatchEvent(new CustomEvent("craftmine-layout-changed"));
      operation.current = null; setState(null);
      if (!op.originalWorld) openCraftmineModeEntry();
    } catch (error) { op.queued=false;setState(value => ({...value,draft:op.draft,queued:false, phase: "error", cancelling:false,submitting:false, error: String(error)})); }
  };
  const start = async () => {
    if (operation.current || !bridge) return;
    const op: Operation = {cancelled:false, originalWorld:null, originalSession:useAppStore.getState().activeSessionId, layout:loadCraftmineLayout(localStorage), id:crypto.randomUUID(),draft:savedDraft.current,queued:false};
    operation.current = op;
    setState({phase:"preparing",draft:op.draft,queued:false});
    enterCraftmineMode("create", {explicit:true});
    const prepare = async () => {
    try {
      if(!op.originalCaptured){op.originalWorld = (await bridge.list()).activeWorldId;op.originalCaptured=true;}
      if (op.cancelled) return;
      const created = op.worldId?{id:op.worldId}:await bridge.create({title:"对话生成的世界", baseId:"creation-sandbox", operationId:op.id});
      op.worldId=created.id;
      if(op.cancelled){await cancelInitialization(op);return;}
      // Give the new world its own conversation before preparation completes.
      // The independent input below never borrows the old session's composer.
      op.sessionId??=await createCopiedWorldSession(created.id,op.originalSession);
      if(op.cancelled){await cancelInitialization(op);return;}
      setState(value=>value?{...value,worldId:op.worldId,sessionId:op.sessionId}:value);
      // A navigation reply may only acknowledge creation. The world list
      // carries the factory's durable initialization status; always read it.
      let ready = false;
      while (!ready && !op.cancelled) {
        const list = await bridge.list();
        const world = list.worlds.find(item => item.id === created.id);
        if (!world || world.state === "failed") throw Error(world?.creation?.error?.message || "WORLD_INITIALIZATION_FAILED");
        ready = isWorldPlayable(world);
        if (!ready) await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (op.cancelled) return;
      const selected = await bridge.switchWorld(created.id);
      if (!selected.ok) throw Error(selected.error);
      window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
      if (op.cancelled) return;
      const runtime = await bridge.call("godot.runtimeState", {worldId: created.id}) as {state?: string;worldId?:string};
      if (runtime?.worldId!==created.id || !["ready", "paused", "saved"].includes(runtime?.state ?? "")) throw Error("CREATION_RUNTIME_NOT_READY");
      if (op.cancelled) return;
      const sessionId=op.sessionId;
      if(!sessionId||useAppStore.getState().activeSessionId!==sessionId)throw Error("DIALOGUE_SESSION_CHANGED");
      useAppStore.getState().openWorkPanelTab(pluginWorkPanelTab("craftmine.world", "world"));
      if(op.queued){
        // Use the same opaque host capture as the normal composer. Binding it
        // to this new session prevents a late selection switch from redirecting
        // an explicitly queued request into a different world.
        const capture=await bridge.call("godot.creationTarget",{sessionId}) as {worldId?:string;captureId?:string};
        if(op.cancelled)return;
        if(capture?.worldId!==created.id||!capture.captureId||useAppStore.getState().activeSessionId!==sessionId)throw Error("DIALOGUE_SUBMISSION_CONTEXT_CHANGED");
        if(op.queued){
          op.submitting=true;setState(value=>value?{...value,submitting:true}:value);
          const text=op.draft;
          try{
            const accepted=await useAppStore.getState().sendPrompt(text,{text,fileReferences:[]},sessionId,{creationTarget:{captureId:capture.captureId}});
            if(accepted&&!op.cancelled){op.draft="";preserveDraft("");}
          }finally{op.submitting=false;op.queued=false;}
        }
      }
      if(op.cancelled)return;
      writeComposerDraft(sessionId,{text:op.draft,fileReferences:[]});
      setState({phase:"chat", worldId:created.id, sessionId,draft:op.draft,queued:false});
      // From here the ordinary session composer owns and preserves its draft.
      op.draft="";preserveDraft("");
    } catch (error) { if(!op.cancelled) setState(value => ({...value,draft:op.draft,queued:op.queued,submitting:false, phase:"error", error:String(error)})); }
    };
    op.prepare=prepare;
    const task = prepare();
    preparing.current = task;
    await task;
    if (preparing.current === task) preparing.current = null;
  };
  const retry = async () => {
    const op=operation.current;
    if(!op||op.cancelled||!op.prepare||preparing.current||!bridge||state?.phase!=="error")return;
    setState(value=>value?{...value,phase:"preparing",error:undefined}:value);
    const task=(async()=>{
      try{
        if(op.worldId){
          const selection=await bridge.list();
          if(op.cancelled)return;
          if(selection.activeWorldId!==op.worldId){
            // Selecting a failed placeholder is a host-owned navigation, not
            // an instruction to load its unverified runtime.
            const selected=await bridge.switchWorld(op.worldId);
            if(!selected.ok||selected.activeWorldId!==op.worldId)throw Error(selected.ok?"DIALOGUE_RETRY_SELECTION_CHANGED":selected.error);
            window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
          }
          if(op.cancelled)return;
          op.cancellation=undefined;
          await bridge.creationAction(op.worldId,"retry");
        }
        if(op.cancelled){op.cancellation=undefined;await cancelInitialization(op);return;}
        await op.prepare!();
      }catch(error){if(!op.cancelled)setState(value=>value?{...value,phase:"error",error:String(error)}:value);}
    })();
    preparing.current=task;await task;if(preparing.current===task)preparing.current=null;
  };
  const enterResult = () => {
    if(!state?.resultReady||state.phase!=="chat"||operation.current?.cancelled||useAppStore.getState().activeSessionId!==state.sessionId)return;
    if(state.sessionId)readLiveComposerDraft(state.sessionId);
    operation.current=null;setState(null);enterCraftmineMode("play",{explicit:true});
    useAppStore.getState().showToast("世界已生成，F2 可继续对话",{variant:"success"});
  };
  useEffect(() => {
    const applied = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (state?.phase !== "chat" || operation.current?.cancelled || detail?.worldId !== state.worldId || detail?.sessionId !== state.sessionId || useAppStore.getState().activeSessionId !== state.sessionId) return;
      event.preventDefault();
      const draft=state.sessionId?readLiveComposerDraft(state.sessionId):undefined;
      if(!draft||draft.text.trim()||draft.fileReferences.length){
        setState(value=>value&&!value.resultReady?{...value,resultReady:true}:value);
        return;
      }
      operation.current = null; setState(null); enterCraftmineMode("play", {explicit:true});
      useAppStore.getState().showToast("世界已生成，已进入试玩；F2 查看创作结果", {variant:"success"});
    };
    window.addEventListener("craftmine-dialogue-world-applied", applied);
    return () => window.removeEventListener("craftmine-dialogue-world-applied", applied);
  }, [state]);
  return { state, start, cancel, setDraft, queue, editQueued, retry, enterResult, canRetry:state?.phase==="error"&&!operation.current?.cancelled };
}
