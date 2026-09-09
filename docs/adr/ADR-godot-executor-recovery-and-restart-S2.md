# ADR S2: host-owned recovery and restart reconciliation for the Godot executor

Status: accepted (2026-09-10, round-three task S2).

## Context

The integrated round-two baseline ran two different cleanup designs. The C
executor (`plugins/craftmine-world/godot-executor.cjs`) read a per-task sidecar
and then decided from a bare pid plus an image **name** whether to run
`taskkill /T /F`. That is not an identity proof: a reused pid that happens to run
an executable with the same file name would be terminated, and a surviving
AppContainer profile or task root would never be reclaimed. B's sandbox work
(`desktop/godot/sandbox`, BROKER_PROTOCOL_V1.md) added the host-owned
`recover <tasksRoot>` pass that re-proves identity before deleting anything.

Both designs existed in the merged tree, which the round-two audit flagged as a
release blocker ("C 目前的正常链路通过可保留，但最新回收提交不宜未经修复直接进入发行").

## Decision

1. **One cleanup path.** The executor deletes nothing and kills nothing by name.
   Its only reclaim mechanism is `godot-host-broker.exe recover <tasksRoot>`. The
   sidecar/tasklist/taskkill path is removed.
2. **Reclaimed is not success.** A task counts as reclaimed only when the report
   has `identityVerified === true` **and** `journalRemoved === true`. A recovery
   report always carries `finalReceiptObserved:false`; a report that claims a
   final receipt is surfaced as a contradiction instead of trusted.
3. **Recovery runs on every path that can leave a task behind** — `startup`,
   `broker-exit`, `cancel`, `reconcile` and `stop` — and is single-flight so
   concurrent triggers cannot race on the same journal directory.
4. **Restart decisions are durable.** A small atomically written ledger records
   each job and each broker attempt. On start, a job is re-enqueued only when the
   core reports it `queued`/`blocked` and every previous attempt is either
   recorded as succeeded or was re-proved and reclaimed. Otherwise it becomes
   `interrupted` with `GODOT_RESTART_IDENTITY_UNVERIFIED`. This is what keeps an
   observation wait timeout from starting the same job twice.
5. **The broker binary is pinned, not assumed.** `broker-identity.json` records
   the measured hash, protocol/recovery policy versions and a source digest. A
   configured pin that does not match makes the executor unavailable before any
   task runs; an absent pin is reported as unpinned rather than treated as valid.
6. **Sampled budget and hard quota stay distinct.** The broker's
   `resourceEnforcement` is a sampled parent-enforced budget
   (`hardFilesystemQuota:false`). A receipt with `enforced:true` fails the job
   with `GODOT_RESOURCE_BUDGET_EXCEEDED`; the executor never claims a filesystem
   quota.

## Consequences

- Recovery is no longer able to damage a live task: the broker skips an entry
  whose owning broker still runs and reports a reused pid without terminating it.
- A crash between "core committed the job" and "host saw the reply" is now
  distinguishable from success, and the leftover task root/profile is reclaimed
  with proof.
- The executor depends on the broker's recovery CLI being present. When it is
  missing or fails, the pass is reported (`ok:false`) and no cleanup is claimed;
  the executor does not fall back to a weaker mechanism.
- A job whose leftover cannot be identified stays `interrupted` and is reported.
  That is deliberately less convenient than restarting it and is the point: the
  host cannot prove the old task root belongs to it.
- `godotJob.pending` is still absent from the core, so cross-process
  rediscovery of *queued* jobs relies on the executor's own ledger and the
  trusted caller.

## Evidence

`tests/godot-round3/S2/recovery-protocol.mjs` (12 tests, scripted broker) and
`tests/godot-round3/S2/recovery-real-broker.mjs` (4 tests, the pinned broker's
own `recover` CLI). Raw output in
`docs/dispatch-reports/godot-round3/S2/evidence/`.
