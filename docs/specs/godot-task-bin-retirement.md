# Retirement of new successful task engine copies

Status: implementation prepared on the frozen `8276b4540289c0d397c382dff2123edfe1861d42` baseline. Native broker compilation and real new-task acceptance are required before release. This does not authorize cleanup of existing profiles.

## Scope and reason

The supplied completed 827 profile inventory contains 34 task engine copies, totaling 6,149,202,192 logical bytes out of 7,155,681,481. The executor ledger confirms 12 completed jobs and 24 successful import/export attempts whose recovery journals were retired. Normal broker cleanup removes `work` and the AppContainer profile; it intentionally retains diagnostics/artifacts, and previously also retained every `bin` copy. Recovery only visits unresolved crash journals, so it cannot collect these successful tasks.

This slice implements the disk/cache separation in Native Runtime NR-A06/NR-A14 and the plan's disk budget section. It does not implement shared engine execution, hard links, a storage scanner, a new RPC, a history collector, or recovery of previously retained files. There is no alteration of task SID grants or executable locations.

## Eligibility and proof

Only an exclusively created task in the current broker invocation can receive `bin-retirement.json` and optional response field `binRetirement` with format `craftmine.godot-bin-retirement/1`. The broker creates and flushes this parent-owned registration using `create_new`; it records the task nonce and the exact two pinned files, their logical sizes and SHA-256 hashes.

Both native preflight and Godot must have returned a successful process exit, with their owned Job handles separately measuring zero active processes. Unknown measurements do not qualify. Task cleanup must report verified, profile HRESULT zero, work absent, no cleanup error; the recovery journal must have been cleared without error. The broker retains all binaries if any eligibility condition or optional registration write fails. It does not unlink anything itself, since stdout flush cannot prove receipt delivery.

The executor first performs its existing source, policy and artifact validation. A private in-memory capability is captured from that specific successful broker response, only after broker transport exit zero, with no cancellation, timeout, parse failure or recovery pass. It is never reconstructed from disk or an executor ledger. Old brokers/old tasks lack this proof and retain their files.

## Acknowledgment and ordering

For import/exportWeb, the actual runtime check and artifact transfer precede `godotJob.finish`. The core must return `status: passed` for the same job and the executor ledger write must settle successfully. The helper then flushes and rereads an exclusive `bin-retirement-ack.json` containing the complete original broker receipt and actual core confirmation. An exception after the core commits but before the reply arrives is not confirmation and preserves the copies.

Preflight (`version`) has no build job. Its separate exit is a verified preflight plus a successful actual `godotExecutor.register` reply for this executor. The same durable acknowledgment file is required. A stale startup, refused registration or shutdown preserves the copies.

Only these fixed names inside the already registered task's `bin` are candidates:

- `Godot_v4.7.2-stable_win64.exe`
- `broker-preflight.exe`

Before the first unlink, the helper checks ordinary directories and canonical ancestors, rejects symbolic links/junctions and hard-linked files, checks the nonce/registration, rejects remaining work/recovery entries, validates the exact bin file set, and hashes both files against the independently verified toolchain pins. It checks the file identities again after the durable acknowledgment and checks that shutdown/cancellation has not begun. There is no recursive deletion and no directory removal. Artifacts, logs, source bindings/hashes, identity marker and both receipts stay in place.

The current process caches each retirement promise: duplicate calls do not repeat file operations. No task is retried or adopted from disk after a process restart. A refused acknowledgment or changed file results in preservation. A filesystem failure during the two independent unlinks is reported as partial, with the exact removed list; no automatic additional removal follows. A best-effort exclusive result file and executor ledger retain the outcome. Missing result persistence is explicit. Optional retirement failure must not change an already confirmed build result to failure.

## Boundaries and remaining validation

- Runtime failed, cancelled, unknown, refused finish, unflushed ledger, lost reply and unresolved recovery tasks retain every bin copy. Failure retention is not automatically bounded in this slice.
- Independent Windows export consumers are not connected to retirement. They keep their copies even if a new broker provides a registration. Artifact duplication, global quota accounting and failed-task retention policy are also later work.
- The fixed task root remains host-owned and unavailable for child writes. This code does not claim protection against an independently malicious process with the host user's full filesystem rights racing every filesystem operation.
- Each binary hash uses a 64 KiB buffer and a 256 MiB/file limit. Receipts have an 8 MiB UTF-8 limit. Oversized/malformed or unavailable evidence means preservation. Additional hashing cost must be measured with the real pinned broker and engine.
- The ordinary cleanup contract remains unchanged. `cleanup.verified` still means work/profile cleanup, not bin retirement; inspect the separate acknowledgment/result evidence for the latter.

## Validation contract

Small unit fixtures exercise import/exportWeb/preflight confirmation, fixed-only removal, full receipt and diagnostic retention, in-process idempotence, legacy absence, malformed or changed identity/pins/file sets, pending work/journal, damaged prior acknowledgment, and stopping before removal. Scripted broker/core tests drive the real executor and check that files still exist at the `godotJob.finish` boundary; pass permits retirement, failed check/refused registration/lost final reply do not. These tests are authored fixtures, not native execution evidence.

Before integration acceptance, rebuild the sandbox broker and refresh its host-owned identity pins/runtime resource manifest. Run the added Rust eligibility test. Run only new, independent short-path profiles through actual version/import/exportWeb, real core finish and restart. Verify zero live task processes, retained full logs/artifacts/receipts, absent fixed bin files after acknowledgment, unchanged formal progress, and no recovery of historical profiles. Add locked-file, hard-link/reparse refusal and crash-boundary fault tests in disposable new fixtures; measure logical and allocated bytes and elapsed hash cost. Do not infer an 86% real saving from the inventory projection alone.
