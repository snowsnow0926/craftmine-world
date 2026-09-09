# Runtime distribution closure

The Windows layout is `resources/godot/{bases,shared,web}`. K now maps those exact paths back to `desktop/godot/...`; basename collisions still do not match. A staged source must have an `app-bundle` declaration and exact canonical byte/hash pins. Unknown files, denied/unreviewed redistribution and development-only files cannot enter the runtime subset. Source ZIP coverage is unchanged and retains development documents and tests.

Dependency review of the real `shared/materialize.mjs` found direct fixed calls to `side-view`, `top-down` and `mining-sandbox` `tools/new-world.mjs`. They import Node built-ins and read their base's configuration, core, templates and world files. The first-person materializer copies its base directly; its new-world tool is also retained as a supported creation entry point. These four tools now declare `app-bundle` only. Pure test/document/build-tool declarations remain development-only and are excluded by staging.

`shared-runtime.json` covers the reviewed shared subtree `e37e26ede930e31c74f8177e30523bf327096a74`, plus the generated base/component catalogs and the base overview. JavaScript host/materializer/component code and captured authored initial states are app resources. The GDScript runtime bridge, state guard and adapters also enter user exports. The captured state files identify the original authored base, exact engine and source digest; they contain no third-party assets or credentials. Formal project licence application remains pending. Existing licence/redistribution fields are not changed by this scope correction.

The production Web host is `web/runtime.mjs`. The older `web/host.mjs` has no production imports and remains the GD0 development preview transport, so it is excluded. `bridge.js` and `shell.html` are available to the app and to exports.

`stageRuntimeSourceSnapshot` is used by the real resource builder and by the stage fixture. It validates the complete source selection before writes and reports excluded paths. `tests/godot-final/staged-materializers.mjs` stages actual committed base/shared/Web files and runs all four ordinary materializers from that staged directory, in fresh output directories, without running Godot or a model. Its result must be recorded separately from the 14 passing logic/filesystem regressions.

The root-run previous K selftest completed **39/39** with zero failures. Raw output: `test-results/final-preflight-selftest.log`; JSON: `test-results/delivery-preflight-selftest-lzeset/report.json`. This predates the distribution-path changes and is retained as a previous result, not a substitute for the required new run.

## Final distribution validation

The new K run completed **39/39**, zero failures (`test-results/final-preflight-selftest-2.log`, `test-results/delivery-preflight-selftest-5iRWV1/report.json`). All **15/15** authored-pin, runtime-resource and runtime-distribution tests pass after adding an explicit packaged-byte tamper regression. K now checks both the actual distribution path and its byte/hash pin; a matching filename alone is insufficient.

The real staged-materializer fixture completed **4/4** against source commit `ce7f5854c5825207abc2defaefe4f4bff572280b`. First-person produced 66 files, top-down 34, side-view 47 and mining-sandbox 27. The first three included captured initial state; mining-sandbox has no captured initial-state file. This proves staged creation dependencies are present; it does not prove Godot import/export, gameplay, a rebuilt Windows installer, or model acceptance. Raw evidence: `test-results/final-staged-materializers.log` and `test-results/staged-materializers-6k219E/report.json`.

Current source checks report zero asset failures with 144 pending-rights warnings, zero notice failures/warnings, and zero LGPL failures with one warning. The LGPL warning about the full GPL-3 text remains unresolved by this change. Neither a content pin nor a passing distribution test grants third-party rights or completes formal project licence application.

## Canonical bytes and Git status audit

The refresh log records eleven CRLF checkout files rewritten to their existing LF Git blobs. On 2026-09-10, every one was checked with `git hash-object --no-filters`, `git rev-parse HEAD:<path>` and `git ls-files -s`: all three object IDs matched for all eleven files. `git ls-files --eol` reported `i/lf w/lf` with `text=auto eol=lf`; there was no source content diff. For example, `shared/runtime_bridge.gd` has raw/index/HEAD object ID `37cc7255fbb742bb40cc55c60d431d1f8197e870`.

The affected paths are the bases README/base-catalog/component-catalog, shared README, four shared adapters, runtime_bridge.gd, state_guard.gd and tests/driver.gd. Their apparent modified status is stale index file metadata after normalization, not a new source change. Refreshing those exact index entries must produce no staged source diff. The generated distribution manifests are genuine changes and must be committed separately from this metadata refresh.

For the final source freeze, commit reviewed source changes first, refresh against that exact clean HEAD, commit generated manifests, then run the generator again against the new clean HEAD and require an empty `changed` list. Build staging uses verified Git blob bytes, independent of checkout CRLF, so the final source ZIP and runtime pins remain consistent. Any later owned-source change requires another reviewed refresh; third-party changes remain blocked.
