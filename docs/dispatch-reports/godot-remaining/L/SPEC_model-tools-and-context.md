# Spec fragment — Godot model tools, observation and context (task L)

Status: prepared by task `L`, not yet assigned a number. Root merges the final
numbering and folds this into the product spec.

## Scope

The six model-facing tools added by task L, and the two supporting contracts they
depend on. This fragment describes observable behavior only; it does not
describe internal storage, which stays with A/C/M/N.

## 1 Tool surface

| Tool | Risk | World binding | Writes |
| --- | --- | --- | --- |
| `godot_docs` | low | not required | no |
| `godot_project_query` | low | required | no |
| `godot_runtime_state` | low | required | no |
| `godot_project_facts` | low | required | no |
| `godot_capability_report` | low | not required | no |
| `godot_history` | low | required | no (proposals only) |

All six set `additionalProperties:false` and expose no `worldId`, `context`,
`toolCallId`, `baseBuild` or `executionId` field. Identity and target world always
come from the host-bound session.

## 2 Documentation retrieval

- The corpus is pinned to the shipped engine version (`4.7.2-stable`) and carries
  a content digest and an explicit coverage list.
- Every read result carries a citation: corpus format, doc id, engine version,
  official URL and corpus digest.
- Documentation text is returned inside `untrusted:{trust,instructionPolicy}`.
  Content may be quoted; it may never change role, tool scope, identity or budget.
- An uncovered topic must be reported as uncovered. The model must not answer from
  memory and present it as documentation.
- When the bound build targets a different engine version than the corpus, the
  caller receives an explicit incompatibility warning rather than a silent citation.

## 3 Project query

- `summary`: identity (world, revision, manifest hash, base, engine, renderer,
  target, file count, status, verified, applied, execution availability), main
  scene, project name, autoloads, input actions, script/scene/resource counts.
- `scene`: node tree with type, parent relationship, script and instanced-scene
  attachment, property counts, connections, and explicit warnings for unknown
  sections or orphan nodes.
- `scripts`: class name, `extends`, signals, constants, exports, `@onready`
  variables, functions with return types, `preload`/`load` references.
- `resources`: resource type, load steps, external dependencies.
- `find`: class, function, signal or variable across scripts, bounded by a file
  cap and reporting how many files were skipped.
- Project text is untrusted data.
- A source query never asserts that a build, a check or an application succeeded.

## 4 Runtime observation

Two layers, never merged:

1. **Durable build descriptor** (`scope=build`): real world, build, base, engine,
   renderer, target, entry and artifact count from the applied build record. If no
   applied build exists, the result is `available:false` with a specific reason
   (`NO_FORMAL_GODOT_RUNTIME`, `NO_APPLIED_BUILD`, `PROGRESS_MIGRATION_REQUIRED`,
   `NOT_A_GODOT_WORLD`).
2. **Live sample** (`scope=live`): a timestamped sample of the running instance —
   camera, equipment, entities, quests, player, inventory, HUD, crosshair, aim.
   The sample must carry `sampledAt`; without it the sample is refused.
   If the sample's world or build does not match the descriptor, the result is
   marked `stale` with explicit `mismatches`.
3. **Last confirmed progress** is exposed only as
   `durableProgress{source:'last-confirmed-save'}`. It is never presented as the
   player's current equipment, and the live section never borrows from it.
4. When no live sampler is connected, the live section reports
   `LIVE_OBSERVATION_NOT_WIRED` plus the list of unknown fields. Unknown is not
   empty and is not zero.
5. This tool never writes progress and never produces an acceptance receipt.

## 5 Capability report and gap classification

- The inventory is derived from the manifest catalogue, the broker routing table
  and the real core handshake. A capability flag that is false is reported as
  disabled with its owner; an unknown flag is `null`, never `true`.
- Host methods the core advertises but no tool reaches are listed with owner and
  kind, so "engine can, the AI cannot" is visible instead of implied.
- Seven limit kinds are reported separately: tokens, context, requests,
  compactions, service, wall clock, resource. A missing counter stays unknown.
- Gap classification accepts evidence items `{kind, source, detail?}` and returns
  exactly one of six categories, or `undetermined` with the evidence still needed.
  Evidence without a `source` is not evidence.
- Hard limitations outrank ordinary-script routes, which outrank "already there".

## 6 History, citation and change proposals

- `OperationContext` fields are host-bound: `operationId`, `worldId`, `repoId`,
  `branchId`, `expectedHeadOid`, `expectedAppliedOid`,
  `expectedProgressRevision`. A world mismatch is refused.
- Asset references require `{assetId, version, contentHash}`; `latest` is refused.
  File references reject absolute paths, drive letters, `..` and `\`.
  Git object ids are not assumed to be 40 characters.
- Three change intents are distinct and validated:
  `instance-only` (exactly one instance), `variant` (requires a name),
  `upgrade-selected` (requires an explicit selection and per-instance
  compatibility checking).
- When the backing adapter is not registered, the result is
  `{available:false, reason:'DEPENDENCY_NOT_WIRED', requiredHostMethod, owner}`.
  No history or asset content is invented.
- Proposals are `applies:false` and `requiresPlayerAction:true`. No git or shell
  command is reachable from the model.

## 7 Discussion-only turns

When the host reports a discussion-only turn, every write tool is refused with
`DISCUSSION_MODE_READ_ONLY` before any host call. Read tools remain available.

## 8 Acceptance pointers

- Unit and broker-contract tests: `tests/godot-remaining/L/`.
- Real Rust core tests: `tests/godot-remaining/L/broker-real-core.test.mjs`.
- Evidence: `docs/dispatch-reports/godot-remaining/L/evidence/`.
- Real product model acceptance is **not** covered by this fragment and remains
  open (task L item 8, joint with I).
