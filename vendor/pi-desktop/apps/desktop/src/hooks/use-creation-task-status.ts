import { useEffect, useMemo, useRef, useState } from "react";
import { craftmineWorldBridge } from "../lib/craftmine-worlds";
import { CreationTaskStatusObserver, parseCreationTaskStatus, type CreationTaskStatus } from "../lib/creation-task-status";

export function useCreationTaskStatus(sessionId: string | null, running: boolean) {
  const bridge = useMemo(() => craftmineWorldBridge(), []);
  const [result, setResult] = useState<{sessionId: string | null; status: CreationTaskStatus | null; unavailable: boolean; refreshing: boolean}>({sessionId: null, status: null, unavailable: false, refreshing: false});
  const acknowledgedSession = useRef<string | null>(null);
  const observedTask = useRef<{sessionId: string | null; known: boolean}>({sessionId: null, known: false});
  useEffect(() => {
    setResult(previous => ({sessionId, status: previous.sessionId === sessionId ? previous.status : null, unavailable: false, refreshing: true}));
    if (observedTask.current.sessionId !== sessionId) {
      observedTask.current = {sessionId, known: false};
      acknowledgedSession.current = null;
    }
    if (!sessionId || !bridge) return;
    const observer = new CreationTaskStatusObserver(async () => {
      setResult(previous => previous.sessionId === sessionId ? {...previous, refreshing: true} : {sessionId, status: null, unavailable: false, refreshing: true});
      return parseCreationTaskStatus(await bridge.call("godot.creationTaskStatus", {sessionId}), sessionId);
    },
      (status, unavailable) => {
        if (status?.jobId) observedTask.current.known = true;
        // A new idle chat has no result to lose while the parent is still
        // synchronizing its allowed viewing session. Existing/running tasks
        // and errors after acknowledgement retain the ordinary error state.
        const showUnavailable = unavailable && (running || observedTask.current.known || acknowledgedSession.current === sessionId);
        setResult(previous => ({sessionId, status: unavailable && previous.sessionId === sessionId ? previous.status : status, unavailable: showUnavailable, refreshing: false}));
      }, running);
    const refresh = () => { void observer.refresh(); };
    const worldChanged = () => { setResult({sessionId, status: null, unavailable: false, refreshing: true}); void observer.refresh(); };
    const acknowledged = (event: Event) => {
      if ((event as CustomEvent).detail?.sessionId !== sessionId) return;
      acknowledgedSession.current = sessionId;
      refresh();
    };
    const off = bridge.onChanged(refresh);
    window.addEventListener("craftmine-world-changed", worldChanged);
    window.addEventListener("craftmine-creation-edit-status", refresh);
    window.addEventListener("craftmine-viewing-session-ready", acknowledged);
    void observer.refresh();
    return () => { observer.dispose(); off(); window.removeEventListener("craftmine-world-changed", worldChanged); window.removeEventListener("craftmine-creation-edit-status", refresh); window.removeEventListener("craftmine-viewing-session-ready", acknowledged); };
  }, [bridge, sessionId, running]);
  return result.sessionId === sessionId ? result : {sessionId, status: null, unavailable: false, refreshing: true};
}
