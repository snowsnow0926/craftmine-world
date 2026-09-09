# Managed Godot executor host and isolated runtime check

Scope: the private product components that actually run the pinned engine. Owner:
task C. Companions: ADR `docs/adr/ADR-godot-managed-executor-C.md`, the core
contract in `docs/spec/dispatch-managed-godot-build.md`, and the private broker
protocol `BROKER_PROTOCOL_V1.md`.

This document describes behaviour that is implemented and measured. Where a
needed core interface is not in the integrated core yet, it is marked
**pending**, and the host's fallback is described.

## 1 Ownership

| Component | Owner | Responsibility |
| --- | --- | --- |
| `plugins/craftmine-world/godot-executor.cjs` | C | discovery, preflight, registration, job worker, artifact staging |
| `plugins/craftmine-world/host-requests.cjs` | C | private host routes for executor state and core job/application calls |
| `plugins/craftmine-world/main.cjs` | C | service lifecycle, `runtime_info` live state |
| `electron/main/godot-build-verifier.ts` | C | isolated Electron runtime check |
| `electron/preload/godot-check.ts` | C | fixed runtime transport for the check page |
| `world-tools.cjs` | L | model tools; calls `enqueue`/`cancel` on this service |
| `main/index.ts`, `view.mjs` | R2 | product wiring and UI |
| `godotExecutor.status/revoke`, `godotJob.checkDescriptor`, host build files | A | core contract (**pending** in the integrated core) |

## 2 Discovery and preflight

The executor reads only host configuration, never a model or page value:

| Input | Source | Default |
| --- | --- | --- |
| broker executable | `CRAFTMINE_GODOT_BROKER_BIN` | `<data>/bin/godot-host-broker.exe`, then `<data>/godot/bin/...`, then a development path |
| engine root | `CRAFTMINE_GODOT_ENGINE_ROOT`, `CRAFTMINE_GODOT_CACHE_DIR` | `<data>/godot/engine/<version>`, then the repository cache |
| toolchain lock | `CRAFTMINE_GODOT_TOOLCHAIN_LOCK` | `<data>/godot/toolchain.lock.json`, then the repository lock |
| pinned bridge | `CRAFTMINE_GODOT_BRIDGE_PATH` | `<data>/godot/web/bridge.js`, then the repository bridge |
| broker pin | `CRAFTMINE_GODOT_BROKER_SHA256`, then `CRAFTMINE_GODOT_BROKER_IDENTITY` | `broker-identity.json` next to the broker copy, then `<data>/godot/broker-identity.json`; unset means the measured hash is recorded as unpinned, never enforced |

An explicit configuration is authoritative: a configured path that is missing is
reported as missing instead of falling back. The lock, when present, is checked
against the actual editor and Web template bytes; the broker independently pins
the same engine and template hashes in its own binary.

`desktop/godot/sandbox/broker-identity.mjs <broker.exe>` writes the identity
record (`format: craftmine.godot-broker-identity/1`) with the measured binary
hash, the protocol/recovery policy versions and a digest over every file the
broker is compiled from. The packaging step generates it from the canonical
release build; a debug build's hash embeds its build directory, so a pin is only
meaningful for the exact binary it names. `status().broker.pinned` reports
whether a pin was found, and a mismatch makes the executor unavailable with
`GODOT_BROKER_MISMATCH` before any task runs.

A real `version` preflight must then return `state: succeeded`, the exact
`policyVersion`, and `processVerification.verified`,
`networkPreflight.verified` and `cleanup.verified` all true. Only then does the
executor register:

```
godotExecutor.register {executorId, attestation:{format:"craftmine.godot-executor/1",
  isolation:"craftmine.windows.lpac-registry.v1", evidenceHash:<sha256 of the
  measured broker/engine/bridge identity + the preflight receipts>,
  engineVersion:"4.7.2-stable", capabilities:{import:true,build:true,check:true}}}
```

Registration is process-scoped: a restart re-runs discovery and preflight. A
failed preflight leaves the executor unavailable and reports its own reason.

## 3 Job worker

One job is claimed at a time (two may be queued). For a `check` job:

1. `godotJob.claim` and re-derive the expected source set from the claim's
   `files.source`/`files.asset`/`files.host`.
2. `import` through the broker. The response must echo the request identity, the
   `sourceBinding`, the `inputHash` and the pinned policy; its `sourceFiles` must
   equal the claimed manifest exactly (path, size, hash) and its
   `sourceSnapshotDigest` must equal the host's own digest of those records.
   Extra, missing, changed or unlisted inputs fail the job.
3. `exportWeb`, with the same receipt checks.
4. Stage the artifacts into the core-owned `artifactsRoot` under `web/`, verifying
   every listed file's size and hash, refusing traversal, duplicates, unlisted
   files and a missing `web/index.html`, then re-hash after the copy.
5. Replace `web/bridge.js` with the pinned host bridge and verify the hash. The
   bridge is host-owned: an authored or replaced copy never reaches the check.
6. Resolve the check descriptor. **Pending**: `godotJob.checkDescriptor`; until it
   lands the host builds the same descriptor from the claim plus `world.read`,
   and the verifier still verifies every staged byte.
7. Run the isolated Electron check and record `check.assertions`.
8. `godotJob.finish` with `craftmine.godot-job-result/1`. A `check` job always
   carries at least one assertion, including a failure; a job that never reached
   the runtime check reports `runtime.not-run` instead of being refused.

Lease heartbeats run every 30 s. Cancellation writes the documented
`{"cancel":true}` frame, waits a bounded grace period, then terminates the broker
and cancels the core job; the result is never recorded. A broker that exits
without a valid receipt, or is killed, fails the job. Job budgets, plugin unload
and late replies all resolve to a recorded terminal state, never a pass.

After any run that did not report success, the host reads the broker's recorded
`process-verification.json` for that task, confirms the recorded engine process
is gone, and terminates it by pid when it survived a hard broker kill. The
outcome is recorded in `status().reaps`; a surviving engine child can never be
mistaken for a clean finish.

## 4 Log classification

The restricted AppContainer environment produces fixed native diagnostics before
any project code runs. They are recognized only as an exact (message, engine
location) pair measured from the pinned engine — for example
`Condition "_sock == (SOCKET)(~0)" is true. Returning: FAILED` at
`open (drivers/windows/net_socket_winsock.cpp:238)`. Every other `ERROR`,
`SCRIPT ERROR`, parse error and GDScript backtrace is fatal. An unknown engine
error is never ignored, and the same message at a different location is not the
known diagnostic.

## 5 Isolated runtime check

`GodotBuildVerifier.check(descriptor)` validates the descriptor strictly, then:

- serves the staged export from a private loopback origin with the shared
  isolation headers and the verified artifact manifest;
- loads it in a hidden, offscreen, non-focusable, non-zero-sized window on an
  ephemeral session partition, with egress confined to that origin, every
  permission denied, popups/navigations/webviews denied, and the shared input
  guard installed in every frame;
- requires the engine to report ready, three spaced non-blank captures at real
  canvas size, no runtime/console error, a snapshot equal to the formal progress,
  the guard observed with zero focus and pointer-lock attempts, and a graceful
  runtime/window/session teardown;
- never sends `save`, `acknowledge` or `cancel`, so a check cannot write progress.

Diagnostics (bounded page console lines and a periodic page-state probe) are
returned for failure analysis and never influence `passed`.

## 6 Host-owned recovery and restart reconciliation

Cleanup is never decided from a pid or an image name. The only reclaim path is
the broker's own host-owned pass:

```
godot-host-broker.exe recover <absolute tasksRoot>
```

It re-proves, per task, the tasks root, the `task-identity.json` nonce, the
AppContainer profile SID and the recorded child pid **and** creation FILETIME
before deleting anything, and it refuses a task whose owning broker is still
alive. The executor runs that pass, single-flight, on every path that can leave a
task behind:

| Trigger | Why |
| --- | --- |
| `startup` | a previous process died without a final response |
| `broker-exit` | any run that did not both succeed and retire its own journal entry |
| `cancel` | a cancelled job may have been killed after its response |
| `reconcile` | before the core's queued list is trusted again |
| `stop` | after every live job has settled |

A task counts as reclaimed only when the report has `identityVerified` **and**
`journalRemoved`. A recovery pass is by definition a run without a final
response: every entry carries `finalReceiptObserved:false` and the pass never
asserts `cleanup.verified`. The executor surfaces a report that claims a final
receipt as a contradiction (`finalReceiptClaimed`) rather than trusting it.

`status().recoveries` keeps the last eight passes with their `reclaimed`,
`skipped` (with the broker's own reason strings such as `broker-still-running`,
`pid-reused`) and `unreadable` entries.

### Durable job ledger

`<data>/godot/executor-ledger.json` is written atomically (temp file + rename)
and records, per job, the state and every broker attempt with its request id,
transport state and outcome. Only a run that succeeded **and** retired its
journal entry is recorded as `succeeded`; anything else is
`reclaimed-without-final-receipt` or `no-final-receipt:<reason>`. On start the
executor:

1. runs the `startup` recovery pass;
2. after registration, reconciles each non-terminal ledger entry against the
   recovery pass and `godotBuild.read`;
3. re-enqueues a job only when the core reports it `queued`/`blocked` **and**
   every previous attempt is either recorded as succeeded or was re-proved and
   reclaimed. An entry whose old task identity could not be re-proved becomes
   `interrupted` with `GODOT_RESTART_IDENTITY_UNVERIFIED` and is never started
   again over an unverified task root. This is also what stops a job from being
   started twice after an observation wait timed out.

### Resource budget

`resourceEnforcement` is a **sampled** budget enforced by the parent broker
(default 1 GiB of `work`, 4 MiB of log, 50 ms sampling); `hardFilesystemQuota`
is `false` and the scope string says so. The executor fails a job whose receipt
reports `enforced:true` with `GODOT_RESOURCE_BUDGET_EXCEEDED` and reports the
last observation under `status().resources`, keeping the sampled budget and a
filesystem quota distinct.

## 7 Known limits

- `godotExecutor.revoke` is **pending** in the integrated core. Without it,
  `stop()` reports `revokeReason: GODOT_EXECUTOR_REVOKE_UNSUPPORTED` and the core
  keeps a stale capability flag until it restarts; no job can be claimed by a
  stopped executor.
- `godotJob.pending` is **pending**. Until it lands, the host enqueues jobs from
  the trusted caller and from its own durable ledger; a job queued by a previous
  process whose attempt identity cannot be re-proved is reported, not restarted.
- The check proves base startup and the engine's own runtime contract. It does
  not replace gameplay acceptance (task I).
