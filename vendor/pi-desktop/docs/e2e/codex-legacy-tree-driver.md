# Ordinary blank Web world and real Codex tree driver

Run from the Craftmine repository root after the integrated application and its
own runtime resources have been built. Coordinate the single GPU/application
lease with the integration owner. This preparation did not launch an app or model.

```powershell
node tests/codex-legacy-tree-native.mjs --live --codex "C:/absolute/path/codex.exe" --runtime-resources "D:/absolute/candidate/resources" --packaged-root "D:/absolute/candidate" --output-root "D:/cm-final-legacy-tree/test-results"
```

`--packaged-root` must be the directory containing `Craftmine World.exe`; its
resources must match the explicit `--runtime-resources`. The launcher helper
hashes the actual packaged payload, requires the offscreen/Pointer Lock guards,
and checks the inventory again after shutdown. Omitting `--packaged-root` uses
the existing source launch helper and requires the corresponding built outputs.
The driver refuses to execute without `--live`.

The driver creates a fresh marked profile beneath its printed output directory.
It waits for React and the actual delivered world catalog, verifies
`gpt-6-astra` / `xhigh`, and saves the same Codex backend and Auto permission
setting observed in the player's report. It normally closes and reopens this
independent app so its mounted renderer loads the persisted selection; calling
the Settings RPC alone does not update the existing renderer's settings cache.
It then uses the actual New World form, selects `craftmine-web/5`, the blank
starter and a name, and uses the ordinary Start creating/session flow. No live
player profile is changed. Original text `生成一个树` is inserted into the
empty Composer via its React input handler, then its ordinary Send handler runs.
No synthetic mouse/keyboard, focus, Pointer Lock or user browser is used.

Every raw Agent event is retained in `agent-events.ndjson`; full dialogue,
metrics, check/review results, actual stage timestamps, world records and errors
are in `report.json`. Stdout/stderr and original native review diagnostics under
the profile scratch directory are retained. Transport snapshots are not assumed
to be physical model-call counts. No evaluator, model/token/call/whole-turn cap
is added; individual IPC/preview/shutdown timeouts are existing infrastructure
boundaries. To cancel, create the printed `cancel` file or interrupt the driver.
It aborts its own Agent and requests normal application shutdown.

World/check/review reads use the bound world's existing `pluginBridge` read
channels. The main renderer navigation bridge intentionally refuses generic
`world.read`; the driver must not broaden that product permission. During
preparation, one refused navigation read and two disabled-Send settings-cache
attempts were retained separately with zero model requests. The latter were
explicitly cancelled before Send, not stopped because of model execution time.

After a passed machine check and a completed real request review, the driver
submits the ordinary preview form, obtains read-only `request-observe` data from
that actual preview iframe, captures it and requires visible drawable added
objects. It submits the enabled ordinary apply form, captures the formal world,
and checks applied source identity. It never injects a plan, changes a review
outcome, teleports the player or assigns authored state. A failed review is
reported; the driver does not bypass the apply condition or acknowledge warnings
as a substitute for the tree acceptance.

Saving uses the normal `craftmineView.prepareClose()` lifecycle, which freezes
and saves the actual game progress. The app exits normally and reopens the same
world through the existing world-list form. Require exact applied build, full
saved progress and unchanged visible dialogue IDs; capture the cold frame and
retain both shutdown audits. The renderer mesh observation proves a drawable
addition; tree aesthetics and operation feel still require viewing the captures
and human play. This static driver does not test a second model edit.

Preparation checks, without launching Electron or Codex:

```text
node --check tests/codex-legacy-tree-native.mjs
node --test tests/legacy-tree-contract.test.mjs
```

The three pure contract tests pass: original request/base, actual mesh versus
logical/source-only existence, and complete saved progress/build equality. They
are contract preparation, not a completed real model/renderer acceptance.
