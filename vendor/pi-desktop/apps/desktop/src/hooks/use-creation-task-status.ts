import { useEffect, useMemo, useState } from "react";
import { craftmineWorldBridge } from "../lib/craftmine-worlds";
import { CreationTaskStatusObserver, parseCreationTaskStatus, type CreationTaskStatus } from "../lib/creation-task-status";

export function useCreationTaskStatus(sessionId: string | null, running: boolean) {
  const bridge = useMemo(() => craftmineWorldBridge(), []);
  const [result, setResult] = useState<{sessionId: string | null; status: CreationTaskStatus | null; unavailable: boolean}>({sessionId: null, status: null, unavailable: false});
  useEffect(() => {
    setResult({sessionId, status: null, unavailable: false});
    if (!sessionId || !bridge) return;
    const observer = new CreationTaskStatusObserver(async () => parseCreationTaskStatus(await bridge.call("godot.creationTaskStatus", {sessionId}), sessionId),
      (status, unavailable) => setResult({sessionId, status, unavailable}), running);
    const refresh = () => { setResult({sessionId, status: null, unavailable: false}); void observer.refresh(); };
    const off = bridge.onChanged(refresh);
    window.addEventListener("craftmine-world-changed", refresh);
    window.addEventListener("craftmine-creation-edit-status", refresh);
    void observer.refresh();
    return () => { observer.dispose(); off(); window.removeEventListener("craftmine-world-changed", refresh); window.removeEventListener("craftmine-creation-edit-status", refresh); };
  }, [bridge, sessionId, running]);
  return result.sessionId === sessionId ? result : {sessionId, status: null, unavailable: false};
}
