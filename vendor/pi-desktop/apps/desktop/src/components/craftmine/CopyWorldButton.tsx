import {useEffect, useRef, useState} from "react";
import type {CraftmineWorldBridge} from "../../lib/craftmine-worlds";

/** The operation id survives a rejected request and is reused by the retry. */
export function CopyWorldButton({bridge, worldId, sessionId, title, disabled = false, onCopied}: {
  bridge: CraftmineWorldBridge | null; worldId: string | null; sessionId?: string; title?: string;
  disabled?: boolean; onCopied?: (worldId: string, sourceSessionId?: string) => void | string | Promise<void | string>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const operation = useRef<{worldId: string; operationId: string; title?: string} | null>(null);
  const active = useRef(false);
  const sourceSession = useRef<string | undefined>(undefined);
  const [handoff, setHandoff] = useState<{worldId:string;sessionId:string} | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    // Selection can change to the pending copy while the host is still building.
    // Keep its retry identity until that request completes.
    if (!active.current && !operation.current) {setError(""); setDone("");}
    return () => {epoch.current++;};
  }, [worldId]);
  async function copy() {
    if (!bridge || !worldId || active.current) return;
    const token = epoch.current;
    if (!operation.current) {
      const name = title ? [...title].slice(0, 76).join("") + " 副本" : undefined;
      sourceSession.current = sessionId;
      operation.current = {worldId, operationId: crypto.randomUUID(), ...(name ? {title: name} : {})};
    }
    active.current = true; setBusy(true); setError(""); setDone(""); setHandoff(null);
    try {
      const result = await bridge.call("world.copy", operation.current) as Record<string, any>;
      if (result?.status !== "ready" || !result.targetWorldId) throw Error(result?.reason || "副本尚未完成独立检查与应用");
      const nextSessionId = await onCopied?.(result.targetWorldId, sourceSession.current);
      operation.current = null;
      if (typeof nextSessionId === "string") setHandoff({worldId:result.targetWorldId,sessionId:nextSessionId});
      if (token === epoch.current || typeof nextSessionId === "string") setDone(typeof nextSessionId === "string" ? "副本已打开，已切换到独立创作会话" : "副本已保存并可游玩");
    } catch (failure) {
      // A host-side selection change does not erase the original retry operation.
      setError(String(failure));
    } finally {active.current = false; setBusy(false);}
  }
  return <span data-godot-copy-world data-copy-target-world={handoff?.worldId} data-copy-session={handoff?.sessionId}>
    <button type="button" disabled={disabled || busy || !bridge || !worldId} onClick={() => void copy()}>
      {busy ? "正在保存并创建副本…" : error ? "重试创建副本" : "复制世界"}
    </button>
    {busy && <span role="status">正在独立构建、检查和保存，请稍候。</span>}
    {error && <span role="alert">{error}</span>}
    {done && <span role="status">{done}</span>}
  </span>;
}
