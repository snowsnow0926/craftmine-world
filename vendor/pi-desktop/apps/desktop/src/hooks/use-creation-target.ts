import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { craftmineWorldBridge } from "../lib/craftmine-worlds";
import { parseCreationTarget, type CreationTargetCapture } from "../lib/creation-target";
import { useAppStore } from "../stores/app-store";

export function useCreationTarget(enabled: boolean, sessionKey: string, sessionId: string | null = sessionKey) {
  const permissionRevision=useAppStore(state=>`${state.settings?.defaultPermissionMode??"ask"}:${state.sessions.find(item=>item.id===sessionId)?.permissionMode??state.draftConfiguration?.permissionMode??"inherit"}`);
  const bridge = useMemo(() => craftmineWorldBridge(), []);
  const [capture, setCapture] = useState<CreationTargetCapture | null>(null);
  const [captureSessionKey, setCaptureSessionKey] = useState(sessionKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState<{worldId: string; autoApply: boolean; fullAuto?:boolean} | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState("");
  const epoch = useRef(0);
  const policyEpoch = useRef(0);
  const readTarget = useCallback(async (selection?:{worldId:string;entityId:string}|null) => {
    const generation = ++epoch.current;
    ++policyEpoch.current;
    setCapture(null); setPolicy(null); setError(""); setPolicyError(""); setPolicyBusy(false);
    if (!enabled || !bridge) { setLoading(false); return; }
    setLoading(true);
    try {
      const next = parseCreationTarget(await bridge.call("godot.creationTarget", {sessionId,...(selection!==undefined?{selection}:{})}));
      if (generation !== epoch.current) return;
      setCapture(next);
      setCaptureSessionKey(sessionKey);
      // A policy is only shown for the same world returned by target sampling.
      const result = await bridge.call("godot.creationPolicy", {sessionId}).catch(() => null) as {worldId?: unknown; autoApply?: unknown; fullAuto?:unknown} | null;
      if (generation !== epoch.current) return;
      if (result && next.worldId && result.worldId === next.worldId && typeof result.autoApply === "boolean") setPolicy({worldId: next.worldId, autoApply: result.autoApply,fullAuto:result.fullAuto===true});
    } catch (failure) {
      if (generation === epoch.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  }, [bridge, enabled, sessionKey, sessionId, permissionRevision]);
  const refresh=useCallback(()=>readTarget(),[readTarget]);
  const useRay=useCallback(()=>readTarget(null),[readTarget]);
  const selectRecent=useCallback((entityId:string)=>{
    if(!capture?.worldId||loading)return Promise.resolve();
    return readTarget({worldId:capture.worldId,entityId});
  },[capture?.worldId,loading,readTarget]);
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    const off = bridge?.onChanged(changed);
    window.addEventListener("craftmine-world-changed", changed);
    return () => { ++epoch.current; ++policyEpoch.current; off?.(); window.removeEventListener("craftmine-world-changed", changed); };
  }, [bridge, refresh]);
  const changePolicy = async (autoApply: boolean) => {
    if (!bridge || !policy || policyBusy) return;
    const generation = ++policyEpoch.current, currentWorldId = policy.worldId;
    setPolicyBusy(true); setPolicyError("");
    try {
      const result = await bridge.call("godot.creationPolicy", {worldId: currentWorldId, autoApply,sessionId}) as {worldId?: unknown; autoApply?: unknown; fullAuto?:unknown};
      if (generation !== policyEpoch.current) return;
      if (result?.worldId !== currentWorldId || typeof result.autoApply !== "boolean") throw new Error("CREATION_POLICY_WORLD_CHANGED");
      setPolicy({worldId: currentWorldId, autoApply: result.autoApply,fullAuto:result.fullAuto===true});
    } catch (failure) {
      if (generation === policyEpoch.current) setPolicyError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (generation === policyEpoch.current) setPolicyBusy(false); }
  };
  return { sessionId, capture: enabled && captureSessionKey === sessionKey ? capture : null, loading, error, available: !!bridge, refresh, useRay, selectRecent, policy: enabled && captureSessionKey === sessionKey ? policy : null, policyBusy, policyError, changePolicy };
}
