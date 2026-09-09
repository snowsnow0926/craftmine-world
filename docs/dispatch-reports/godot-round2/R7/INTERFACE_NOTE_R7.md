# Interface note — wiring R7 into the host (R1 / R2 / C / R4 / R6 / R8)

Prepared by task `R7`. Each item is owned by another agent; nothing here was
applied outside R7's files.

## 1 Host wiring R7 needs (owner: R2, with R3)

`createWorldTools(core, getSettings, isEnded, verifications, reviews, options)`
accepts a sixth argument. Three optional providers turn the remaining gaps into
live behaviour:

```js
createWorldTools(core,()=>pi.plugin.getSettings(),isEnded,verifications,reviews,{
  // 1. Live observation. `GodotWorldViewHost` already tracks
  //    {worldId,buildId,instanceId}; expose its snapshot to the plugin.
  sampleLiveState: async ({worldId,buildId}) => {
    const sample = await godotWorldViewHost.snapshot();   // real running instance
    return { ...sample, worldId, buildId,                    // identity is host-bound
             instanceId: sample.instanceId,
             sampledAt: new Date().toISOString() };          // host clock, not game clock
  },
  // 2. Seven-kind limit accounting. Missing counters must stay absent, not zero.
  budget: () => hostBudgetSnapshot(),
  // 3. Discussion-only turns. Optional: the broker also reads
  //    settings.discussionOnly / settings.readOnlyTurn.
  isDiscussionOnly: () => session.isDiscussionOnly(),
});
```

Sample fields consumed by `godot-observe.cjs:normalizeLiveSample`:
`sampledAt` (required, ISO), `worldId`, `buildId`, `instanceId` (required),
`base`/`baseVersion`, `display.cameraGlobal`, `equipment`, `targets`,
`interactables`, `quests`, `player`, `inventory`, `hud`, `crosshair`, `aim`,
`viewportSize`, `windowSize`, `inputCaptured`, `hasSave`, `persistentStorage`,
`levelTitle`. The shipped first-person base already returns all of these from
`base_world.gd:snapshot()`; no game-side change is needed.

Freshness window defaults to 30s and can be tuned with `options.maxSampleAgeMs`.
A replaced instance, a different world/build, a missing identity or an expired
sample is reported as `stale` with `mismatches`; the previous accepted instance
is tracked per world, and only a fresh, identity-verified sample becomes the new
baseline. Until this is wired, `godot_runtime_state scope=live` returns
`LIVE_OBSERVATION_NOT_WIRED` — unknown, not empty.

## 2 What R7 consumes from C (owner: C)

Already registered by R1 and used read-only by the model:

| RPC | Model tool | Note |
| --- | --- | --- |
| `godotExecutor.status` | `godot_jobs mode=status` | no args; real gate + registered executors |
| `godotJob.usage` | `godot_jobs mode=usage` | `{worldId, context}`; durable per-job bytes/time |
| `godotJob.continue` | `godot_jobs mode=resume` | `{worldId, toolCallId, originJobId, context}`; idempotent |
| `godotBuild.read` / `godotBuild.cancel` | existing tools | unchanged |

Token-gated methods (`godotJob.claim/progress/heartbeat/finish`,
`godotJob.checkDescriptor`, `godotExecutor.register/revoke`) stay host-only and
are listed in `godot_jobs.tokenGatedMethods` so the model knows they exist but
are not its to call. If C adds a queue read that is safe for the model, add it to
`godot-jobs.cjs:MODEL_SAFE_METHODS` rather than widening the token surface.

## 3 Draft recovery (owner: R2 for the UI, R1 for the RPC)

`godot_draft_recovery` uses the existing `task.recoverable` / `task.resume`.
The model path additionally verifies that the exact `taskId`+`generation` is
still listed for the current project **and belongs to the current session**, so a
stale or foreign selection fails with a precise reason. A UI entry for the player
can reuse the same host channel (`host-requests.cjs` already validates the
selection). Reasons map as: expired (`TASK_NOT_RECOVERABLE`, `STALE_GENERATION`),
conflict (`NEW_TURN_REQUIRED`, `TASK_BINDING_MISMATCH`, `STALE_RECOVERY_SELECTION`,
`WORLD_REVISION_CONFLICT`, `WORLD_APPLICATION_BUSY`); unknown codes are preserved
with `unknown:true`.

## 4 Vendor documentation sync (owner: R7 prepared; root merges)

R7 changed `vendor/pi-desktop/packages/agent-runtime/src/craftmine-context.ts`
and added `craftmine-godot-facts.ts`. Per `vendor/pi-desktop/AGENTS.md` this
needs:

- ADR: `docs/adr/` entry describing that the per-request tail snapshot now carries
  a durable `godotFacts` line derived from the host journal, that it is not live
  state, and that the system prompt defers capability claims to
  `godot_capability_report`.
- Spec: `docs/spec/03-runtime/02-agent-runtime.md` §5.1 — the facts block content
  and its size bound (still inside the existing 48000-byte cap).
- E2E: `docs/spec/06-delivery/04-e2e-test-plan.md` — a scenario asserting the
  block appears after a compaction and never contains live equipment.
- Related ADRs already amended by this area: 0064, 0136, `craftmine-batch07-request-facts-at-tail.md`.

Fragments for the ADR/spec text are in
`docs/dispatch-reports/godot-round2/R7/SPEC_R7_model-runtime-and-recovery.md` and
`ADR_R7_live-and-recovery-boundary.md`.

## 5 R1 registration needed for asset/package/history (owner: R1)

R7's tools are bound to the delivered method names and verified against the real
core, which answers `UNKNOWN_METHOD` today. Registration is a `main.rs` dispatch
table addition (R1 owns the file):

```rust
// package.* — from H REGISTRATION_H.md
"package.register" => return journal.package_register(params),
"package.check"    => return journal.package_check(params),
"package.install"  => return journal.package_install(params),
"package.list"     => return journal.package_list(params),
"package.read"     => return journal.package_read(params),
"package.progress" => return journal.package_progress(params),
"package.grant"    => return journal.package_grant(params),
"package.upgrade"  => return journal.package_upgrade(params),
"package.uninstall"=> return journal.package_uninstall(params),
"package.restore"  => return journal.package_restore(params),
"package.export"   => return journal.package_export(params),
"package.import"   => return journal.package_import(params),
"package.usage"    => return journal.package_usage(params),

// asset.* — from N INTERFACE_N.md §3 (16 methods)
"asset.search" => return journal.asset_search(params),
"asset.read"   => return journal.asset_read(params),
"asset.versions" => return journal.asset_versions(params),
// ... remaining 13 asset.* lines as listed in INTERFACE_N.md

// content.* — M's proposal; M has not written the RPC layer yet.
// Suggested names: content.history / content.version / content.diff /
// content.checkpoint / content.mergeCandidate / content.operationResult.
```

After registration, `godot-routing.cjs` must flip three entries from
`reachable:false, blockedBy:'DEPENDENCY_NOT_WIRED'` to `needs:[...]`:
`asset_library` (needs `publishesWorlds` or the flag N adds to `hello`),
`package_library` (same), `godot_history` (needs the content-history flag).
`godot_capability_report` will then report them as reachable with no code change
in the tools themselves. If M registers different method names, pass them through
`options.historyMethods`.

## 6 Real-model acceptance R7 needs from R8 (owner: R8)

R7 provides the tool surface; the real-model story needs the product client and a
model. Minimum path:

1. Create a world, create a Godot project, ask for the crosshair/weapon change;
   the model must call `godot_capability_report` first and then the real tools.
2. Ask for a top-down shop/quest; verify `godot_project_query` and
   `godot_build_*` are used, and that a real compile/run error is repaired from
   the actual engine output (keep the failing attempt in the record).
3. Interrupt the task, restart, then resume through `godot_draft_recovery`;
   assert the project revision and requirements survive.
4. Run three compactions, then continue editing; assert `godotFacts` and
   `godot_project_facts` reconstruct the same identity.
5. Retrieve and reuse a fixed asset/package version; assert the tool reports
   `DEPENDENCY_NOT_WIRED` until R1 registers, and that the model never fabricates
   the result.

Record the model identity, tool calls, real errors and artifacts separately from
module tests. R7's 98 tests are module/contract evidence only.

## 7 Environment note

The primary checkout and the worktrees have no `node_modules`. To build the
plugin, R7 reused the existing install at
`test-results/worktrees/godot-cycle03/vendor/pi-desktop` through a read-only
directory junction (`vendor/pi-desktop/node_modules` and
`vendor/pi-desktop/packages/agent-runtime/node_modules`). A full
`tsc -p tsconfig.json --noEmit` for the agent-runtime package was not completed
because the host was overloaded; the new file typechecks standalone and the
esbuild bundle of `craftmine-context.ts` succeeds.
