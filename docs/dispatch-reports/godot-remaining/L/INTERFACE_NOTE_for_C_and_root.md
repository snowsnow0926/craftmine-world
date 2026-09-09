# Interface note — wiring task L into the host (C / root / A / F / D / M / N / H)

Prepared by task `L`. Each item is a small, exact change owned by someone else.
Nothing here was applied by task L.

## 1 Live sampler for the running Godot instance (owner: root, with F/D)

`createWorldTools(core, getSettings, isEnded, verifications, reviews, options)`
now accepts a sixth argument. Wire:

```js
createWorldTools(core,getSettings,isEnded,verifications,reviews,{
  sampleLiveState: async ({worldId,buildId}) => {
    // Must come from the RUNNING instance, not from saved progress.
    const frame = await currentGodotFrame();          // host-owned handle
    const reply = await frame.request('snapshot',{}); // craftmine.godot-runtime/2
    return {...reply.result, worldId, buildId,
      sampledAt: new Date().toISOString()};
  },
  isDiscussionOnly: () => session.isDiscussionOnly(),
  budget: () => hostBudgetSnapshot(),   // {tokens,context,requests,compactions,service,wallClock,resource}
  historyMethods: {},                   // override M/N method names when they land
});
```

Sample field mapping already implemented in `godot-observe.cjs:normalizeLiveSample`:
`display.cameraGlobal` → camera, `equipment` → equipment, `targets`/`interactables`
→ entities, `quests` → quests, plus `player`, `inventory`, `hud`, `crosshair`,
`aim`, `viewportSize`, `windowSize`, `inputCaptured`, `hasSave`,
`persistentStorage`, `levelTitle`. The shipped first-person base already returns
all of these from `base_world.gd:snapshot()`; no game-side change is required.

Until this is wired, `godot_runtime_state scope=live` and the `live` section of
`godot_project_facts` return `LIVE_OBSERVATION_NOT_WIRED`. That is the correct
state: unknown, not empty.

## 2 Per-request fact block (owner: C / root)

The facts block is available as `facts.block` (see `godot-observe.cjs:renderFactsBlock`):

```
project: revision=<n> manifest=<sha256> base=<baseId> engine=<ver> target=<t> files=<n> status=source-only
runtime: phase=formal build=<buildId> base=<baseId> entry=web/index.html
candidates: count=<n> latest=<id>:<status>
durableProgress: savedAt=<iso> equipment=<activeId>
live: unavailable(LIVE_OBSERVATION_NOT_WIRED)
```

Integration options, in order of preference:

1. Add a `godot` key to `machineFacts` inside
   `vendor/pi-desktop/packages/agent-runtime/src/craftmine-context.ts:craftmineContextData`
   (facts-at-tail already appends the snapshot as the final text block of the last
   user/toolResult message, so the block stays out of the stable prefix).
2. Or return the block from the host `craftmine.context` handler so
   `getContext()` includes it.

This is a vendor/pi-desktop behavior change and needs a companion ADR plus a
`docs/spec/03-runtime/02-agent-runtime.md` update. Task L deliberately did not
touch vendor. Until then the model can call `godot_project_facts` on demand,
including after any number of compactions.

## 3 Stale system-prompt claim (owner: root / C)

`vendor/pi-desktop/packages/agent-runtime/src/craftmine-context.ts:10` currently says:

> "For Godot work, inspect runtime_info and discover the godot_project_create,
> godot_project_index, godot_file_read and godot_project_patch tools. They
> currently store source-only scene and GDScript files with immutable revisions.
> Godot build, execution, preview and application are unavailable until
> explicitly advertised by the host. The existing verification_submit checks the
> legacy world draft, not a Godot source project."

`godot_build_start`/`godot_build_read`/`godot_build_cancel` are advertised and
reachable (`hello.godotBuildJobs=true`), so the sentence is now wrong and directly
feeds "I have no capability". Suggested replacement:

> "For Godot work, call `godot_capability_report` first: it reports the advertised
> Godot tools, the host method each reaches and whether the core capability flag
> is enabled. Discover tools with ToolSearch by capability or exact name. Use
> `godot_docs` for pinned engine reference and `godot_project_query` to read the
> real project structure before editing. Build, check, candidate and application
> availability must be taken from the capability report and the real tool results,
> never assumed. `verification_submit` checks the legacy world draft, not a Godot
> source project."

## 4 Existing test counter (owner: A)

`tests/godot-project-tools.mjs:118` asserts `assert.equal(tools.length,11)` for
`godot_*` tools. Task L adds six, so the real count is 17. Exact patch:

```diff
-  assert.equal(tools.length,11);
+  assert.equal(tools.length,17);
   for(const name of ['godot_project_create','godot_project_index','godot_file_read','godot_project_patch',
     'godot_asset_put','godot_asset_list','godot_build_start','godot_build_read','godot_build_cancel',
-    'godot_candidate_read','godot_candidate_list'])
+    'godot_candidate_read','godot_candidate_list','godot_docs','godot_project_query',
+    'godot_runtime_state','godot_project_facts','godot_capability_report','godot_history'])
```

This is an inventory update after adding tools, not a relaxation of a behavioral
assertion. Task L did not edit A's file.

## 5 Draft resumption (owner: C / root)

`task.recoverable` and `task.resume` exist in the core but no model tool routes
them; `godot_capability_report` lists them under `unreachableMethods` with owner
`C`. If the product wants the model to resume a draft, add a tool that calls those
methods with the host-bound context; task L did not open a new entry point.

## 6 M / N method names (owner: M / N)

Task L proposes these host method names and probes them at call time:

| Contract | Proposed method | Owner |
| --- | --- | --- |
| history page | `version.history` | M |
| read one version | `version.read` | M |
| compare versions | `version.diff` | M |
| content checkpoint | `version.checkpoint` | M |
| merge candidate | `version.mergeCandidate` | M |
| query operation result | `version.operationResult` | M |
| search assets | `asset.search` | N |
| read one asset version | `asset.read` | N |
| install proposal | `asset.installProposal` | N |
| upgrade proposal | `asset.upgradeProposal` | N |

If M/N register different names, pass them through
`options.historyMethods` — no code change in `godot-history.cjs` is needed.
Until then each call returns `DEPENDENCY_NOT_WIRED` with the exact method and
owner; verified against the real core (`broker-real-core.test.mjs`).

## 7 Plugin build copy list (owner: root)

`desktop/build-world-plugin.mjs` copies an explicit file list into
`desktop/build/craftmine.world`. Task L added `godot-routing.cjs`, `godot-docs.cjs`,
`godot-query.cjs`, `godot-observe.cjs`, `godot-capability.cjs`, `godot-history.cjs`
to that list. Without it the built plugin throws `MODULE_NOT_FOUND` at runtime.
The list was verified to reference existing files; the build itself was not run
because the primary checkout has no `node_modules` (esbuild unavailable).
