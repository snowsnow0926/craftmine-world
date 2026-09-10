# Actual finite requirements candidate chain

2026-09-10: **16/16 checks passed** on the first full-chain run,
`test-results/target-feedback-chain-0kQafy`.

The test runs production `CoreClient`, `createGodotExecutor` and
`GodotBuildVerifier` in a hidden offscreen Electron process. Both authored source
sets enter a fresh real Rust core through project create/applyFiles/migrate.
Each real `godotBuild.start` binds the 500 ms finite requirement before the
executor claims the job. The production executor performs fixed broker
preflight/import/export, obtains the actual core check descriptor, calls the
real Godot Web verifier and forwards its untouched observations to
`godotJob.finish`. No job/build/world/instance field is rewritten.

| Source and actual observation | Durable outcome |
| --- | --- |
| Official source patched to 500; live loaded=500, running=500 | Runtime passed; job passed; candidate ready |
| Same requested patch with sibling override; live loaded=700 | Runtime failed; job failed; candidate rejected |

The failed candidate's `godotApplication.prepare` returned
`GODOT_CANDIDATE_NOT_READY`. Both full `world.read` documents remained
exactly equal before and after checking. The executor and core were stopped;
the same core profile was restarted, and both complete world documents and
candidate statuses remained equal. The successful candidate was not adopted.

The actual core executable SHA-256 is
`285578bc384302eaccf2017225d446732ead3daf24c80a52e5150018604060bb`,
the parent's completed release build containing `6ef65b5`. The executor includes
Mill's `727d3a4`, the verifier includes `7070720` and `f359805`, and the negative
fixture is `d6d4437`. This is a development acceptance process using release
core, not a sealed Windows installer or model-generated project.

Raw `report.json` contains the actual claim, descriptor and finish RPCs,
verifier observations, durable outputs and pre/post/restart world documents.
The source fixture bytes, measured input manifests, broker task identity and
native process/network logs, executor ledger and Electron log are also archived.
`raw-evidence-index.json` records original paths, lengths and byte hashes.
No source artifacts or binaries are represented as passing merely by a filename.

Two Chromium WidgetHost interface diagnostic lines occurred during positive
window teardown; their original text remains in `raw/electron.log`. All runtime
assertions passed for the positive case. This report makes no zero-diagnostic,
player-input, model, positive-adoption or unlimited-future-script claim.

Reproduction: run `tests/player-product/target-feedback-chain-native.mjs` with
explicit `CRAFTMINE_NATIVE_DEPENDENCY_ROOT`, `CRAFTMINE_CORE_BIN`,
`CRAFTMINE_GODOT_BROKER_BIN`, `CRAFTMINE_GODOT_BROKER_IDENTITY` and
`CRAFTMINE_GODOT_ENGINE_ROOT`. All application data is newly owned by that run.
