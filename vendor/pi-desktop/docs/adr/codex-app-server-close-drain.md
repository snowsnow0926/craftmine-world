# Codex app-server exits before its transport closes

Status: implemented, 2026-09-14. Scope: app-server transport only.

Node ChildProcess emits `exit` when the process exits and `close` after stdio
closes. Rejecting all RPCs at `exit` can discard a final response already queued
in stdout, including an interrupted-recovery thread read. The existing `exited`
promise already waits for `close`; the pending map must use the same boundary.

At process exit, the transport now records `processExited` and prohibits new
send/call/respond/reject writes, but keeps parsing pending RPC responses and
notifications through stdout EOF. Complete final JSON without a newline is still
handled by readline EOF. New server requests are not dispatched once the process
has exited or host close has begun: no new host tool should run for a peer that
cannot receive its response.

At stdio close, remaining pending requests reject with the retained bounded
transport/process error. Unexpected closure emits one failure; repeated events
cannot emit duplicates. Intentional `close()` returns one shared cleanup promise,
ends stdin at most once, preserves draining notifications, and does not emit an
extra failure for an already finishing turn. Pending calls without a response
still reject. The existing two-second process-cleanup grace is unchanged and
does not become a model or authoring budget.

Synchronous/asynchronous spawn failures and unexpected stdin errors retain
normalized errors with no raw path/account/stderr data. Late stdin/process errors
during exit/intentional shutdown do not prematurely clear the draining map.
Protocol-invalid JSON remains fatal and terminates the peer. The model, effort,
locked configuration, API dispatch policy and credential handling are unchanged.

The diagnostic allowlist additionally recognizes `interrupted-recovery` and the
bounded method names `thread/read`, `thread/turns/list`, `turn/interrupt`, requested
by the runtime recovery owner. This does not add a callable host capability or
copy request arguments into diagnostics.

Validation: controlled EventEmitter child with real PassThrough streams covers
late split stdout, EOF without a newline, close-before/after response, pending
rejection, no new writes, no late host request, idempotent shutdown, startup/stdin
failures and bounded diagnostic names. Existing hidden Node subprocess handshake,
RPC error, malformed JSON and exit tests remain in the test command:

```powershell
node --test tests/codex-app-server-drain.test.mjs tests/codex-world-author.test.mjs tests/codex-connection.test.mjs
```

These fixtures do not invoke Codex, a model or a native application. Actual
interruption-acknowledgment and canonical checkpoint recovery are separate runtime
changes and require their own ordinary application evidence after integration.
