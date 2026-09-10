# Task path preparation failure closeout

Base: ae32974eed097c9b3308ae53c95ca7533e03532a. Independent tree:
`D:/cm-plan-task-paths-20260910`. Root checkout and frozen package were not edited.

## Finding and fixed native evidence

The failed packaged-client task `im-bdaefe290e3e4f05be6fa125` had a 266 UTF-16
unit redirected editor cache path. Its broker attempt succeeded with engine exit
zero; the executor refused the cache/settings errors as GODOT_COMPILE_FAILED.
The original task successfully imported six assets, so this was not a general
denial of all writes under its work directory. Its work directory was already
cleaned; no claim is made about inspecting that removed directory's original ACL.

The same frozen broker and fixed project were run with only task-root length
changed. At 180 and 245 cache units there were no cache/settings errors. At 266,
both errors recurred. All three recorded process, network and cleanup verification.
Frozen broker SHA256: `2f2393f4b0436682f1fb18a1b77ce624b7d09e68b6e34fc232d67aefe9396107`.
Raw results: [frozen-report.json](evidence/frozen-report.json) and each
`evidence/frozen-{180,245,266}-{raw.json,task.log}`.

The modified broker preserves successful 180/245 imports and rejects 266 with
GODOT_TASK_PATH_TOO_LONG before task allocation. The rejected tasks root is empty,
there is no engine log/process/network receipt, and original project bytes remain
unchanged. [fixed-report.json](evidence/fixed-report.json) and corresponding raw
files contain the evidence. Tested broker SHA256:
`639e11e391707e9b076a34bf5ebb46d77c25cfc83b39a613f688649836cb2c0c`.

The earlier diagnostic attempts in `D:/cm-lp-diag-20260910` used an incomplete
engine-root path (missing staged engine/version components) and failed before
running. Their run1/run2 raw files remain there; they are not counted as successful
probes. The three frozen controls are run3. The final reusable probe is
`tests/plan-loop/godot-task-paths-native.mjs`; its raw source-preservation proof is
also retained at `D:/cm-lp-proof-20260910`.

## Scope

- Task preparation checks the complete redirected cache path in UTF-16 units.
  The 245-unit budget is a conservative empirical compatibility bound, not a
  universal Windows path limit. Deep project paths can have other limitations.
- Executor discovery and failed-job output retain the precise preparation code;
  the existing durable attempt log retains the detailed broker failure.
- Initialization reads the finite code from hash-checked job output. Core
  initialization status verifies job output integrity and world identity before
  publishing the code, including after restart. Arbitrary messages are not mapped.
- Player creation stage/error stage identify the initial build and display a
  concise Chinese explanation without raw paths. Other failed stages no longer
  point at the preceding completed stage.

No global configuration, ACL broadening, junction-based task redirection, shared
scratch root, retry of this failure, or successful-candidate shortcut was added.
This change does not make the 266-unit layout supported; it makes refusal explicit.

## Default path and follow-up assessment

`craftmine-product.ts` chooses `%LOCALAPPDATA%/CraftmineWorld`; PluginRuntime places
plugin data immediately beneath that root in `plugins/data/craftmine.world`.
The default on this Windows account is
`C:/Users/WINDOWS/AppData/Local/CraftmineWorld/plugins/data/craftmine.world/godot/tasks`.
With the actual 27-character generated task id, its cache is 186 units, leaving
59 units within the compatibility budget. No default user data was written by
this calculation or test. The long packaged-test profile is not this default.

The present 46-character profile is `craftmine.godot.task.<taskId>`. Merely changing
the prefix to `cm.` saves 16 units, leaving the failing example at 250, still over
budget. Re-encoding the generated 96-bit random portion could save more without
moving work, but requires explicit namespace/collision policy and consistent
attestation, task validation and recovery tests. Recovery already records actual
profile name and measured SID and re-derives the SID before deletion. This patch
does not change those names or migrate old records. A separate owned work-root
design is unnecessary for the currently calculated default and is not attempted.

## Validation

- Sandbox Rust: 35 library + 2 boundary tests pass ([raw](evidence/rust-tests.log)).
- Executor protocol: 27 pass ([raw](evidence/protocol-tests.log)); these use the
  explicitly scripted broker fixture, not real OS isolation.
- Creation state tests: 17 pass ([raw](evidence/ui-state-tests.log)).
- Real SQLite/core world tests: 9 pass, including restart persistence, corrupt
  output rejection and arbitrary-text fallback ([raw](evidence/core-tests.log)).
- Desktop TypeScript: `tsc --noEmit` exit 0 ([raw](evidence/typecheck.log)).
- Three modified-broker native cases above pass their explicit expectations.

The complete Windows package is not rebuilt or reaccepted here. No paid model,
credentials, real mouse/keyboard/focus or Pointer Lock was used.
