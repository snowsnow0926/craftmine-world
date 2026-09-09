# ADR-F01: One versioned contract, creation manifest and component library for the authored bases

- Status: accepted for the F task (fragment; the main task assigns the final ADR number and merges it into the ADR index)
- Date: 2026-09-10
- Task: F (editable bases and components), branch `codex/godot-remaining-f-20260910`, inherited `564e43a32ade84b8af1739a2e9f4a999ab97620d`
- Affected modules: `desktop/godot/bases/**`, `desktop/godot/shared/**`, `tests/godot-remaining/F/**`

## Context

The three authored bases grew independently. They had different manifest
formats (`craftmine.godot-base-manifest/1` vs `craftmine.godot-base/1`),
different state format ids, per-base creation tools (first-person had none) and
per-base observation payloads. Each base declared its own components implicitly
through scripts and scenes, so a component could not be listed, hashed, packaged
or installed with a stable identity. The first-person managed adapter forwarded
every `BaseOps` operation instead of a bounded allowlist, and observations had
no build identity or sample time.

The product needs to create, version, package and verify a world without
knowing which base authored it, and the packaging (H), UI (E), model-tool (L)
and acceptance (I) tasks need machine-readable inputs instead of prose.

## Decision

1. **One normalized contract.** `desktop/godot/shared/base_contract.mjs`
   normalizes every base manifest into `craftmine.godot-base-contract/1`
   (pinned engine, world/state/progress/probe formats, exactly one blank-start
   and one example template, preserved state fields and migration table, asset
   manifest/licence, components). Manifests gained additive `contract`,
   `protocols`, `templates` and `components` blocks; no base behaviour changed.
2. **Generated catalogs.** `desktop/godot/shared/tools/build-base-catalog.mjs`
   derives `bases/base-catalog.json` (creation manifest for E) and
   `bases/component-catalog.json` (packaging input for H) from the manifests and
   hashes every declared file. `--check` fails on drift.
3. **Component library.** `desktop/godot/shared/components.mjs` resolves a
   component's files, identity field, persistent state fields and initial state;
   builds a package input; extracts a real instance from a materialized world;
   and plans/applies an installation that assigns a **new** entity id and starts
   from the component's initial state. Data-driven components are written by the
   tool; scene-node components are returned as an explicit `sceneEdits` step, so
   the library never rewrites a `.tscn`.
4. **Observation and bounded operations.** `desktop/godot/shared/observation.mjs`
   defines `craftmine.godot-observation/1` (worldId, buildId, instanceId, baseId,
   baseVersion, sampledAt, payload) and the per-base bounded operation schema.
   `runtime_bridge.gd` exposes the envelope through the additive
   `observe-envelope` op. Every state-installing operation is refused, and each
   base adapter now uses an explicit allowlist that a test cross-checks against
   the shared schema.
5. **Uniform creation.** Every base creates a world with a new world id and
   writes a hashed build receipt; the first-person base gained
   `tools/new-world.mjs`. A blank start may not ship a completed quest, claimed
   reward, checkpoint, target or ability.

## Consequences

- A base version is identified by `contentHash` over its declared component and
  asset files, so a manifest edit without regenerating the catalog fails tests.
- A copied component cannot inherit the source author's progress: the
  installation assigns a new id and the state ledger starts empty.
- Observation consumers must include build and sample identity; the plain
  `observe` shape is unchanged for existing cycle-06 consumers.
- The library deliberately does not automate `.tscn` edits; a scene-node
  component installation reports a required manual step instead of guessing.
- Base versions were **not** bumped: the changes are additive source/contract
  metadata plus the first-person input bindings and the side-view blank/gate
  fix, and no persisted state field was added or removed. A version bump is left
  to the integration decision.

## Alternatives considered

- **Rewrite the bases into one shared project.** Rejected: it would mix global
  `class_name` declarations, which the managed materializer explicitly forbids.
- **Keep per-base manifests and document the differences.** Rejected: it leaves
  E/H/L with three special cases and no drift detection.
- **Auto-edit `.tscn` for component installation.** Rejected for this round: the
  text format is not a stable public API, and a wrong edit is worse than an
  explicit manual step.
- **Make the component library a Godot autoload.** Rejected: it would ship a
  shared global class into every base and break the "only the selected adapter
  is copied" rule.
