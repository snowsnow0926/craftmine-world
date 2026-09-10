# New-task engine-copy retirement: implementation handoff

Base: `8276b4540289c0d397c382dff2123edfe1861d42`.
Branch: `codex/task-bin-retirement-20260910`.
Workspace: `C:/cm-issues-package-20260910` (existing clean worktree reused; no new worktree/dependencies/target).

The broker now registers optional retirement proof only for a newly created successful task with two measured empty Jobs, verified profile/work cleanup and a cleared recovery journal. The executor retains a private capability from that live response only. It flushes a full acknowledgment after core finish plus ledger persistence, or after successful preflight registration, before removing the exact two pinned bin copies. The registration, nonce, source identity/hashes, logs and artifacts remain. No old-task scan, cleanup RPC, shared executable, hard link, or sandbox permission change was introduced.

The plugin packaging copy list includes the new private helper. No package, runtime-resource directory, broker identity pin, release binary, user profile or historical test directory was modified.

## Executed checks

- Final combined command: `node --test tests/plan-loop/task-bin-retirement.mjs tests/godot-remaining/C/executor-protocol.mjs`: **46/46 passed**, 15 small filesystem tests and 31 real-executor protocol tests (scripted broker/core stand-ins). Includes 4 new lifecycle cases, including core commit followed by a lost finish reply.
- Initial module and lifecycle runs passed; their original logs are retained alongside the final log. The earlier `unit-final.log` contains 14 tests; the additional stop-after-ack case is included in the authoritative 46-test `combined-final.log`.
- `node --check` succeeded for the executor and new helper.
- `rustfmt --edition 2021 --emit stdout` parsed `task.rs`, `preflight.rs` and `broker.rs`; stdout was discarded and stderr was empty. This is syntax parsing, **not compilation or a Rust test run**.
- `git diff --check` passed. Git's expected CRLF notices are not test failures. Raw logs have a local `-text` attribute so archived byte hashes survive Git storage.

All filesystem mutation was confined to fresh tiny authored fixtures and this worktree's new source/evidence. Fixture engine/broker files contain short literal placeholder strings. No actual Godot executable or template was copied or run, no Electron window was launched, no dependency/target was created, and no historical cleanup was attempted. The <300 MiB budget was respected by using tiny literals rather than real engine staging. Fixture directories remain available; this task does not clean them afterward.

## Required integration work / limits

1. Compile and test the modified Windows sandbox broker, including the new Rust eligibility test. Rebuild broker identity pins and runtime resources from the same source; then rebuild the plugin/client. The supplied frozen 827 broker remains unchanged and cannot supply new proof.
2. Use a **new** short-path owned profile to validate real preflight/import/exportWeb, same-job core acceptance, full progress/restart, both measured Job counts, retained evidence and absent fixed bin copies. Measure logical/allocated space and the added SHA-256 read cost. None of these real-runtime outcomes is claimed by the unit/protocol results.
3. Real locked-file, reparse/hard-link, abrupt crash and disk-full behavior remains unexecuted. The implementation rejects ambiguous identities and reports partial file removal or result persistence failure without rewriting the core's confirmed build outcome.
4. Failed/cancelled/refused/unconfirmed jobs, tasks from lost replies and all historical tasks keep their bin files. Independent Windows-export consumers are not connected to retirement in this slice. Duplicate artifacts and overall disk accounting remain separate work.

See `docs/specs/godot-task-bin-retirement.md` for the exact lifecycle contract. `evidence-index.json` binds the original small-test logs; it explicitly labels them as authored fixtures without real broker/engine execution.
