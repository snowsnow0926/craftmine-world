import { useEffect, useRef, useState } from "react";
import { useAppStore, createCopiedWorldSession, restoreWorldEntrySession } from "../stores/app-store";
import { craftmineWorldBridge, isWorldPlayable } from "./craftmine-worlds";
import { enterCraftmineMode, openCraftmineModeEntry } from "./craftmine-mode";
import { loadCraftmineLayout, saveCraftmineLayout } from "./craftmine-layout";
import { pluginWorkPanelTab } from "./work-panel-tabs";

type DialogueWorld = { phase: "preparing" | "chat" | "error"; worldId?: string; sessionId?: string; error?: string };
/** A real independent world and ordinary session; only its presentation is hidden. */
export function useDialogueWorld() {
  const [state, setState] = useState<DialogueWorld | null>(null);
  const operation = useRef<null | { cancelled: boolean; originalWorld: string | null; originalSession?: string; layout: ReturnType<typeof loadCraftmineLayout>; id: string }>(null);
  const preparing = useRef<Promise<void> | null>(null);
  const bridge = useRef(craftmineWorldBridge()).current;
  const cancel = async () => {
    const op = operation.current;
    if (!op) return;
    op.cancelled = true;
    try {
      // A pending create/switch/session reply must settle before restoring the
      // original context, otherwise its late commit could steal selection back.
      await preparing.current;
      const current = useAppStore.getState();
      if (state?.sessionId === current.activeSessionId && current.isRunning) await current.abort();
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
    } catch (error) { setState(value => ({...value, phase: "error", error: String(error)})); }
  };
  const start = async () => {
    if (operation.current || !bridge) return;
    const op = {cancelled:false, originalWorld:null as string|null, originalSession:useAppStore.getState().activeSessionId, layout:loadCraftmineLayout(localStorage), id:crypto.randomUUID()};
    operation.current = op;
    setState({phase:"preparing"});
    enterCraftmineMode("create", {explicit:true});
    const prepare = async () => {
    try {
      op.originalWorld = (await bridge.list()).activeWorldId;
      if (op.cancelled) return;
      const created = await bridge.create({title:"对话生成的世界", baseId:"creation-sandbox", operationId:op.id});
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
      const runtime = await bridge.call("godot.runtimeState", {worldId: created.id}) as {state?: string};
      if (!["ready", "paused", "saved"].includes(runtime?.state ?? "")) throw Error("CREATION_RUNTIME_NOT_READY");
      const sessionId = await createCopiedWorldSession(created.id, op.originalSession);
      if (op.cancelled) return;
      useAppStore.getState().openWorkPanelTab(pluginWorkPanelTab("craftmine.world", "world"));
      setState({phase:"chat", worldId:created.id, sessionId});
    } catch (error) { if(!op.cancelled) setState(value => ({...value, phase:"error", error:String(error)})); }
    };
    const task = prepare();
    preparing.current = task;
    await task;
    if (preparing.current === task) preparing.current = null;
  };
  useEffect(() => {
    const applied = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (state?.phase !== "chat" || operation.current?.cancelled || detail?.worldId !== state.worldId || detail?.sessionId !== state.sessionId || useAppStore.getState().activeSessionId !== state.sessionId) return;
      event.preventDefault();
      operation.current = null; setState(null); enterCraftmineMode("play", {explicit:true});
      useAppStore.getState().showToast("世界已生成，已进入试玩；F2 查看创作结果", {variant:"success"});
    };
    window.addEventListener("craftmine-dialogue-world-applied", applied);
    return () => window.removeEventListener("craftmine-dialogue-world-applied", applied);
  }, [state]);
  return { state, start, cancel };
}
