# Mid-response exit and ordinary continuation protocol regression

This regression exercises the packaged application, its normal `agentPrompt`
and `nativeMenuAction({action: "quit"})` IPC handlers, and the real host and
Craftmine Core databases. The quit action is the action used by Pause / Save
and Exit; this driver does not claim a physical button or visual-layout test.

The provider is a deterministic loopback SSE fault fixture. It starts an
unfinished assistant response and records transport closure, then answers the
next request normally after application restart. It does not call a commercial
model, emit tools, modify world source, set main-process turn state, or write
terminal database rows. Its finite protocol waits are test synchronization,
not limits on ordinary player model execution or evidence of model capability.

The application runs with its verified offscreen acceptance guards, a fresh
short profile under `D:/CMR`, and an empty legacy-import source. CDP uses
`noDefaults`; all native windows must be hidden and unfocusable. No mouse,
keyboard, focus, foreground, bounds mutation, or Pointer Lock operation is
permitted. The driver requires both launches to exit normally with empty input,
page-error, and shutdown-failure audits. An emergency exact-child termination
is reported as failure, never as a successful quit.

## Assertions

1. A normal prompt in a newly created Web world reaches the local provider and
   produces an actual durable `.inflight.json` checkpoint tied to a running
   host turn. `session.get` is not used as a live-stream projection.
2. Mid-response Save and Exit records `aborted / APP_SHUTDOWN_INTERRUPTED` in
   the host and `aborted` in the domain ended-turn journal. The draft is
   cancelled with interrupted recovery, never falsely completed.
3. Restart exposes the retained partial assistant text and the same turn's
   aborted task metrics.
4. A new ordinary user-message prompt resumes the same world, full draft and
   budget owner in a new task generation. It completes through the real agent
   loop. The earlier turn remains aborted.

The Web world intentionally avoids conflating this protocol test with Godot
snapshot, rendering, or generated gameplay acceptance. Those need their own
real-world tests. Neither a prepare-only run nor the HTTP fixture tests count
as native acceptance.

## Commands and evidence

From the repository root, `node --test tests/interruptible-provider.mjs`
validates only the HTTP fixture. `node tests/quit-midresponse-native.mjs`
prints the plan without starting native processes. After the coordinator grants
the exclusive native slot, run:

```powershell
node tests/quit-midresponse-native.mjs 'ABSOLUTE_EXTRACTED_APP_DIR' --run
```

Each run preserves `D:/CMR/quit-protocol-*/test-results/desktop-native-a/report.json`, both launch logs, and
the isolated profile. The report records the packaged main hash, actual Core
facts, transport outcomes, and exit audits. Do not delete a failed run or replace
its durable records to make an assertion pass.
