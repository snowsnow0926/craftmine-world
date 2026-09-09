import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  craftmineWorldBridge,
  planWorldSwitch,
  worldErrorMessage,
  type CraftmineActiveTask,
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
  clearMessages: () => void;
};

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
  const epoch = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
      const caps = await bridge.capabilities().catch(() => null);
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
    return () => window.removeEventListener("craftmine-world-changed", sync);
  }, [bridge, refresh]);

  const select = useCallback(
    async (id: string) => {
      if (!bridge) return;
      setNotice(null);
      setActionError(null);
      const plan = planWorldSwitch({
        activeWorldId,
        targetId: id,
        busy,
        saving: busy,
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
        setBusy(false);
        await refresh();
      }
    },
    [activeTask, activeWorldId, bridge, busy, capabilities, lang, refresh],
  );

  const create = useCallback(
    async (input: CraftmineWorldCreateInput) => {
      if (!bridge) return false;
      setBusy(true);
      setActionError(null);
      setNotice(null);
      try {
        const created = await bridge.create(input);
        await refresh();
        const result = await bridge.switchWorld(created.id);
        if (!result.ok) {
          setActionError(`${CRAFTMINE_WORLD_TEXT.switchFailed[lang]} ${worldErrorMessage(result.error, lang)}`);
          return true;
        }
        setActiveWorldId(result.activeWorldId);
        window.dispatchEvent(new CustomEvent("craftmine-world-changed"));
        return true;
      } catch (failure) {
        setActionError(worldErrorMessage(failure, lang));
        return false;
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [bridge, lang, refresh],
  );

  const clearMessages = useCallback(() => {
    setActionError(null);
    setNotice(null);
  }, []);

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
    clearMessages,
  };
}