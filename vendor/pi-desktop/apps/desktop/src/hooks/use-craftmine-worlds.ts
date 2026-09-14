import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  craftmineWorldBridge,
  creationActions,
  hasInitializingWorld,
  isWorldPlayable,
  planWorldSwitch,
  parseWorldList,
  worldErrorMessage,
  type CraftmineActiveTask,
  type CraftmineCreationAction,
  type CraftmineLang,
  type CraftmineWorldBridge,
  type CraftmineWorldCapabilities,
  type CraftmineWorldCreateInput,
  type CraftmineWorldEntry,
} from "../lib/craftmine-worlds";
import { CRAFTMINE_WORLD_TEXT } from "../lib/craftmine-worlds-text";

export type CraftmineWorldsStatus = "loading" | "ready" | "unavailable" | "error";

export type CraftmineWorldsController = {
  status: CraftmineWorldsStatus;
  worlds: CraftmineWorldEntry[];
  archivedWorlds: CraftmineWorldEntry[];
  removeFailedWorld: (id: string) => Promise<void>;
  restoreWorld: (id: string) => Promise<void>;
  activeWorldId: string | null;
  activeWorld: CraftmineWorldEntry | null;
  capabilities: CraftmineWorldCapabilities | null;
  activeTask: CraftmineActiveTask | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
  bridge: CraftmineWorldBridge | null;
  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  continuePreparation: (id: string) => Promise<void>;
  create: (input: CraftmineWorldCreateInput, onReady?: (worldId: string) => Promise<void>) => Promise<boolean>;
  creationAction: (worldId: string, action: CraftmineCreationAction) => Promise<void>;
  clearMessages: () => void;
  cancelCreate: () => Promise<boolean>;
  canCancelCreate: boolean;
  createAttempt: { worldId: string | null; input: CraftmineWorldCreateInput } | null;
};

/** Bounded polling while a world initializes: ~5 minutes, then the player refreshes. */
export const CRAFTMINE_CREATION_POLL_MS = 2500;
export const CRAFTMINE_CREATION_POLL_LIMIT = 120;

/**
 * Loads the real world list from the host and performs selection through the
 * host's save-then-open switch. Selection never touches the PI session, so a
 * running task keeps the world it was bound to.
 */
export function useCraftmineWorlds(lang: CraftmineLang): CraftmineWorldsController {
  const bridge = useMemo(() => craftmineWorldBridge(), []);
  const [status, setStatus] = useState<CraftmineWorldsStatus>("loading");
  const [worlds, setWorlds] = useState<CraftmineWorldEntry[]>([]);
  const [archivedWorlds, setArchivedWorlds] = useState<CraftmineWorldEntry[]>([]);
  const [activeWorldId, setActiveWorldId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<CraftmineWorldCapabilities | null>(null);
  const [activeTask, setActiveTask] = useState<CraftmineActiveTask | null>(null);
  // A load failure and an action failure are different: a successful re-list
  // must not erase the reason a create or switch failed.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // React state is not synchronous: two dispatches in the same task would both
  // read `busy === false`. The ref is set before the first await.
  const busyRef = useRef(false);
  const createCancelled = useRef(false);
  type CreateOperation = {worldId: string | null; previous: string | null; needsCancel: boolean; done: Promise<boolean>; finish: (result: boolean) => void};
  const pendingCreate = useRef<CreateOperation | null>(null);
  const cancelRetry = useRef<CreateOperation | null>(null);
  const [canCancelCreate, setCanCancelCreate] = useState(false);
  const [createAttempt, setCreateAttempt] = useState<{worldId:string|null;input:CraftmineWorldCreateInput} | null>(null);
  const createAttemptRef = useRef<{input:CraftmineWorldCreateInput;worldId:string|null;previous:string|null} | null>(null);
  const epoch = useRef(0);
  const alive = useRef(true);
  const activeWorldIdRef = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    activeWorldIdRef.current = activeWorldId;
  }, [activeWorldId]);

  const refresh = useCallback(async () => {
    if (!bridge) {
      setStatus("unavailable");
      return;
    }
    const generation = ++epoch.current;
    const current = () => alive.current && generation === epoch.current;
    try {
      const list = await bridge.list();
      if (!current()) return;
      // The playable list is authoritative on its own. Optional task/archive
      // reads must not hold entry, cancellation or a failed switch's busy lock.
      if (activeWorldIdRef.current !== list.activeWorldId) {
        setActiveTask(null);
        setCapabilities(null);
      }
      activeWorldIdRef.current = list.activeWorldId;
      setWorlds(list.worlds);
      setActiveWorldId(list.activeWorldId);
      setStatus("ready");
      setLoadError(null);
      setDetailError(null);
      // Metadata remains scoped to this exact refresh/selection. Starting a
      // newer read invalidates late replies without withholding the world list.
      void (async () => {
        const caps = await bridge.capabilities(list.activeWorldId).catch(() => null);
        if (!current()) return;
        setCapabilities(caps);
        try {
          const archived = caps?.archiveFailed ? parseWorldList(await bridge.call("world.archivedList")).worlds : [];
          if (current()) setArchivedWorlds(archived);
        } catch (failure) {
          if (current()) setDetailError(worldErrorMessage(failure, lang));
        }
      })();
      if (list.activeWorldId) {
        void bridge.activeTask(list.activeWorldId).catch(() => null).then(task => {
          if (current()) setActiveTask(task);
        });
      }
    } catch (failure) {
      if (!current()) return;
      setStatus("error");
      setLoadError(worldErrorMessage(failure, lang));
    }
  }, [bridge, lang]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!bridge) return;
    const sync = () => void refresh();
    window.addEventListener("craftmine-world-changed", sync);
    // The world view can change the active world on its own; refresh then too.
    const off = bridge.onChanged(sync);
    return () => {
      window.removeEventListener("craftmine-world-changed", sync);
      off();
    };
  }, [bridge, refresh]);

  const select = useCallback(
    async (id: string, resumeInitialization = false) => {
      if (!bridge || busyRef.current) return;
      setNotice(null);
      setActionError(null);
      const target = worlds.find((entry) => entry.id === id);
      if (resumeInitialization && (!target || target.state !== "initializing")) return;
      if (target && !isWorldPlayable(target) && !resumeInitialization) {
        // The host registered the world but has not finished initializing it;
        // opening it would leave the view on a world it cannot run.
        setNotice(CRAFTMINE_WORLD_TEXT.creationNotPlayable[lang]);
        return;
      }
      const plan = planWorldSwitch({
        activeWorldId,
        targetId: id,
        targetState: target?.state,
        resumeInitialization,
        busy: busyRef.current,
        saving: busyRef.current,
        switchSupported: capabilities?.switch ?? null,
        activeTask,
      });
      if (plan.kind === "noop") return;
      if (plan.kind === "blocked") {
        setNotice(
          plan.reason === "unsupported"
            ? CRAFTMINE_WORLD_TEXT.unsupported[lang]
            : CRAFTMINE_WORLD_TEXT.busy[lang],
        );
        return;
      }
      busyRef.current = true;
      setBusy(true);
      if (plan.taskStaysInWorld) setNotice(CRAFTMINE_WORLD_TEXT.taskStays[lang]);
      try {
        // Explicit preparation of the selected world must carry recovery
        // intent. A same-world switch only reads runtime status and therefore
        // cannot resume an interrupted durable workspace on the player's behalf.
        const result = resumeInitialization && id === activeWorldId
          ? {ok: true as const, activeWorldId: id}
          : await bridge.switchWorld(id);
        if (!result.ok) {
          // The host kept the previous world; keep showing it as active.
          setActionError(`${CRAFTMINE_WORLD_TEXT.switchFailed[lang]} ${worldErrorMessage(result.error, lang)}`);
          return;
        }
        if (resumeInitialization) {
          const latest = await bridge.list();
          const current = latest.worlds.find(entry => entry.id === id);
          if (latest.activeWorldId !== id || !current) throw Error("WORLD_INITIALIZATION_IDENTITY_CHANGED");
          if (current.state !== "ready") {
            if (!target?.creation?.operationId || current.creation?.operationId !== target.creation.operationId) throw Error("WORLD_INITIALIZATION_IDENTITY_CHANGED");
            if (current.state !== "initializing") throw Error("WORLD_INITIALIZATION_STATE_CHANGED");
            await bridge.creationAction(id, "retry");
          }
        }
        setActiveWorldId(result.activeWorldId);
        if (resumeInitialization) setNotice(lang === "zh" ? "已继续准备这个世界，完成后即可进入。" : "Preparation resumed. You can enter when this world is ready.");
        window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
      } catch (failure) {
        setActionError(`${CRAFTMINE_WORLD_TEXT.switchFailed[lang]} ${worldErrorMessage(failure, lang)}`);
      } finally {
        // Stay busy until the refreshed list reflects the result, so the panel
        // never re-enables against stale state.
        try {
          await refresh();
        } finally {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [activeTask, activeWorldId, bridge, capabilities, lang, refresh, worlds],
  );

  const cancelCreatedWorld = useCallback(async (operation: CreateOperation): Promise<boolean> => {
    try {
      if (!bridge || !operation.worldId) throw Error(CRAFTMINE_WORLD_TEXT.createCancelUnconfirmed[lang]);
      if (operation.needsCancel) await bridge.call("world.creationCancel", {worldId: operation.worldId});
      if (operation.previous) {
        const restored = await bridge.switchWorld(operation.previous);
        if (!restored.ok) throw Error(restored.error);
        window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
      }
      cancelRetry.current = null;createAttemptRef.current=null;setCreateAttempt(null);setCanCancelCreate(false);setNotice(CRAFTMINE_WORLD_TEXT.createCancelled[lang]);return true;
    } catch (failure) {
      cancelRetry.current = operation;setCanCancelCreate(true);setActionError(worldErrorMessage(failure, lang));return false;
    }
  }, [bridge, lang]);

  const create = useCallback(
    async (input: CraftmineWorldCreateInput, onReady?: (worldId: string) => Promise<void>) => {
      if (!bridge || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setActionError(null);
      setNotice(null);
      const retained = createAttemptRef.current;
      const retrying = !!retained;
      const attempt = retained ?? {input:{...input},worldId:null,previous:activeWorldIdRef.current};
      createAttemptRef.current = attempt;
      setCreateAttempt({worldId:attempt.worldId,input:attempt.input});
      const previous = attempt.previous;
      createCancelled.current = false;
      setCanCancelCreate(true);
      let completed = false;
      let finish!: (result: boolean) => void;
      const operation: CreateOperation = {worldId: attempt.worldId, previous, needsCancel: true, done: new Promise(resolve => {finish = resolve;}), finish: result => finish(result)};
      pendingCreate.current = operation;cancelRetry.current = null;
      try {
        if (!attempt.worldId) {
          // An uncertain acknowledgement is recovered using the exact original
          // operation. Only the host can confirm its registered world identity.
          const receipt = await bridge.create(attempt.input);
          operation.worldId = attempt.worldId = receipt.id;
          operation.needsCancel = receipt.state !== "ready";
          setCreateAttempt({worldId:receipt.id,input:attempt.input});
        }
        let createdList = await bridge.list();
        let created = createdList.worlds.find(world => world.id === attempt.worldId);
        if (!created) throw Error("CREATED_WORLD_NOT_FOUND");
        if (retrying && created.state === "failed" && !createCancelled.current) {
          if (!creationActions(created.creation).includes("retry")) throw Error("WORLD_RETRY_UNAVAILABLE");
          // Retry is a separate explicit initialization action, never another
          // world.create call with edited attributes on an existing operation.
          if (createdList.activeWorldId !== created.id) {
            const selected = await bridge.switchWorld(created.id);
            if (!selected.ok) throw Error(selected.error);
            if (selected.activeWorldId !== created.id) throw Error("GODOT_WORLD_CHANGED");
          }
          if (createCancelled.current) return false;
          await bridge.creationAction(created.id, "retry");
          createdList = await bridge.list();
          created = createdList.worlds.find(world => world.id === attempt.worldId);
          if (!created) throw Error("CREATED_WORLD_NOT_FOUND");
        }
        // A world that is still initializing (or failed to initialize) is
        // registered but not playable. Do not switch the running view into it:
        // the row keeps showing the host's real progress until it is ready.
        if (created.state !== "ready") {
          setNotice(CRAFTMINE_WORLD_TEXT.createInitializing[lang]);
          let entry = created;
          while (entry.state !== "ready") {
            if (!alive.current || createCancelled.current) return false;
            if (entry.state === "failed") throw Error(entry.creation?.error?.message || "WORLD_INITIALIZATION_FAILED");
            await new Promise(resolve => setTimeout(resolve, CRAFTMINE_CREATION_POLL_MS));
            if (!alive.current || createCancelled.current) return false;
            const list = await bridge.list();
            const found = list.worlds.find(world => world.id === created.id);
            if (!found) throw Error("CREATED_WORLD_NOT_FOUND");
            entry = found;
            await refresh();
          }
        }
        if (!alive.current || createCancelled.current) return false;
        operation.needsCancel = false;
        setCanCancelCreate(false);
        const result = await bridge.switchWorld(created.id);
        if (!result.ok) {
          // The world exists, but the running view could not switch to it.
          // Put the host selection back so the list and the view agree, and
          // keep the form open with the real host error.
          if (previous) await bridge.call("world.open", { id: previous }).catch(() => {});
          setActionError(`${CRAFTMINE_WORLD_TEXT.switchFailed[lang]} ${worldErrorMessage(result.error, lang)}`);
          cancelRetry.current = operation;
          return false;
        }
        setActiveWorldId(result.activeWorldId);
        window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
        await onReady?.(result.activeWorldId);
        createAttemptRef.current=null;setCreateAttempt(null);
        completed = true;
        return true;
      } catch (failure) {
        // These validations run before host registration. Other errors can
        // hide a committed create and must retain the original request.
        if (!retrying && !attempt.worldId && /^(Error: )?(INVALID_WORLD_TITLE|WORLD_BASE_UNAVAILABLE|WORLD_STARTER_UNAVAILABLE|INVALID_OPERATION_ID)$/.test(String(failure))) {
          createAttemptRef.current=null;setCreateAttempt(null);
        }
        if (createAttemptRef.current === attempt) cancelRetry.current = operation;
        setActionError(worldErrorMessage(failure, lang));
        return false;
      } finally {
        setCanCancelCreate(cancelRetry.current === operation);
        let cancelledSafely = true;
        // world.create may already select the new identity on the host. A
        // cancelled form must restore the original running world as well.
        if (!completed && (createCancelled.current || !alive.current)) {
          cancelledSafely = await cancelCreatedWorld(operation);
        }
        // Stay busy until the refreshed list reflects the result, so the panel
        // never re-enables against stale state.
        try {
          await refresh();
        } finally {
          busyRef.current = false;
          setBusy(false);
          if (pendingCreate.current === operation) pendingCreate.current = null;
          operation.finish(cancelledSafely);
        }
      }
    },
    [bridge, lang, refresh, cancelCreatedWorld],
  );

  const creationAction = useCallback(
    async (worldId: string, action: CraftmineCreationAction) => {
      if (!bridge || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setActionError(null);
      setNotice(null);
      try {
        if (action === "retry") {
          const list = await bridge.list();
          if (!list.worlds.some(world => world.id === worldId)) throw Error("CREATED_WORLD_NOT_FOUND");
          if (list.activeWorldId !== worldId) {
            // Explicit recovery may select a failed placeholder. Use the
            // retained view's save-then-open transaction; ordinary selection
            // still refuses unfinished worlds and the host still scopes retry.
            const selected = await bridge.switchWorld(worldId);
            if (!selected.ok) throw Error(selected.error);
            if (selected.activeWorldId !== worldId) throw Error("GODOT_WORLD_CHANGED");
            setActiveWorldId(worldId);
            window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
          }
        }
        await bridge.creationAction(worldId, action);
      } catch (failure) {
        setActionError(worldErrorMessage(failure, lang));
      } finally {
        try {
          await refresh();
        } finally {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [bridge, lang, refresh],
  );

  const clearMessages = useCallback(() => {
    setActionError(null);
    setNotice(null);
  }, []);

  const archiveAction = useCallback(async (worldId: string, restore: boolean) => {
    if (!bridge || busyRef.current || !capabilities?.archiveFailed) return;
    if (!restore && worlds.find(world => world.id === worldId)?.state !== "failed") return;
    busyRef.current = true;setBusy(true);setActionError(null);setNotice(null);
    try {
      await bridge.call(restore ? "world.restoreArchived" : "world.archiveFailed", {worldId});
      await refresh();
      if (alive.current) setNotice(CRAFTMINE_WORLD_TEXT[restore ? "worldRestored" : "worldRemoved"][lang]);
    } catch (failure) {
      if (alive.current) {
        const code = String(failure);
        setActionError(code.includes("WORLD_REMOVAL_BUSY") || code.includes("WORLD_APPLICATION_BUSY") ? CRAFTMINE_WORLD_TEXT.removeBusy[lang]
          : code.includes("WORLD_REMOVAL_REQUIRES_FAILED_INITIALIZATION") ? CRAFTMINE_WORLD_TEXT.removeFailedOnly[lang]
          : worldErrorMessage(failure, lang));
      }
      await refresh();
    } finally {busyRef.current = false;if (alive.current) setBusy(false);}
  }, [bridge, capabilities?.archiveFailed, worlds, refresh, lang]);

  // A world that is initializing changes on the host, not in this renderer.
  // Poll the same read channel the list uses, with a hard bound, so the row can
  // show real progress and stop on its own instead of spinning forever.
  const initializing = hasInitializingWorld(worlds);
  useEffect(() => {
    if (!bridge || !initializing) return;
    let polls = 0;
    let stopped = false;
    const timer = window.setInterval(() => {
      if (stopped || busyRef.current) return;
      polls += 1;
      if (polls > CRAFTMINE_CREATION_POLL_LIMIT) {
        stopped = true;
        window.clearInterval(timer);
        setNotice(CRAFTMINE_WORLD_TEXT.createPending[lang]);
        return;
      }
      void refresh();
    }, CRAFTMINE_CREATION_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [bridge, initializing, lang, refresh]);

  return {
    status,
    worlds,
    archivedWorlds,
    removeFailedWorld: id => archiveAction(id, false),
    restoreWorld: id => archiveAction(id, true),
    activeWorldId,
    activeWorld: worlds.find((entry) => entry.id === activeWorldId) ?? null,
    capabilities,
    activeTask,
    error: actionError ?? loadError ?? detailError,
    notice,
    busy,
    bridge,
    refresh,
    select,
    continuePreparation: id => select(id, true),
    create,
    creationAction,
    clearMessages,
    cancelCreate: async () => {
      createCancelled.current = true;
      const pending = pendingCreate.current;
      if (pending) {setNotice(CRAFTMINE_WORLD_TEXT.createCancelling[lang]);return pending.done;}
      const retry = cancelRetry.current;if (!retry) return true;
      if (busyRef.current) return false;
      busyRef.current = true;setBusy(true);setActionError(null);setNotice(CRAFTMINE_WORLD_TEXT.createCancelling[lang]);
      try {const result = await cancelCreatedWorld(retry);await refresh();return result;}
      finally {busyRef.current = false;setBusy(false);}
    },
    canCancelCreate,
    createAttempt,
  };
}
