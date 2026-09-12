/** A shutdown abort pauses durable automatic work. An explicit player cancel
 * revokes it, including when it races an application shutdown. */
export function createCreationStopIntents() {
  const reasons = new Map<string, "shutdown" | "user">();
  const key = (sessionId: string, turnId: string) => JSON.stringify([sessionId, turnId]);
  return {
    shutdown(turns: Iterable<readonly [string, string]>) { for (const [sessionId, turnId] of turns) { const id=key(sessionId,turnId);if(reasons.get(id)!=="user")reasons.set(id,"shutdown"); } },
    user(sessionId: string, turnId: string) { reasons.set(key(sessionId,turnId),"user"); },
    shouldPreserve(sessionId: string, turnId: string) { return reasons.get(key(sessionId,turnId))==="shutdown"; },
    release(sessionId: string, turnId: string) { reasons.delete(key(sessionId,turnId)); },
  };
}
