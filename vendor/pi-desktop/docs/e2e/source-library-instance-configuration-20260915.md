# Source-library configuration CPU evidence

Scope: independent source checkout and isolated Core data. No model requests,
GPU/GUI input, running user profile, candidate adoption or progress injection.
The existing debug Rust Core is used without rebuilding or changing its RPCs.

The initial targeted run passed 45 cases without skips. Follow-up coverage adds
the production direct controller, repeated installation, root-binding ambiguity
and existing direct/composition regression suites. Plugin packaging and an
isolated DirectLibraryUse renderer bundle are part of verification.

Final expanded run: 74 passed, zero failures/skips: eight Core cases, three
production-controller cases with controlled native dependencies, seven
configuration/SDK/renderer cases and 56 existing regressions. The packaged
module test caught and fixed a CJS-to-ESM builtin import issue before integration.

`tests/source-configuration-core.test.mjs` runs the actual Rust catalog,
immutable package parsing, host binding, source CAS, scene materializer and check
job persistence. Its four routes are `install`, `install-group`, `propose` and
`propose-group`. Manual confirmation uses the production package binding and
turn lifecycle; only the host's begin callback is connected to `workspace.open`
without a model. Group members have different explicit bounds and independent
entity IDs. Assertions inspect actual stored scene text and unchanged progress.
Core and JS services are stopped/recreated before manual confirmation and after
installation. Immutable retries produce one source write and one check.

Additional cases cover search/read/direct visibility for unknown sources,
required-config refusal before install planning/writes/checks, stale explicit
pins, actual stock sandbox/city source bytes, changed scene pins after install,
and legacy limited-area installation with warning-only behavior. The synthetic
component fixture exercises the configuration protocol. Separate published
package tests verify real v3 declarations and unchanged old archive hashes.
The Core has no engine executor: persisted checks must be genuinely `blocked`;
no passed job, gameplay success or runtime position is written into Core.

Three follow-up controller cases execute production DirectLibraryService with
the actual package/materializer/Core path. The native check/adoption dependencies
are explicitly controlled JS fixtures for this CPU contract test; their simulated
passed responses are never persisted in Core. One test prepares/checks/applies
two independent companions, another performs an actual later Core source patch
and verifies refusal, and a third refuses an unknown required configuration
before installation starts. Before the fix, the first apply failed because a
fresh-install configuration decision was reused at candidate-application time.
The test verifies Core's original job is still blocked after the simulated
controller interaction. Actual native acceptance remains separate.

`tests/source-configuration.test.mjs` covers both published companion variants,
all exact source/selector pins, custom-city fallback refusal, finite/order/range
validation, safe structured fields, old-version warnings, the installed PI SDK's
real tool-argument validator (including recipe v3), and actual bundled renderer
inspection/error helpers. This last case is CPU logic, not visual acceptance.

Run in a prepared isolated dependency tree:

```powershell
$env:CRAFTMINE_CORE_BIN='<existing craftmine-core executable>'
node desktop/build-world-plugin.mjs --output test-results/source-configuration-plugin
$env:CRAFTMINE_CONFIGURATION_PLUGIN_DIR='test-results/source-configuration-plugin'
node --test tests/source-configuration-core.test.mjs tests/source-configuration.test.mjs tests/source-library-read-hints.test.mjs tests/godot-final-install-assets/source-library.test.mjs tests/author-source-install.test.mjs tests/companion-bounds-package.test.mjs tests/godot-autosave-candidate.test.mjs tests/world-composition.test.mjs vendor/pi-desktop/apps/desktop/test/direct-library.test.mjs
```

The Core test can run against checkout modules by omitting the plugin directory.
Packaged-module verification is required to catch missing bundled helpers.
Per-run isolated `test-results/source-configuration-core-*/report.json` files
retain the Core hash, test name and called methods. Separate run directories
retain failed diagnostic fixtures; runner output supplies pass/fail. A report's
existence is not a success result.

The existing seven autosave/candidate regressions are included. No additional
autosave production change was justified by this review. Full native follow,
save and cold reopen across city coordinates remains the root integration
playtest, using ordinary player input and the selected model with no added task
token/request/time cap. Do not infer that gameplay passed from these CPU tests.
