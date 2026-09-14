# Author source installer: actual Rust Core contract

Validation completed against production source `c04cef7e` and the existing
candidate's `craftmine-core.exe`; no production code changed for this test.
Core SHA-256:
`7bb13bcf09a355ca103c7ed3b5485c73e1a34ea6178b1cecef82f31fff07fa70`.

Run `node --test tests/author-source-install-core.test.mjs` from the project root
with `CRAFTMINE_CORE_BIN` pointing to that already-built executable. All four tests
passed, zero skipped, in about 3 seconds. Each test creates an independent data
directory through normal Core APIs and stops its own hidden stdio Core process.
It does not copy a player profile or modify SQLite directly.

The fixture imports an immutable, minimal scene-node package through actual
`asset.import` and `asset.read`. It creates a Godot world/source fixture and one
active author workspace. Both explicit `install` and `install-group` pass through
the real source-library service and author installer to actual Rust
`package.planInstall`, `godotProject.applyFiles` and `godotBuild.start`.

Verified outcomes:

- The existing scene entity survives, with one or two distinct new instance IDs
  and the requested scene positions. Each installation advances the source once.
- Source writing and the check job belong to the original author context/task;
  installation neither opens nor ends an additional manual package workspace.
- Replaying the same tool call returns the same source, instances and job.
  `applyFiles` and `build.start` each run once; changed arguments under the same
  invocation are rejected.
- Host cancellation, permission revocation and selected/captured world changes
  prevent mutation. An actually created second world also rejects the first
  world's author binding with `PROJECT_WORLD_BINDING_MISMATCH`.
- After actual `workspace.endTurn(status=aborted)`, an intentionally stale host
  authorization fixture still cannot write: Core returns `TASK_INACTIVE` from
  `applyFiles`, source revision/hash stay identical, and no check is created.
  Read-only inspection and package planning can still run in this negative case.

No executor is registered. The actual check jobs therefore remain **blocked**;
no enqueue, engine build, renderer, model call or adoption is claimed. The tiny
scene fixture proves the source-install protocol, not a second visible dog or
the appearance/behavior of the production Pomeranian asset. Those are separate
native player acceptance paths.

Final evidence lives under the validation worktree's `test-results`:

| Report directory | SHA-256 of report.json |
|---|---|
| `author-source-core-9Q90qp` | `b15b702b54886840094a61d468fbd7f724bc9d4bfa9a19e2c36645dc1c41d511` |
| `author-source-core-5KeQLD` | `5ae5db2f96e1255433d7bbba6c56e97305bd7521e9c406875e74a877f36fc1c0` |
| `author-source-core-PuEdvE` | `705c49f3d0ee051468857f872af3d6ff8a93ada43e1d5fd05c99d65fb9efdf9b` |
| `author-source-core-kn1osK` | `17c6fd011f0ab4e5ef4e428cece85ae97233fafdf82b57c66eff8f7508103117` |

Earlier development assertions expected a different cancellation error and no
attempted write. The actual correct contract is a refused write with
`TASK_INACTIVE`; those earlier private test outputs were retained, not altered.
