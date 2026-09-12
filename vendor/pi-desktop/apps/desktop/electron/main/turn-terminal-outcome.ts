export type TurnTerminalStatus = "completed" | "aborted" | "error";
export type TurnTerminalOutcome = {
  status: TurnTerminalStatus;
  errorCode?: string;
  source: "requested" | "abort-intent" | "assistant-error" | "assistant-aborted";
};
type Message = {role?: unknown; status?: unknown; error?: unknown; parentToolCallId?: unknown; agentName?: unknown};
type Evidence = {abort?: string; error?: string; interrupted?: string; recoveringError?: string};
const interruptedCodes = new Set(["TURN_ABORTED", "REQUEST_INTERRUPTED", "APP_SHUTDOWN_INTERRUPTED"]);
const code = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\x00-\x1f]/.test(value) ? value : undefined;
const messageCode = (error: unknown) => error && typeof error === "object" && !Array.isArray(error) ? code((error as {code?: unknown}).code) : undefined;

/**
 * Terminal evidence belongs to one host-owned turn, never the whole session.
 * Call markAbort before awaiting sidecar.abort: agent_end may arrive from it.
 * Observe only terminal message_end envelopes that own that active turn, resolve
 * before durable endTurn/telemetry, and release after that finalization settles.
 */
export function createTurnTerminalOutcomes() {
  const turns = new Map<string, Evidence>();
  const key = (sessionId: string, turnId: string) => {
    if (!code(sessionId) || !code(turnId)) throw Error("TURN_TERMINAL_IDENTITY_REQUIRED");
    return JSON.stringify([sessionId, turnId]);
  };
  const evidence = (sessionId: string, turnId: string) => {
    const id = key(sessionId, turnId);
    let value = turns.get(id);
    if (!value) {value = {};turns.set(id, value);}
    return value;
  };
  return {
    markAbort(sessionId: string, turnId: string, errorCode?: string): void {
      const value = evidence(sessionId, turnId), reason = code(errorCode) ?? "TURN_ABORTED";
      // A player stop must not be downgraded by a later application shutdown.
      if (!value.abort || (value.abort === "APP_SHUTDOWN_INTERRUPTED" && reason !== "APP_SHUTDOWN_INTERRUPTED")) value.abort = reason;
    },
    observeMessage(sessionId: string, turnId: string, message: Message): void {
      const id=key(sessionId, turnId);
      if (message?.role !== "assistant" || message.parentToolCallId || message.agentName) return;
      if (message.status === "complete") {
        const value=turns.get(id);
        if (value?.recoveringError && value.error===value.recoveringError && !value.abort && !value.interrupted) {
          delete value.error;delete value.recoveringError;
        }
        return;
      }
      if (!["error", "aborted", "cancelled"].includes(String(message.status))) return;
      const value = evidence(sessionId, turnId), reason = messageCode(message.error);
      if (value.recoveringError && value.error===value.recoveringError && !value.abort && !value.interrupted) delete value.error;
      delete value.recoveringError;
      if (message.status === "aborted" || message.status === "cancelled" || (reason && interruptedCodes.has(reason))) {
        value.interrupted ??= reason ?? "TURN_ABORTED";
      } else {
        // Preserve a real provider code rather than replacing it with a generic
        // later failure. A normal tool response is never observed in this map.
        if (!value.error || value.error === "ASSISTANT_ERROR") value.error = reason ?? "ASSISTANT_ERROR";
      }
    },
    observeRecovery(sessionId: string, turnId: string, event: {reason?: unknown; ok?: unknown; willRetry?: unknown}): void {
      const value=turns.get(key(sessionId,turnId));
      // Runtime overflow recovery emits an error bubble, persists a checkpoint,
      // and continues within this same turn. A checkpoint alone is not success:
      // require a subsequent complete root-assistant response as well.
      if (value?.error && !value.abort && !value.interrupted && event.reason==="overflow" && event.ok===true && event.willRetry===true) value.recoveringError=value.error;
    },
    resolve(sessionId: string, turnId: string, requested: TurnTerminalStatus, errorCode?: string): TurnTerminalOutcome {
      const value = turns.get(key(sessionId, turnId)), reason = code(errorCode);
      if (value?.abort) return {status: "aborted", errorCode: value.abort, source: "abort-intent"};
      if (requested === "aborted") return {status: "aborted", errorCode: reason ?? value?.interrupted ?? "TURN_ABORTED", source: "requested"};
      if (value?.error) return {status: "error", errorCode: value.error, source: "assistant-error"};
      if (requested === "error" && !(reason && interruptedCodes.has(reason))) return {status: "error", ...(reason ? {errorCode: reason} : {}), source: "requested"};
      if (value?.interrupted) return {status: "aborted", errorCode: value.interrupted, source: "assistant-aborted"};
      if (requested === "error" && reason && interruptedCodes.has(reason)) return {status: "aborted", errorCode: reason, source: "requested"};
      return {status: requested, ...(reason ? {errorCode: reason} : {}), source: "requested"};
    },
    release(sessionId: string, turnId: string): void {turns.delete(key(sessionId, turnId));},
  };
}
