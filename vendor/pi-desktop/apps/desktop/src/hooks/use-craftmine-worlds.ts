import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  craftmineWorldBridge,
  hasInitializingWorld,
  isWorldPlayable,
  planWorldSwitch,
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
  create: (input: CraftmineWorldCreateInput) => Promise<boolean>;
  creationAction: (worldId: string, action: CraftmineCreationAction) => Promise<void>;
  clearMessages: () => void;
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
  const [activeWorldId, setActiveWorldId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<CraftmineWorldCapabilities | null>(null);
  const [activeTask, setActiveTask] = useState<CraftmineActiveTask | null>(null);
  // A load failure and an action failure are different: a successful re-list
  // must not erase the reason a create or switch failed.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // React state is not synchronous: two dispatches in the same task would both
  // read `busy === false`. The ref is set before the first await.
  const busyRef = useRef(false);
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
      const caps = list.activeWorldId
        ? await bridge.capabilities(list.activeWorldId).catch(() => null)
        : null;
      if (!current()) return;
      const task = list.activeWorldId
        ? await bridge.activeTask(list.activeWorldId).catch(() => null)
        : null;
      if (!current()) return;
      setWorlds(list.worlds);
      setActiveWorldId(list.activeWorldId);
      setCapabilities(caps);
      setActiveTask(task);
      setStatus("ready");
      setLoadError(null);
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
    async (id: string) => {
      if (!bridge || busyRef.current) return;
      setNotice(null);
      setActionError(null);
      const target = worlds.find((entry) => entry.id === id);
      if (target && !isWorldPlayable(target)) {
        // The host registered the world but has not finished initializing it;
        // opening it would leave the view on a world it cannot run.
        setNotice(CRAFTMINE_WORLD_TEXT.creationNotPlayable[lang]);
        return;
      }
      const plan = planWorldSwitch({
        activeWorldId,
        targetId: id,
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
        const result = await bridge.switchWorld(id);
        if (!result.ok) {
          // The host kept the previous world; keep showing it as active.
          setActionError(`${CRAFTMINE_WORLD_TEXT.switchFailed[lang]} ${worldErrorMessage(result.error, lang)}`);
          return;
        }
        setActiveWorldId(result.activeWorldId);
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

  const create = useCallback(
    async (input: CraftmineWorldCreateInput) => {
      if (!bridge || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setActionError(null);
      setNotice(null);
      const previous = activeWorldIdRef.current;
      try {
        const created = await bridge.create(input);
        // A world that is still initializing (or failed to initialize) is
        // registered but not playable. Do not switch the running view into it:
        // the row keeps showing the host's real progress until it is ready.
        if (created.state !== "ready") {
          setNotice(CRAFTMINE_WORLD_TEXT.createInitializing[lang]);
          return true;
        }
        const result = await bridge.switchWorld(created.id);
        if (!result.ok) {
          // The world exists, but the running view could not switch to it.
          // Put the host selection back so the list and the view agree, and
          // keep the form open with the real host error.
          if (previous) await bridge.call("world.open", { id: previous }).catch(() => {});
          setActionError(`${CRAFTMINE_WORLD_TEXT.switchFailed[lang]} ${worldErrorMessage(result.error, lang)}`);
          return false;
        }
        setActiveWorldId(result.activeWorldId);
        window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
        return true;
      } catch (failure) {
        setActionError(worldErrorMessage(failure, lang));
        return false;
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
    [bridge, lang, refresh],
  );

  const creationAction = useCallback(
    async (worldId: string, action: CraftmineCreationAction) => {
      if (!bridge || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setActionError(null);
      setNotice(null);
      try {
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
    activeWorldId,
    activeWorld: worlds.find((entry) => entry.id === activeWorldId) ?? null,
    capabilities,
    activeTask,
    error: actionError ?? loadError,
    notice,
    busy,
    bridge,
    refresh,
    select,
    create,
    creationAction,
    clearMessages,
  };
}