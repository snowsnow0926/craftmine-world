import type { AgentEventEnvelope } from "@pi-desktop/shared";

type Identity = { sessionId: string; turnId: string };
type State = { pending: Promise<void>; errors: string[]; count: number; overflow: boolean };
/** Private Main adapter. No current-session lookup and no renderer write API. */
export function createTaskMetricsRecorder(options: {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}) {
  const states = new Map<string, State>();
  const key = ({ sessionId, turnId }: Identity) => JSON.stringify([sessionId, turnId]);
  const remember = (state: State, error: unknown) => {
    if (state.errors.length < 32) state.errors.push((error instanceof Error ? error.message : "TASK_METRICS_WRITE_FAILED").slice(0, 256));
  };
  async function callChecked(method: string, request: Record<string, unknown>) {
    const result = await options.call(method, request);
    if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true)
      throw Error("TASK_METRICS_INVALID_RECEIPT");
  }
  async function persist(identity: Identity, call: unknown, state: State) {
    const request = { ...identity, call };
    try { await callChecked("session.observeModelCall", request); }
    catch {
      // One exact retry recovers a lost reply without counting another call.
      try { await callChecked("session.observeModelCall", request); }
      catch (error) {
        remember(state, error);
        // A known gap must survive restart; do not allow a partial ledger to
        // advertise complete coverage merely because its remaining rows match.
        await callChecked("session.metricsUnavailable", identity);
      }
    }
  }
  return {
    observe(envelope: AgentEventEnvelope): void {
      if (envelope.event.type !== "model_call") return;
      if (!envelope.turnId || !envelope.sessionId) throw Error("TASK_METRICS_IDENTITY_REQUIRED");
      const identity = { sessionId: envelope.sessionId, turnId: envelope.turnId };
      const id = key(identity);
      let state = states.get(id);
      if (!state) {
        if (states.size >= 128) throw Error("TASK_METRICS_QUEUE_CAPACITY");
        state = { pending: Promise.resolve(), errors: [], count: 0, overflow: false };
        states.set(id, state);
      }
      if (state.count >= 8192) {
        if (!state.overflow) {
          state.overflow = true;
          remember(state, Error("TASK_METRICS_QUEUE_CAPACITY"));
          state.pending = state.pending.then(() => callChecked("session.metricsUnavailable", identity));
          void state.pending.catch(() => undefined);
        }
        return;
      }
      state.count++;
      const call = structuredClone(envelope.event.call);
      const current = state;
      current.pending = current.pending.then(() => persist(identity, call, current));
      // Retain failure for drain(), without an unhandled rejection on events.
      void current.pending.catch(() => undefined);
    },
    async drain(identity: Identity): Promise<{ complete: boolean; errors: string[] }> {
      const state = states.get(key(identity));
      if (!state) return { complete: true, errors: [] };
      // Events can append while an RPC is in flight. Drain the latest tail.
      let pending: Promise<void>;
      do { pending = state.pending; await pending; } while (pending !== state.pending);
      return { complete: state.errors.length === 0, errors: [...state.errors] };
    },
    release(identity: Identity): void { states.delete(key(identity)); },
  };
}
