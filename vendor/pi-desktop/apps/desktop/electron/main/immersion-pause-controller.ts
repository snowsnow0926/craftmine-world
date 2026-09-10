export type ImmersionRuntimeToken = string | object;
export type ImmersionPauseCallbacks = {
  pause(): void | Promise<void>;
  resume(): void | Promise<void>;
};

type RuntimeState = {
  callbacks: ImmersionPauseCallbacks;
  manualPaused: boolean;
  applied: boolean | undefined;
  attached: boolean;
  pending?: Promise<void>;
};

function detached(): never {
  throw Object.assign(new Error("IMMERSION_RUNTIME_DETACHED"), {errorCode: "IMMERSION_RUNTIME_DETACHED"});
}

/** Serializes pause acknowledgements for each exact runtime instance.
 * `paused` reports effective intent. A callback rejection means physical state
 * is unknown, latches manual pause and is propagated to all pending callers.
 */
export function createImmersionPauseController() {
  const runtimes = new Map<ImmersionRuntimeToken, RuntimeState>();
  const usedObjects = new WeakSet<object>();
  const usedStrings = new Set<string>();
  let overlay = false;

  const current = (token: ImmersionRuntimeToken) => {
    const state = runtimes.get(token);
    if (!state?.attached) detached();
    return state;
  };
  const desired = (state: RuntimeState) => state.manualPaused || overlay;

  const reconcile = (state: RuntimeState): Promise<void> => {
    if (state.pending) return state.pending;
    const operation = Promise.resolve().then(async () => {
      try {
        while (state.attached) {
          const target = desired(state);
          if (state.applied === target) return;
          await (target ? state.callbacks.pause() : state.callbacks.resume());
          if (!state.attached) detached();
          state.applied = target;
          // An overlay or manual change during the acknowledgement must be
          // reconciled before any waiting caller observes completion.
        }
        detached();
      } catch (error) {
        state.applied = undefined;
        state.manualPaused = true;
        throw error;
      }
    });
    state.pending = operation;
    const clear = () => { if (state.pending === operation) state.pending = undefined; };
    // A rejection handler avoids creating an unobserved finally promise.
    void operation.then(clear, clear);
    return operation;
  };

  return {
    attach(token: ImmersionRuntimeToken, callbacks: ImmersionPauseCallbacks): Promise<void> {
      if ((typeof token !== "string" && (typeof token !== "object" || token === null)) || token === "") {
        throw new Error("IMMERSION_RUNTIME_TOKEN_INVALID");
      }
      const used = typeof token === "string" ? usedStrings.has(token) : usedObjects.has(token);
      if (used) throw new Error("IMMERSION_RUNTIME_TOKEN_REUSED");
      if (typeof callbacks?.pause !== "function" || typeof callbacks?.resume !== "function") {
        throw new Error("IMMERSION_RUNTIME_CALLBACKS_INVALID");
      }
      if (typeof token === "string") usedStrings.add(token); else usedObjects.add(token);
      const state: RuntimeState = {callbacks, manualPaused: true, applied: undefined, attached: true};
      runtimes.set(token, state);
      return reconcile(state);
    },
    setManual(token: ImmersionRuntimeToken, paused: boolean): Promise<void> {
      const state = current(token);
      if (typeof paused !== "boolean") throw new Error("IMMERSION_PAUSE_INVALID");
      state.manualPaused = paused;
      return reconcile(state);
    },
    async setOverlay(paused: boolean): Promise<void> {
      if (typeof paused !== "boolean") throw new Error("IMMERSION_PAUSE_INVALID");
      overlay = paused;
      // Start every runtime's reconciliation before waiting, and observe every
      // rejection so one failing instance cannot leave unhandled promises.
      const results = await Promise.allSettled([...runtimes.values()].map(reconcile));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    },
    detach(token: ImmersionRuntimeToken): void {
      const state = runtimes.get(token);
      if (!state) return;
      state.attached = false;
      runtimes.delete(token);
    },
    paused(token: ImmersionRuntimeToken): boolean {
      return desired(current(token));
    },
  };
}
