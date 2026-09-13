# Player connection verification

## Automated fixture evidence

Run `node --test tests/codex-connection.test.mjs tests/codex-world-author.test.mjs`
from the repository root. Connection fixtures use temporary directories and
in-memory app-server doubles. The existing transport regressions also use a
hidden mock subprocess. No real credentials, browser opening or AI turns occur.

Covered: compatible detection and selection; missing CLI/version mismatch;
actual-account response projection; absent login and API-key mode; paginated
model discovery; missing model/effort without fallback; endpoint rejection;
unknown-diagnostic suppression; explicit login/browser step; matched completion;
owned cancellation and late-result fencing; completion-before-response and
completion-verification races; process failure; rejected arbitrary
RPC/URL input; unsafe auth hosts/schemes; cancel during version detection. A real
hidden mock subprocess also exercises the restricted startup, matching login
notification, account/catalog recheck and process exit without creating a thread.

Recorded results: 20 connection tests and 16 existing author tests pass. Full
desktop TypeScript `--noEmit` passes with workspace source aliases; i18n catalog
and renderer-key checks pass (16 tests). `git diff --check` passes.

`node tests/codex-connection-ui.mjs` bundles the real row and i18n copy with a
fixture API, then uses independent headless Chromium and pure page-script events.
Set `PLAYWRIGHT_MODULE` and `CHROME_PATH` when those runtimes are not on ordinary
module/browser paths. Six checks pass: verification gates Save, missing account
feedback, no automatic browser login, verified settings save, narrow Chinese
layout without horizontal overflow and no page errors. Reports/screenshots live
in `test-results/codex-connection-ui`. Component fixture screenshots use existing
settings CSS plus the component's utility rules; they are not full-app screenshots.

## Native/player acceptance

With an independent ordinary application profile, inspect the original Settings
General row and test the same statuses against the native channel. Existing
worlds must still open when no CLI is selected. The player may select their
compatible CLI, verify the reported account and save the backend, then create
through the existing Agent Composer. Verify the normal metadata remains
`gpt-6-astra / xhigh`. Capability listing alone is not live-author acceptance.

Real login is player-operated; automated validation must not log out, replace
developer credentials, open a real browser, request Pointer Lock or send OS
input. Use pure page scripts in independent headless profiles for UI fixtures.
User-operated login and natural Windows interaction remain separate acceptance
steps and are not claimed by the deterministic tests above.
