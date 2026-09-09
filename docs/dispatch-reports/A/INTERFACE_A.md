# A domain interfaces

Status: implementation in progress, 2026-09-09. Private Rust stdio methods are not public renderer RPCs. The trusted broker binds every identity; do not forward model-supplied identity fields.

## Task context and accounting

`task.context({context:{projectId,sessionId,turnId}})` returns:

```json
{"binding":{"projectId":"p","sessionId":"s","turnId":"t","taskId":"work-hash","baseBuild":"v-hash"},"generation":1,"status":"running","recovery":"none","world":{"id":"world-a","revision":0,"buildId":"v-hash","hash":"sha256"},"draft":{"revision":0,"hash":"sha256"},"modifiedResources":[],"requirements":[],"receipts":[],"jobs":[],"lease":{"owned":true},"budget":{"ownerTaskId":"work-hash","requestCount":0,"toolCallCount":0,"compactionCount":0,"actualTokens":0,"reservedTokens":0,"unknownRequestCount":0,"chargedTokens":0,"remainingTokens":1000000,"limits":{"maxRequests":80,"maxTokens":1000000,"maxCompactions":8,"deadlineAt":null}}}
```

This example is a contract fixture. The method does not claim that finished tasks are running or that released leases are owned. Requirements contain at most eight `{id,kind,text}` entries, newest first; receipts and jobs are bounded. `task.recordContext({context,requestId,text,kind:'request'|'correction'})` is host-only, rejects mismatched retries, limits text to 16,000 UTF-8 bytes, and returns `{id,recorded:true}`. A new ordinary turn has no inherited requirements; explicit interrupted-task recovery retains them.

- `budget.inspect({binding,generation})` returns the budget projection above.
- `budget.reserve({binding,generation,requestId,purpose,estimatedInputTokens,maxOutputTokens,limits?})`: purpose is creation/summary/review/retry. Estimate includes all input components supplied by B plus output reserve. Limits fields are optional on the first reservation and then immutable. `deadlineAt` is Unix **milliseconds**, not ISO text. Defaults: 80 requests, 1,000,000 tokens, eight compactions, no deadline.
- `budget.settle({binding,generation,requestId,status,usage?,errorCode?})`: status known/unknown/cancelled. Known usage is `{inputTokens,outputTokens,totalTokens?}`. Total is authoritative when supplied; otherwise input + output. Do not separately add reasoning or cache counters. Unknown and cancelled requests retain the estimate. Duplicate identical settlement succeeds; contradictory settlement fails. Existing reservations may settle after cancellation but cannot create new requests.
- `budget.boundary({binding,generation,eventId,kind:'compaction'|'tool'})`: durable idempotent event counters. An attempted compaction consumes its counter even if the summary later fails.

All writes return `{requestId,status,budget}`. Reads and settlement require exact binding/generation; reservations require a live task. The review purpose additionally permits a finished current draft with matching passed verification and unchanged world base, because PI can end its main stream before the required review finishes. Other purposes require a live lease. Failed reservations do not consume counters. No compaction resets the ledger.

## Recovery

Broker startup invokes `task_recover()` after verification/review/application job recovery. Running workspace leases become interrupted, leases are released, reserved requests become unknown, code remains in SQLite, and no model request replays.

- `task.recoverable({projectId,worldId?})` lists at most 64 interrupted records.
- `task.resume({taskId,generation,context})` requires the same project/session and a fresh host turn ID. It atomically opens the new task, retains the draft, increments generation, retains the original budget owner and requirements, and closes the old identity. It returns `{workspace,generation,budget,modelReplay:false}`.
- `task.discard({taskId,projectId,generation})` retires the interrupted session head; original draft/history remains inspectable. It does not overwrite the formal world.

Generic `workspace.open` refuses interrupted heads with `EXPLICIT_RECOVERY_REQUIRED`. A changed unapplied base fails with `DRAFT_BASE_CONFLICT`; already applied drafts advance through the existing application receipt rule. Every resume transition uses the same immediate transaction as workspace opening.

## Integration notes

Register explicit business channels, never a generic core-call proxy. Read actual host user text, open its workspace, record context once by message ID, then read task context for B. A context snapshot cannot authorize a later write after a new turn replaced its identity. Existing public error messages remain compatible; new callers should treat the leading uppercase error marker as the stable code. Structured error envelope support follows in this package.

Library, memory and backup interfaces will be added here before their consumers integrate.
