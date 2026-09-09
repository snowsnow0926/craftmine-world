# S2 interface: managed executor recovery, identity and restart reconciliation

Consumers: R2 (Electron host), S6 (model tools), S1 (core), S7 (integration),
S8 (packaging). Everything here is implemented in
`plugins/craftmine-world/godot-executor.cjs` and proven by
`tests/godot-round3/S2/**`.

## 1 Constructing the executor

```js
const {createGodotExecutor} = require('./godot-executor.cjs');

const executor = createGodotExecutor(core, {
  dataPath,                 // plugin data directory; ledger and tasks root live under it
  verifier: pi.craftmine,   // {godotCheck(input), cancelGodotCheck(id)}
  logger: console,
  jobTimeoutMs: 600000,
});

await executor.start();   // discover + pin + startup recovery + preflight + register + restart reconciliation
await executor.stop();    // cancel jobs, settle, recovery pass, revoke
```

`main.cjs` already constructs it and registers the `godot-executor` service.

## 2 Minimal consumable call example

Recovery is the part other tasks consume first. It needs no core and no engine:

```js
const {runRecoveryPass} = require('./godot-executor.cjs');

const summary = await runRecoveryPass({
  broker: process.env.CRAFTMINE_GODOT_BROKER_BIN,   // pinned godot-host-broker.exe
  tasksRoot: 'D:\\data\\godot\\tasks',
  trigger: 'startup',
});
// {
//   format: 'craftmine.godot-recovery-summary/1', ok: true, trigger: 'startup',
//   policyVersion: 'craftmine.windows.recovery-journal.v1',
//   tasksRoot, journalRoot,
//   reclaimed: [{taskId, operation, childProcessState, taskRootRemoved,
//                profileDeleted, reclaimed:[...], finalReceiptObserved:false}],
//   skipped:   [{taskId, operation, brokerStillRunning, reasons:['pid-reused', ...]}],
//   unreadable: [{file, error}],
//   reconciledCount, skippedCount, finalReceiptClaimed
// }
```

Rules a consumer must keep:

- `reclaimed` means "no final receipt arrived and the recorded identity was
  re-proved". It never means the build succeeded.
- `skipped` entries were left untouched on purpose. `broker-still-running` and
  `pid-reused` are normal, not errors.
- `ok:false` (missing broker, unparseable output, timeout) means no cleanup was
  performed and none may be claimed.

## 3 Status surface

`executor.status()` (also reachable as `godotExecutor.status`) adds:

```jsonc
{
  "broker": {"sha256", "pinned": true, "pinSource", "sourceCommit", "protocolVersion"},
  "recoveries": [ /* last 8 recovery summaries, each with trigger */ ],
  "startupRecovery": {...}, "restartReconciliation": {requeued:[], interrupted:[], unverifiable:[], terminal:[]},
  "stopRecovery": {...},
  "resources": {"sampled": true, "hardFilesystemQuota": false, "scope": "...", "lastObserved": {...}},
  "ledger": {"jobs": 4, "active": 1, "updatedAt": "..."},
  "jobs": ["gjob-..."]
}
```

`status().broker.pinned === false` means no identity file was found for this
broker copy. Production must ship one (see §5).

## 4 Durable ledger

`<data>/godot/executor-ledger.json`:

```jsonc
{ "format":"craftmine.godot-executor-ledger/1", "jobs": {
  "gjob-<64hex>": { "worldId", "mode", "state": "enqueued|running|finished|failed|cancelled|interrupted",
    "outcome", "reason", "startedAt", "finishedAt",
    "attempts": [{"requestId","operation","startedAt","finishedAt","transport",
                  "outcome":"succeeded|reclaimed-without-final-receipt|no-final-receipt:<reason>|unknown-at-restart",
                  "recovery":{"trigger","reclaimed":[],"skipped":0,"unreadable":0}}]}}}
```

Only `outcome: "succeeded"` means the broker both reported success and retired
its own journal entry.

## 5 Broker identity for packaging (S8)
```
node desktop/godot/sandbox/broker-identity.mjs <broker.exe> --write <dir>/broker-identity.json
```

Place the file next to the packaged `godot-host-broker.exe`, or point
`CRAFTMINE_GODOT_BROKER_IDENTITY` at it. A mismatch fails discovery with
`GODOT_BROKER_MISMATCH` before any task runs. A debug build's hash embeds its
build directory, so the shipped pin must be generated from the canonical release
build.

## 6 Model-tool handshake (S6) and core dependencies (S1)

`main.cjs` passes a sixth options object to `createWorldTools`:

```js
{
  executorEnqueue: (job, context) => godotExecutor.enqueue(job, context), // {enqueued, reason}
  sampleLiveState: input => pi.craftmine.sampleLiveState(input),          // host bridge, null if absent
  budget: () => ({}),                                                     // every counter stays unknown
  historyMethods: [...], libraryMethods: [...],
}
```

`executorEnqueue` matches S6's committed contract in
`codex/godot-round3-s6-20260910`. Until that `world-tools.cjs` is integrated, a
build started by the model stays `blocked/queued` and the executor cannot see it
(the core has no `godotJob.pending`).

The asset (`asset.request`) and package (`package.request`) routes reach the
constructed services today, but the services call core methods that only exist on
S1's branch (`codex/godot-round3-s1-20260910`, commit `b307d54`:
`asset.*`, `package.formatCheck/planInstall`, `backup.*Portable`). Against the
current tree those calls return the core's own `UNSUPPORTED_METHOD`.
