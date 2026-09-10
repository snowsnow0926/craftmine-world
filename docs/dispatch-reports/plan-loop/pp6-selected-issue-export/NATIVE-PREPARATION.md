# Native selected-issue export acceptance preparation

This follow-up adds `tests/plan-loop/issue-export-client-native.mjs`. It has not
been run against Electron or a package. No large profile, build or dependency
installation was performed. The eight small contract/shutdown checks passed,
and `node --check` passed for the prepared runner.

The runner uses the existing strict parameter-package inspector and isolated
environment builder. Package mode requires the independently supplied source
commit and build-manifest SHA256, verifies bundled bytes and uses the bundled
EXE/core/host/runtime without development fallbacks. Development mode requires
the same committed clean source/runtime checkout and its matching runtime
manifest. The executed harness must match the selected source checkout.

Only the existing `worldPanel` acceptance allowlist is extended, with three
already-supported product channels: `issue.followupPrepare`, `issue.followup`,
and `issue.export`. There is no new arbitrary RPC, selector or script entry.
An unsupported `issue.exportAll` call must still fail. The product channel runs
through the actual panel preload/Main gateway and service. Its native save
authorization uses Main's existing fixed headless `selected-issue.json` path;
this does not execute or certify an interactive OS file dialog.

One authored training-range world is built/check-applied, played and explicitly
checkpointed before recording. The runner creates an issue, appends a note and
player retest, exports the selected revision, compares every collected field,
replays the original receipt, and rejects stale revision/path injection/unknown
channel requests without modifying output. Complete runtime snapshot fields,
including savedAt, and raw issue-ledger bytes must remain unchanged. A second
client launch must read identical persisted records, export bytes and progress.
It does not replay an export receipt across restart.

Both exits use `assertCleanHeadlessShutdown`, with bounded quit/grace/kill from
the existing shutdown helper. Any final cleanup failure marks the report failed
and still persists `finishedAt` and the shutdown error. Isolation/window state,
OS exit code, renderer errors, forced-stop state and shutdown failures remain
strict. Initialization terminal failures fail immediately instead of being
swallowed by the polling loop. Exact rejection helpers reject unrelated
transport failures. Independent negative tests alter exported original text,
followup identities, retest state and leaked fields while recalculating a
self-consistent hash; none can satisfy the full-document predicate.

## Commands after integration and compilation

Use the actual integrated checkout as both source and development runtime.
The dependency path provides existing tooling; package mode uses it only for
ASAR inspection. Replace the placeholders with the independently verified new
package identity, not the old frozen 827 build, which does not include PP6.

```powershell
$env:CRAFTMINE_DEPS_ROOT='C:/cm-plan-next-20260910/vendor/pi-desktop/apps/desktop'
node --test tests/plan-loop/issue-export-client-contract.test.mjs tests/player-product/default-client-audit.test.mjs

node tests/plan-loop/issue-export-client-native.mjs --source-root C:/INTEGRATED-CHECKOUT --runtime-source C:/INTEGRATED-CHECKOUT --deps-app C:/cm-plan-next-20260910/vendor/pi-desktop/apps/desktop

node tests/plan-loop/issue-export-client-native.mjs --source-root C:/MATCHING-CLEAN-CHECKOUT --packaged-root C:/NEW-SEALED-PACKAGE/extracted --expected-commit FROZEN_40_HEX_COMMIT --expected-build-manifest-sha256 INDEPENDENT_64_HEX_MANIFEST_SHA --deps-app C:/cm-plan-next-20260910/vendor/pi-desktop/apps/desktop
```

The runner retains logs, report, private profile, ledger and exported JSON under
`<source-root>/test-results/desktop-native-issue-export-*`. Until an actual run
finishes with a passing report and two strict clean exits, native product
acceptance remains pending. UI button behavior has separate production-DOM
coverage in this directory's prior report.
