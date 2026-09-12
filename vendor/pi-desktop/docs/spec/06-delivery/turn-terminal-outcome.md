# Durable turn outcomes follow explicit terminal evidence

An `agent_end` event means the agent transport stopped emitting work; it does
not by itself prove a completed player request. In particular, `sidecar.abort`
can emit `agent_end` before its caller resumes, so recording abort intent after
awaiting it can incorrectly persist the turn as completed.

The main-only terminal-outcome helper retains evidence under the exact
`sessionId + turnId` tuple. It never reads model prose, changes a world, writes a
transcript, starts a retry, or grants permissions. Required integration order:

1. Record explicit user or shutdown abort intent before any awaited abort call.
2. Observe terminal root-assistant `message_end` status only for the owning
   active turn. Tool failures, child-agent messages and streaming updates are not
   parent terminal outcomes.
3. Resolve the requested outcome before telemetry, durable `session.endTurn`,
   scheduled-run and approved-execution finalization. Keep that resolved outcome
   for downstream completion callbacks instead of resolving after release.
4. Release only that tuple after the owning finalization has settled. A late
   event or release for an older turn cannot change the new turn in the session.

Explicit abort intent wins over provider failure. A user stop supersedes a
shutdown reason in either arrival order. An explicit requested abort remains an
abort. Otherwise actual provider error wins over an interrupted assistant bubble
or a requested completion. `REQUEST_INTERRUPTED`, `TURN_ABORTED` and
`APP_SHUTDOWN_INTERRUPTED` remain cancellation, not successful completion.
Unknown and missing error metadata never turn a terminal error into success.

## Legitimate same-turn recovery

The actual runtime's ordinary transient-provider retry path holds its assistant
row in `streaming`, emits `message_update`, and suppresses its intermediate run
end. It does not publish a terminal error row that this helper must clear.

Context-overflow recovery is different: the runtime first emits a terminal error
row, then persists a compaction checkpoint and continues within the same turn.
The helper accepts only the owning `compaction_end` signal with reason `overflow`,
`ok: true` and `willRetry: true`. This arms replacement of that exact old error;
it is not proof that the task completed. A subsequent complete root-assistant
response clears it; a new terminal error or abort replaces it with the new
outcome. Failed/unrelated compaction, missing subsequent response and explicit
abort cannot be erased by ordinary complete messages.

The pure event-sequence tests cover synchronous `agent_end` inside abort,
provider-error ordering, normal tool/message streams, separate sessions and
turns, tuple release, and both successful and interrupted overflow recovery.
The helper itself does not prove the main event wiring. Final integration must
exercise normal Stop and application shutdown with a live model request in an
isolated profile and compare message, metric, task and durable turn outcomes.
