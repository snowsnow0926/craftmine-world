import { useEffect, useRef, useState } from "react";
import { craftmineWorldBridge } from "./craftmine-worlds";
import { rememberWorldConversation } from "./world-conversation-memory";
import { restoreWorldConversation, useAppStore } from "../stores/app-store";

/** F2 resumes an existing world-bound chat without replacing a player's input. */
export function useWorldConversation(worldActive: boolean, conversationOpen: boolean) {
  const enabled = worldActive && conversationOpen;
  const activeSessionId = useAppStore(state => state.activeSessionId);
  const bridge = useRef(craftmineWorldBridge()).current;
  const generation = useRef(0);
  const [revision, setRevision] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const changed = () => { generation.current++; setRevision(value => value + 1); };
    const off = bridge?.onChanged(changed);
    window.addEventListener("craftmine-world-changed", changed);
    return () => { off?.(); window.removeEventListener("craftmine-world-changed", changed); };
  }, [bridge]);

  useEffect(() => {
    const version = ++generation.current;
    let disposed = false;
    const current = () => !disposed && generation.current === version;
    const state = useAppStore.getState();
    setError("");
    if (!enabled || !bridge || state.activeSessionId || state.selectingSessionId) { setRestoring(false); return; }
    setRestoring(true);
    void (async () => {
      const {activeWorldId} = await bridge.list();
      if (current() && activeWorldId) await restoreWorldConversation(activeWorldId, current);
    })().catch(error => {
      const state = useAppStore.getState();
      if (current() && !state.activeSessionId && !state.selectingSessionId && !/WORLD_CONVERSATION_CHANGED|SELECTED_WORLD_MISMATCH/.test(String(error))) setError("暂时无法恢复这个世界的对话。仍可输入新内容，或从历史记录选择对话。");
    }).finally(() => { if (current()) setRestoring(false); });
    return () => { disposed = true; };
    // Session selection is checked by navigation intent inside the store. A
    // selectingSessionId update from this very recovery must not cancel itself.
  }, [enabled, bridge, revision]);

  useEffect(() => {
    if (!worldActive || !bridge || !activeSessionId) return;
    setError("");
    let disposed = false;
    void (async () => {
      const {activeWorldId} = await bridge.list();
      if (!activeWorldId || disposed || useAppStore.getState().activeSessionId !== activeSessionId) return;
      const result = await bridge.call("world.conversation", {worldId: activeWorldId, sessionId: activeSessionId}) as {worldId?: string; sessionId?: string | null};
      if (!disposed && result.worldId === activeWorldId && result.sessionId === activeSessionId && useAppStore.getState().activeSessionId === activeSessionId) rememberWorldConversation(activeWorldId, activeSessionId);
    })().catch(() => { /* An unverified preference is never persisted. */ });
    return () => { disposed = true; };
  }, [worldActive, bridge, activeSessionId, revision]);
  return {restoring, error};
}
