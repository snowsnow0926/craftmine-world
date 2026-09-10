import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { craftmineWorldBridge } from "../lib/craftmine-worlds";
import { parseCreationTarget, type CreationTargetCapture } from "../lib/creation-target";

export function useCreationTarget(enabled: boolean, sessionKey: string, sessionId: string | null = sessionKey) {
  const bridge = useMemo(() => craftmineWorldBridge(), []);
  const [capture, setCapture] = useState<CreationTargetCapture | null>(null);
  const [captureSessionKey, setCaptureSessionKey] = useState(sessionKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState<{worldId: string; autoApply: boolean} | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState("");
  const epoch = useRef(0);
  const policyEpoch = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++epoch.current;
    ++policyEpoch.current;
    setCapture(null); setPolicy(null); setError(""); setPolicyError(""); setPolicyBusy(false);
    if (!enabled || !bridge) { setLoading(false); return; }
    setLoading(true);
    try {
      const next = parseCreationTarget(await bridge.call("godot.creationTarget", {sessionId}));
      if (generation !== epoch.current) return;
      setCapture(next);
      setCaptureSessionKey(sessionKey);
      // A policy is only shown for the same world returned by target sampling.
      const result = await bridge.call("godot.creationPolicy", {}).catch(() => null) as {worldId?: unknown; autoApply?: unknown} | null;
      if (generation !== epoch.current) return;
      if (result && next.worldId && result.worldId === next.worldId && typeof result.autoApply === "boolean") setPolicy({worldId: next.worldId, autoApply: result.autoApply});
    } catch (failure) {
      if (generation === epoch.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  }, [bridge, enabled, sessionKey, sessionId]);
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
      const result = await bridge.call("godot.creationPolicy", {worldId: currentWorldId, autoApply}) as {worldId?: unknown; autoApply?: unknown};
      if (generation !== policyEpoch.current) return;
      if (result?.worldId !== currentWorldId || typeof result.autoApply !== "boolean") throw new Error("CREATION_POLICY_WORLD_CHANGED");
      setPolicy({worldId: currentWorldId, autoApply: result.autoApply});
    } catch (failure) {
      if (generation === policyEpoch.current) setPolicyError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (generation === policyEpoch.current) setPolicyBusy(false); }
  };
  return { capture: enabled && captureSessionKey === sessionKey ? capture : null, loading, error, available: !!bridge, refresh, policy: enabled && captureSessionKey === sessionKey ? policy : null, policyBusy, policyError, changePolicy };
}
