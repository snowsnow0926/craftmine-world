# P6 preparation and bounded import repairs

Base: `dd46e2715ef898a26eb3c25a6fc15878e06e909e`. Branch: `codex/fb-p6-20260910`.

Status: actual new client acceptance is pending the integration owner's frozen compiled candidate. No old package or prior acceptance is counted for this source.

## Confirmed integration gaps repaired

- The retained picker returned an object nested as `sourceRoot`; Main expected a string.
- The Main directory picker intentionally supplied an empty file path, but `importRequestFor` treated it as a usable path.
- The plugin lacked an explicit user-selected read policy, and the Main asset route supported metadata only. This slice adds exact import/preview operations with native-grant checks, bounded directory metadata preflight, and selected-world/session checks.
- Actual import/preview UI handlers are now form submissions usable by the finite no-input acceptance helper. Preview probes bind selected asset and version; no path can be supplied by that helper.

Integration owner must wire `authorizeAssetSource: (root, path) => plugins.authorizeCraftmineAssetSource(root, path)` into the existing panel gateway and allow only `asset.import`, `asset.preview`, `asset.cancel` alongside `asset.annotate` in Main navigation. The plugin must be rebuilt to copy the revised manifest/view. No Main index or navigation file is changed here.

## Verification so far

- R6 model/controller regression: 18 passed (`test-results/p6-asset-model.log`).
- Actual React DOM and finite fixture bridge: 16 passed, final `test-results/asset-forms-g2qm20/report.json` and `p6-asset-forms-bound-version.log`.
- Main asset route grant/identity cases: 6 passed (`p6-import-route.log`).
- Exact production grant/resolver methods with real filesystem and policy helpers: 6 passed (`p6-source-grant-third.log`). The surrounding plugin process/native picker is a fixture, not client acceptance.
- Native harness and view syntax checks passed. Full desktop TypeScript/build and actual native client have not run for this slice yet.

Retained preparation failures: DOM fixture initially left the favorites filter active before importing, then used asynchronous `rejects` for a synchronous validator exception. Both original reports/logs remain. Grant-test setup initially placed a return at TypeScript module scope, then injected a reserved `default` parameter; original logs remain. These were harness failures, not production success evidence.

All new test data are under the owned D-drive tree, with no actual mouse/keyboard, focus, Pointer Lock, personal profile, or model call. Small hard-link rejection fixtures are new owned test files, not links to shared or historical data.

## Required remaining evidence

Run the extended asset client entry and existing parameter-default and selected-issue-export entries against the same newly compiled source. The asset entry now requires actual directory pick/scan/import/PNG preview, clear tags, stale owner rejection and restart, with strict shutdown and exact immutable asset hashes. Confirm real client errors instead of weakening these assertions.

The asset library currently has no direct PNG-to-world insertion action. Its PNG preview must not be called world reuse. The integration owner selected the existing CP ZIP install/check/apply/save/reopen route for separate real reuse evidence; this slice does not create a new PNG-to-package product.
