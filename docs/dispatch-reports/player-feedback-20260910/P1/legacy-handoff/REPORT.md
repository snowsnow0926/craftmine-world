# Legacy retry scheduling handoff closeout

Base: `68868164ae9d65855ee9361135d8a5105cb8ff6d`.
Worktree: `D:/cm-fb-legacy-handoff-20260910`.
Branch: `codex/fb-legacy-handoff-20260910`.

## Observed failure, retained unchanged

The completed 688 run at
`D:/cm-fb5-20260910/test-results/desktop-native-lr-xkLzVU/report.json`
passed its real native-failure fixture and durable-failure read, then failed
the third step immediately after its single retry acknowledgment. The full
target row before/after retry is identical. The only executor job is the
original fixture check with its two earlier successful engine tasks. No new
broker attempt is present. This does not rule out an earlier Core preparation
RPC; no SQLite database was opened to expand that claim.

Original report SHA256:
`de38f5a213268e930cfd37f2df101a3dadc4bf5d3a30ee1898ed63e73afe0eff`.
Final original executor-ledger SHA256:
`55f9d9626e2a5d3fb0a4fda05414503261e18897e0d2f608a570183fa772318b`.
The fixture and client both exited zero; the client had no forced stop and
empty violations, pageErrors and shutdownFailures arrays. The old run remains
failed, and is not retrospectively relabeled as successful recovery.

`recorded-failure-audit.json` is a byte-identical copy of the independent
read-only audit (SHA256
`a673e2570304ea7a43da6129b3c1bbe2f385918a96bef39957901c6838ae2615`).

## Change and verification

The tracked driver records the complete failed baseline, checks it immediately
before dispatch, records one retry and its exact acknowledgment, and observes
a strictly bounded old-row handoff. Only the unchanged baseline may remain
failed before any preparing state and for less than 30 seconds. All new
failures and failed-after-preparing outcomes reject immediately. The original
source/bridge/abort/new-job/full-progress/restart checks remain intact.

Validation, no native or model calls:

```text
node --check tests/player-feedback/P1/legacy-retry-client.mjs
node --test tests/player-feedback/P1/legacy-retry-handoff.test.mjs tests/player-feedback/P1/legacy-retry-contract.test.mjs tests/player-feedback/P1/legacy-runtime-ready.test.mjs
```

13/13 passed, including four tests executing the actual checked-in retry step
with controlled callbacks. Raw output:
`D:/cm-fb-legacy-handoff-20260910/test-results/legacy-handoff/tests.log`, SHA256
`19c929da145eec3843ea3b5f72352d5f0221294f869247b8f4cf8d8821d9dc7e`.
The E2E documentation append preserved all 610907 original bytes. A new English
spec describes the finite boundary. No product module, frozen root5 source,
historical profile, report or marker was modified. Native validation is pending
the next immutable package; no new installation, model request or engine run
was started. Root owns integration and the subsequent package run.
