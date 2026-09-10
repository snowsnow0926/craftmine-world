# P7 new task engine retirement

Base: `b23c60be`, own tree `D:/cm-fb-p7-20260910`, branch
`codex/fb-p7-20260910`. Test data, temporary files and separate Cargo targets are
on D. No historical C profile, release, retained engine, window input or focus
was changed. Dependency cache is read-only `C:/cm-plan-next-20260910`.

## Actual finding and fix

Baseline `p7-native-wDa7iy` used a freshly built release broker and real 4.7.2.
Native network and version succeeded; both process identities were verified
before resume, work/profile cleanup completed and Core registered. Nevertheless,
the native preflight's single Job query immediately after process exit returned
`jobActiveProcesses: 1`, so `binRetirement` was null and the 180,858,888-byte engine
was correctly retained. This is not a failed isolation or a passed retirement.

`launch.rs`, `preflight.rs` and `task.rs` now query the same owned Job for up to
two seconds after its process exit, with ten-millisecond polling intervals.
Only an actual zero qualifies. A nonzero deadline result and failed query are
preserved, never converted to success. No executable placement, SID/ACL, child
policy, Job limit, receipt, stdio or Core gate was relaxed.

Intermediate `p7-native-nNoQQ6` proves fixed native/version retirement, then the
test fixture failed `INVALID_PROJECT_PATH` because it submitted `.gitignore`.
The driver now uses the initializer's finite source extensions. Production path
validation was unchanged. Both unsuccessful runs and their raw outputs remain.

## New native evidence

Final: `p7-native-p752ZX/report.json` ([archived report](evidence/native-final/report.json),
[byte-preserving archive index](evidence/index.json)).
The actual production executor invokes the newly built release broker; a real
Rust Core confirms registration and jobs. The production GodotBuildVerifier
checks real Web exports in hidden, non-focusable, offscreen Electron views with
its input guard. There is no scripted check result or model call.

- Two independent successful worlds: real import + Web export + runtime check,
  Core `passed`, and both task bins retired per world.
- Four version/registration tasks: all retired, including the new preflight
  after constructing a fresh executor on the previous ledger.
- One deliberately invalid GDScript project: actual Core `failed`, one import
  task's two binaries and complete diagnostics retained.
- Each acknowledgment boundary first confirms broker exit and complete stdio
  closure while both binaries still exist. Post-ack inventories verify only
  those binaries disappeared; logs, sources, artifacts, identities, registrations
  and directory sets are unchanged. Only ack/result files were added.
- Executor restart preserves all 82 existing task files (260,677,630 logical
  bytes), including the failed task, without using old ledger records as a
  deletion capability. World records/full initial progress remain unchanged.
- Electron close: code 0, no signal, no forced termination; Core close: code 0.

Eight task bins retired: **1,453,367,360 logical bytes**. Actual D free space was
187,667,918,848 before and 187,321,999,360 after. The latter also includes retained
failure/export artifacts and concurrent D activity; it is not an allocated-space
measurement or proof of a 1.45 GB physical free-space increase.

Binary SHA256:

- release broker: `567d8afc2a689161f279ef386143621c6892e17a9caf55139c4aae20056f8c6e`
- debug Core: `19bdefa5b3ef601415c48df487750c5295417edaa2105ef3cafd900a590f3c2f`
- Godot editor: `ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424`

The report records the base commit, working-tree patch state and exact source
file hashes. The Core is the unchanged base's debug build; broker source includes
this P7 patch. This is not a claim that the base commit alone contains the fix.
The final package must rebuild and repin the broker from its own frozen source.

## Commands and separate fixture evidence

```
cargo build --manifest-path desktop/godot/sandbox/Cargo.toml --offline --locked --release -j 1 --bin godot-host-broker
cargo build --manifest-path vendor/pi-desktop/Cargo.toml --offline --locked -j 1 -p craftmine-core --bin craftmine-core
cargo test --manifest-path desktop/godot/sandbox/Cargo.toml --offline --locked --release -j 1 --lib
node tests/player-feedback/P7/retirement-native.mjs
node --test tests/plan-loop/task-bin-retirement.mjs tests/plan-loop/task-bin-retirement-close.mjs tests/godot-remaining/C/executor-protocol.mjs
```

Set `TEMP`/`TMP` to this tree's `test-results/temp`; use separate D Cargo targets,
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`, and the authorized
`CRAFTMINE_NATIVE_DEPENDENCY_ROOT`. There are 38 passing broker unit tests, including
two new accounting-lag/deadline/unknown cases, and 53 passing authored retirement/
transport/executor regression tests. The latter cover duplicate retirement,
refused/lost acknowledgment, late stdout/stderr, unknown exit, pending recovery,
changed identity/file set and stop-before-unlink. These 53 cases are fixtures,
not additional actual Godot acceptance runs.

## Remaining boundaries

No production executor change was needed. Existing rare partial-unlink handling
and log-close preservation are unchanged. Failed retained tasks still consume
space; no historical scanner or failed-task cleanup policy was added. Real
Godot late-pipe corruption/unknown-exit faults were not induced. Same-source
packaged-client retirement, Windows export consumers and player manual testing
remain separate tasks. Root must rebuild broker and refresh its trusted identity
manifest; a copied old binary cannot inherit this result.
