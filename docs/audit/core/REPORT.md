# Core and sandbox integration repair

Branch: `codex/godot-audit-core-20260909`. Base: `75f69fa2903e0c259bfaf5ce0cfecd190bb21545`. Independent worktree: `D:/Craftmine World-worktrees/godot-audit-core-20260909`. No other task tree changed, no merge, no push, no cleanup of other trees.

## Delivered

1. Streamed artifact verification supports the observed 39,514,754-byte Web engine size. Independent bounds: 256 MiB/file, 512 MiB/result, 4096 entries. Source/asset limits remain unchanged; altered bytes, excessive sizes, duplicate case-insensitive paths and reparse components are refused.
2. Claim returns the actual `source/` project root and rechecks recorded source/asset files before granting a job. Adapters must use `projectRoot` directly, without appending another `source` component.
3. Prepare rejects an identical player pose with stale inventory/quest/other progress. Formal progress is the only snapshot committed. Commit revalidates current source revision/hash and asset manifest, including changes after prepare.
4. Materialization flushes a temporary file before renaming to the final name. Existing corrupt files are still errors. Orphan temporary files, directory rename crash durability and garbage collection are not claimed solved.
5. World list/read expose optional `baseId` and `runtimeKind` derived from hashed persisted build data. Godot scene format plus Godot metadata gives `godot`; recognized legacy formats give `legacy`; unknown formats omit both. Metadata is not a launch grant.
6. Sandbox Task roots are exclusive and cannot merge with a prior run. Ancestor/new input reparse points and Windows device aliases are rejected. Pins are rehashed after copy; the exact engine path is retained instead of choosing a directory entry. Tasks run once, error exits become Failed, successful status is required for artifact handoff, and cleanup errors are returned. One-active-process and positive budgets are enforced.

## Validation

- `cargo test -p craftmine-core --offline`: **102 passed, 0 failed, 1 ignored**. The ignored historical Windows junction fixture remains ignored. Evidence: `evidence/core-tests.txt`.
- `cargo test --offline --manifest-path desktop/godot/sandbox/Cargo.toml --lib`: **9 passed**; files/logic only. Evidence: `evidence/sandbox-tests.txt`.
- `cargo build --offline --manifest-path desktop/godot/sandbox/Cargo.toml`: all crate binaries compile. Evidence: `evidence/sandbox-build.txt`.
- `git diff --check`: passed. Node broker rerun was not performed because this worktree and checked dependency roots lack esbuild; root integration owns that check. No UI, mouse, keyboard, focus, Pointer Lock, AppContainer or Godot process experiment was run in this repair.
- Intermediate failures were fixture mistakes, not hidden successes: one incorrect `world_save` method, one expected artifact field path, one missing test borrow. An initial documentation script used the Windows default encoding; rerun explicitly used UTF-8. Final evidence records the corrected source run.

## Remaining gates and findings

Product execution stays disabled: A permits loopback, has no real runtime-check mode, and A/B still need a trusted adapter and heartbeat/cancel/recovery integration. Core registration/evidence are host assertions, not OS attestation. Root owns disabling page-provided application token/evidence and implementing authenticated launch proof. Core `stateHash` remains a shape check until that contract is replaced.

No hostile reparse race proof, disk/CPU/GPU quota, full power-loss exercise, actual model-authored engine execution or browser native integration is claimed. Artifact data remain untrusted. Inherited stdout is child-writable despite path ACLs; logs must never serve as authenticated receipts.

A/B original evidence limitations remain: B uses simulated executor/check/launch results; A has unclassified Godot system-directory errors, treats editor network timeout as denial, and references an untracked parent-environment.log. Those original reports were not rewritten by this repair.
