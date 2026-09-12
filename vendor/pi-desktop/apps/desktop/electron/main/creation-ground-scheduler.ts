type Identity = {worldId: string; instanceId: string};
type Result = {status: string; reason?: string};
type Entry = Identity & {phase: "waiting" | "running" | "done" | "retrying"; attempts: number; retryAt: number; error?: string};
type Dependencies = {
  current: () => Identity | null;
  blocked: () => boolean;
  start: (worldId: string) => Promise<Result>;
  lastStatus: (worldId: string) => Result | null;
  changed?: (entry: Readonly<Entry>) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  idleDelayMs?: number;
  retryDelayMs?: number;
};

/** The current retained world is reconsidered after foreground work releases
 * it. A cancelled attempt never marks an instance complete. Native ownership,
 * Core writes, build cancellation and apply rollback stay with the existing
 * maintenance service; this module only schedules that service when idle. */
export function createCreationGroundScheduler(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  const idleDelay = deps.idleDelayMs ?? 1000;
  const retryDelay = deps.retryDelayMs ?? 15000;
  const setTimer = deps.setTimer ?? ((callback, ms) => { const timer = setTimeout(callback, ms); timer.unref(); return timer; });
  const clearTimer = deps.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const entries = new Map<string, Entry>();
  let timer: unknown, timerAt = Infinity, running = false, suspended = false, disposed = false;
  const key = (value: Identity) => JSON.stringify([value.worldId, value.instanceId]);
  const announce = (entry: Entry) => deps.changed?.({...entry});
  function arm(ms: number) {
    if (suspended || disposed) return;
    const at = now() + Math.max(0, ms);
    if (timer !== undefined && timerAt <= at) return;
    if (timer !== undefined) clearTimer(timer);
    timerAt = at;
    timer = setTimer(() => { timer = undefined; timerAt = Infinity; void drive(); }, Math.max(0, ms));
  }
  async function drive() {
    if (suspended || disposed || running) return;
    const current = deps.current();
    if (!current) return;
    const entry = entries.get(key(current));
    if (!entry || entry.phase === "done") return;
    if (entry.retryAt > now()) { arm(entry.retryAt - now()); return; }
    if (deps.blocked()) { arm(idleDelay); return; }
    running = true; entry.phase = "running"; entry.attempts++; announce(entry);
    let result: Result;
    try { result = await deps.start(entry.worldId); }
    catch (error) {
      result = deps.lastStatus(entry.worldId) ?? {status: "failed", reason: String(error)};
      if (!["failed", "cancelled"].includes(result.status)) result = {status: "failed", reason: String(error)};
    }
    finally { running = false; }
    if (["applied", "skipped"].includes(result.status)) {
      entry.phase = "done"; entry.retryAt = 0; delete entry.error;
    } else {
      const interrupted = result.status === "cancelled" || /PLAYER_WORK|SELECTION_CHANGED|FORMAL_CHANGED|DRAFT_CHANGED|WORLD_BUSY|ACTIVE_TASK/.test(result.reason ?? "");
      entry.phase = interrupted ? "waiting" : "retrying";
      // No finite attempt cap: cancellation is normal, and transient executor
      // errors can recover. Backoff keeps an unhealthy executor from spinning.
      entry.retryAt = now() + (interrupted ? idleDelay : Math.min(300000, retryDelay * 2 ** Math.min(entry.attempts - 1, 5)));
      entry.error = result.reason;
    }
    announce(entry);
    if (suspended || disposed) return;
    const live = deps.current(), next = live ? entries.get(key(live)) : undefined;
    if (next && next.phase !== "done") arm(Math.max(idleDelay, next.retryAt - now()));
  }
  function schedule(worldId: string, instanceId: string) {
    if (disposed || !worldId || !instanceId) return;
    const identity = {worldId, instanceId}, id = key(identity);
    if (!entries.has(id)) {
      entries.set(id, {...identity, phase: "waiting", attempts: 0, retryAt: 0});
      // Prune only old settled identities. Never forget a running current job.
      if (entries.size > 64) for (const [old, entry] of entries) {
        if (entries.size <= 64) break;
        if (old !== id && entry.phase !== "running") entries.delete(old);
      }
    }
    if (entries.get(id)?.phase !== "done") arm(0);
  }
  function suspend() {
    suspended = true;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined; timerAt = Infinity;
  }
  return {
    schedule,
    status(worldId: string, instanceId: string) { const entry = entries.get(key({worldId, instanceId})); return entry ? {...entry} : null; },
    suspend,
    resume() { if (disposed) return; suspended = false; const current = deps.current(); if (current) schedule(current.worldId, current.instanceId); },
    retry(worldId: string, instanceId: string) {
      const entry = entries.get(key({worldId, instanceId}));
      if (entry && entry.phase !== "running") { entry.phase = "waiting"; entry.retryAt = 0; delete entry.error; }
      schedule(worldId, instanceId);
    },
    dispose() { suspend(); disposed = true; entries.clear(); },
  };
}
