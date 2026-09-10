# PP3 actual client supplements and retest acceptance

Tested client commit: `4992fbb1a8ec68e197e15208d4676b8deaefbe1b`.
Production commits: `20d89b846e68781b23cad48ed677b5e3f55a136c` and `b15ca1e`.
Owned run: `C:/cm-pp3/test-results/desktop-native-issues-mPIqBm`.

## Result

**22/22 actual client checks passed.** The first launch created a real
first-person world, built it through the broker, applied it, played it and
saved a complete frozen checkpoint. The product panel recorded original text
and a player note with the observed formal world/build/instance identity.

The same client submitted a real 500 ms target feedback draft, waited for its
Godot check, previewed its candidate and applied the checked version. During
preview both supplement preparation and append failed with
`ISSUE_CONTEXT_NOT_READY`; reading remained available and a separate temporary
issue could be deleted. Three player retest entries then captured the new
formal build: still-present, player-resolved and reopened. Original issue
description and context stayed unchanged. Replaying the original note request
after the build/revision change returned its one existing entry.

The second full Electron/Rust process read the exact original record and all
four followups. Deleting the issue removed those bodies, and neither old create
nor old supplement receipts resurrected them. A third process confirmed the
deletion. Complete progress snapshots were deeply equal throughout these
checkpoints; no fields, including `savedAt`, were removed from comparisons.
All three processes exited with code 0, no page errors, no input/focus/Pointer
Lock violations, and empty `shutdownFailures`. No forced stop was needed.

`raw/report.json` retains each result and compared native states. All six
stdout/stderr files are preserved. Stderr is not empty: the deliberately
rejected supplement requests, two background `GODOT_CANDIDATE_ACTIVE` refusals
and an Electron console-message deprecation warning remain visible. Passing
shutdown audits do not mean zero diagnostic messages.

## Runtime and source identity

Main, preloads, renderer and the product plugin were compiled in the owned
worktree. The sealed ae32974 runtime was reused read-only because its core,
host-core and Godot source Git tree objects exactly equal this worktree's.
`raw/runtime-provenance.json` records those tree objects and every-file
size/hash comparisons for the copied Godot and Git resources.

- Core SHA256: `285578bc384302eaccf2017225d446732ead3daf24c80a52e5150018604060bb`.
- Host SHA256: `04080dcc21e4909699977055724116fc92a8e6bc19fcdc0ea42e91a2a3b3224b`.
- Frozen resource root:
  `D:/cm-plan-loop-20260910/desktop/build/releases/ae32974eed09-f8b7f079-cede-45ab-814d-9df632e7b101/output/win-unpacked/resources`.

The test accepts explicit `--source-root`, `--runtime-source`, `--deps-app`,
`--output-root`, `--core-bin` and `--host-bin` paths. The native binary hashes
are checked before launching. Its own new profile and empty legacy directory
are isolated; inherited product environment variables are removed. Dependency
junctions are read-only reuse, with builds and resources in the owned tree.
An initial preparation attempt lacked local esbuild resolution; adding an
owned dependency junction resolved that setup error before any native launch.

## Independent negative evidence and regression

Review of 20d89b8 reproduced an invalid `kind: ["note"]` with empty text being
accepted and persisted. The original review JSON is retained unchanged as
`raw/pre-fix-kind-coercion-review.json`. Commit b15ca1e requires actual strings
for followup kind, ledger format and receipt method. The current actual
filesystem regression passes **8/8** and explicitly checks zero ledger-byte
changes after illegal finite requests. Malformed ledger reads reject and keep
the original bad file unchanged. See `raw/strict-service-regression.json`.

The final test-only assertion strengthening was run after the native run; it
does not change production source or the compiled client under test.

## Limits

This is a newly compiled developer client using an unchanged sealed native
runtime, not acceptance of a newly built setup/portable distribution. Requests
use the real renderer panel bridge through finite headless operations; no
physical or simulated UI input is sent. The separately archived production DOM
test covers form behavior, but this run does not claim actual form interaction
or screenshot-based UI verification. It uses one real first-person world and
two actual formal builds, not all bases or a cross-world native scenario.

Player retest states remain human statements, not automatic diagnosis or
verification. No model, upload, credential or external account was used. The
notebook remains local and excluded from world backups. This does not complete
the PP-A15 automatic record-to-repair-to-adoption loop or add multi-process
ledger writes/power-loss guarantees.

Raw files are byte-copied and indexed by SHA256 in `raw-evidence-index.json`;
Git text conversion is disabled. The owned runtime profile remains at the run
path for the integrating task; it is not added to source control.
