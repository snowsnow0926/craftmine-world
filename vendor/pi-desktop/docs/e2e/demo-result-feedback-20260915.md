# Demo result feedback validation

Run CPU-only checks in an isolated worktree/profile:

```text
node --test vendor/pi-desktop/apps/desktop/test/creation-task-status.test.mjs vendor/pi-desktop/apps/desktop/test/creation-result-access.test.mjs vendor/pi-desktop/apps/desktop/test/creation-host-task-status.test.mjs vendor/pi-desktop/apps/desktop/test/creation-request-status.test.mjs vendor/pi-desktop/apps/desktop/test/turn-outcome-card.test.mjs
node tests/demo-result-feedback-headless.mjs
node tests/fb02-creation-result-headless.mjs
node tests/fb02-creation-status-ack-headless.mjs
node tests/fb03-automatic-play-handoff-headless.mjs
node tests/creation-voice-status-headless.mjs
```

These headless cases render the actual React components/hooks using deterministic
host seams. They disable GPU, focus, Pointer Lock and physical input; the voice
case also forbids microphone access. Calls use page functions, never Playwright
mouse/keyboard/click/fill. They do not certify a native world or gameplay outcome.

Verify applied + passed automated checks produces an actionable result title,
without a claim that navigation/following works or progress was preserved. Keep
the gameplay evidence boundary in collapsed details. Test Chinese and English,
ready preview priority, existing world/check surface actions, readable failures
and unchanged raw diagnostics. Capture the applied and attention cards.

Hold a refresh: retain the card but disable adoption and reject an old callback.
Reject the read: keep the record unconfirmed until refresh succeeds. Change session
and world while reads/actions are pending: immediately remove the old result,
ignore its late reply/error, retain the operation lock and unlock correctly. Check
stale source, previous request, unresolved attribution and missing candidates.

Retain the original direct result → preview → formal adoption scenario and its
fixture snapshot assertions. ACK tests distinguish a pending refresh from a failed
read without erasing their original acknowledgement/error assertions. Automatic
handoff tests retain the first-readable-applied, live draft, Ask, explicit full
workbench, historical result, runtime failure and world-switch races. Model activity
and approval still take precedence over old overlay results.

The result/access/request/turn tests passed 22 cases; runtime request-boundary tests
passed 60 cases after the final-result evidence instruction. Runtime TypeScript
passes. Desktop TypeScript reports only the two existing missing declarations for
`godot-artifact-worker-protocol.mjs` and `godot-artifact-worker-host.mjs`; do not
describe that full check as passing. Style-token validation reports the existing
raw 16px radius in unchanged `CraftminePauseMenu.css`; the result styles add no
token violation. The separate root-owned native/GPU demo run
must still establish actual behavior, including the companion navigating obstacles.
