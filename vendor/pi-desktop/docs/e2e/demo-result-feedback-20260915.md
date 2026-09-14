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
passes. A separate cleanup adds precise `.d.mts` contracts for the existing
artifact-worker protocol and host modules, resolving the two initial declaration
errors. The full desktop TypeScript check now passes. The pause-menu radius uses
the existing equal-valued `--radius-lg` token (16px), so style-token validation
also passes without changing its geometry. Initial failing check logs remain
available alongside the successful checks. The separate root-owned native/GPU demo run
must still establish actual behavior, including the companion navigating obstacles.

Run `node --test test/godot-artifact-worker-types.test.mjs` from the desktop
package for the compile-only declaration regression. It checks request/artifact
shapes, discriminated success/failure snapshots, unknown unvalidated progress
fields, the real Node Worker constructor, injected numeric timers, AbortSignal,
Promise<void> completion and string-array diagnostics. Negative assignments must
fail compilation; no global wildcard declaration or `any` escape is added. This
test resolves the existing Electron dependency's Node declarations without loading
Electron, emitting code or creating a worker.

Integration on Windows additionally reproduced `build:deps` reporting no matching
workspace projects because the command-shell script passed literal single quotes
around its pnpm filter. Double-quoting the existing filter builds all five desktop
dependencies. The ordinary script now succeeds on the fresh integration checkout;
the complete desktop TypeScript and style-token checks pass after those builds.
