import {useEffect, useRef, useState} from "react";
import type {CraftmineWorldBridge} from "../../lib/craftmine-worlds";

/** The operation id survives a rejected request and is reused by the retry. */
export function CopyWorldButton({bridge, worldId, title, disabled = false, onCopied}: {
  bridge: CraftmineWorldBridge | null; worldId: string | null; title?: string;
  disabled?: boolean; onCopied?: (worldId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const operation = useRef<{worldId: string; operationId: string; title?: string} | null>(null);
  const active = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    // Selection can change to the pending copy while the host is still building.
    // Keep its retry identity until that request completes.
    if (!active.current) {operation.current = null; setError(""); setDone("");}
    return () => {epoch.current++;};
  }, [worldId]);
  async function copy() {
    if (!bridge || !worldId || active.current) return;
    const token = epoch.current;
    if (!operation.current) {
      const name = title ? [...title].slice(0, 76).join("") + " 副本" : undefined;
      operation.current = {worldId, operationId: crypto.randomUUID(), ...(name ? {title: name} : {})};
    }
    active.current = true; setBusy(true); setError(""); setDone("");
    try {
      const result = await bridge.call("world.copy", operation.current) as Record<string, any>;
      if (result?.status !== "ready" || !result.targetWorldId) throw Error(result?.reason || "副本尚未完成独立检查与应用");
      operation.current = null;
      if (token === epoch.current) setDone("副本已保存并可游玩");
      onCopied?.(result.targetWorldId);
    } catch (failure) {
      // A host-side selection change does not erase the original retry operation.
      setError(String(failure));
    } finally {active.current = false; setBusy(false);}
  }
  return <span data-godot-copy-world>
    <button type="button" disabled={disabled || busy || !bridge || !worldId} onClick={() => void copy()}>
      {busy ? "正在保存并创建副本…" : error ? "重试创建副本" : "复制世界"}
    </button>
    {busy && <span role="status">正在独立构建、检查和保存，请稍候。</span>}
    {error && <span role="alert">{error}</span>}
    {done && <span role="status">{done}</span>}
  </span>;
}
