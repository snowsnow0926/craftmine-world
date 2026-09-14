# Cancelled blank-world retry: evidence and CPU regression

Read-only retained evidence:
`D:/cm-deepseek-reuse-flow/test-results/desktop-native-product-JMwD2n`, world
`world-c0009e708f37`. The parent confirmed the application exited normally with
integrity passing and zero model requests before the SQLite read. No Core
write/API, profile edit, renderer, GPU or model operation was performed here.

The first driver's world-list timeout led to ordinary shutdown cancellation.
On recovery, the parent invoked the real React retry button once at
2026-09-14 20:26:33 UTC. `ordinary-initialization-retry.json` records that action;
`read-only-startup-page.json` shows initialization failed at first build, with
the message that the world loader had been modified. The later operator
cancellation followed that displayed terminal failure and remains a separate
fact, not a model/task budget limit.

Managed metadata and disk both contain the exact 10,006-byte current engine
wrapper, hash `938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08`.
Read-only `craftmine_godot_projects` revision 2 and its historical revision row
agree. That revision's manifest hash is
`b32e77ccdeaa221bbed030d6267dc44700b6fe9336a1fe08ef4bdf8a4a87483e`.
Its inherited base is the exact 8,556-byte stock bridge with hash
`58b4f108bc8fe6fa9232c9f98e577bc6a2914d1f623f373f79cec5450cba51f3`.
The materializer intentionally installs these two different files; this is not
a newline difference, player customization or altered retained world.

The new CPU regression calls real `materializeBase` with the ordinary blank
defaults, then real `createGodotWorldInitializer` with controlled Core/executor
receipts. It installs initially missing source, reaches its first queued check,
uses `stopAll` to cancel, constructs a fresh initializer, and explicitly retries.
Before the fix the unmodified world fails with
`GODOT_INITIAL_BRIDGE_CUSTOMIZED`; the log is retained as
`test-results/engine-bridge-retry-before.log`.

After the fix it reaches a fresh synthetic check and first-load callback with
the original cancelled job retained and no retry source writes. The complete
managed directory/metadata and indexed source remain byte-identical. Separate
cases reject a changed Core wrapper, changed inherited Core base, changed
managed file and changed bundle before a fresh check/load. A pin matrix rejects
crossed base/wrapper resources, missing or unknown base, and unknown wrappers.
The existing historical-resource and launch-retry tests also pass: 15 tests,
zero failures in `test-results/engine-bridge-retry-after.log`.

These are real materializer/initializer and synthetic executor results, not
native first-load acceptance. The parent will rebuild and use the same retained
cancelled world through its ordinary retry control, separately from fresh-world
and subsequent model-flow tests. Do not reset that profile to manufacture a pass.

## Retained operator-profile native probe

`tests/godot-final/operator-initialization-retry.mjs` is a parent-run, test-only
probe for this operator report format. Required options are
`--application-root ABS`, `--packaged-root ABS`, `--original-report ABS`,
`--world-id ID` and `--output-root ABS/test-results`. It reuses the sealed-package
inventory/launch helper, private offscreen controller, loopback renderer,
credential log redactor and complete-progress comparison. It does not create a
new world, configure or call a model, inject input, or write Core/SQLite/source.
Only the application's normal initialization, save and open flows write state.

Before launch it requires a retained failed operator report, normal shutdown,
passing package integrity, zero prior model turns, closed continuation reports,
matching world creation ownership and a fully isolated unlinked headless profile.
It hashes the original report and associated failed retry/UI evidence, reads
managed file hashes and canonical source pins, and records existing chat IDs.
The recorded JMwD2n report passed this read-only preflight: SHA
`6e6d0cf65d66146bb5c980950568f002a10777802a1abf35541ec933d4f7ba5c`,
30 managed files, source revision 2, zero jobs/messages/turns. No app was launched
for that preflight.

The probe chooses from actual startup state. A failed/cancelled/interrupted
world with a visible enabled retry control invokes its existing React `onClick`
once; no DOM click event or production retry RPC substitutes for that callback.
If startup already starts or completes recovery, it records
`automatic-startup-recovery` with zero retry clicks and never cancels merely to
manufacture a button. A lost dispatch acknowledgement records an unknown click
count and does not retry. The prior ordinary retry failure remains linked.

Both paths require the same world set and world ID, a real formal runtime,
nonblank native pixel evidence, ordinary frozen save/snapshot, normal exit,
canonical new passed check with matching applied candidate/application, and a
second normal startup/open with exactly equal complete saved progress. Indexed
source, managed bytes and chat IDs must remain unchanged. Page errors, wrong
identities, stale receipts, altered outputs or forced shutdown are failures.
Exact known Core world-list read timeouts may be retried and are retained;
other errors and terminal states propagate. No new whole-task limit is used.
SIGINT/SIGTERM or the emitted cancel-file path requests normal cancellation.

CPU validation: seven owned-profile/UI/canonical-receipt boundary tests and nine
existing read-timeout tests passed (16 total), plus `node --check` and the inert
`--help` entry. Native execution has not been performed by the implementing
agent. Root must inspect the resulting report instead of interpreting script
availability as recovered-world acceptance.

The first parent-run probe (`3m99kY`) exposed a driver startup race: the private
controller announced readiness before window creation, returning zero windows
and `hostAvailable:false` with no violations. The original one-sample assertion
stopped the app during renderer bootstrap, producing the subsequent host-core
unavailable page error. That failed report is retained unchanged; it is not a
visible/focused-window violation or a world-recovery verdict.

The probe now polls real status until a window exists and the host plus world
plugin are available. Every sample still checks all existing windows and any
violation immediately, so waiting cannot hide an unsafe intermediate window.
After attaching the owned renderer it waits for the normal application shell
to leave its bootstrap state before dispatching initialization navigation.
Two CPU cases cover zero-window -> hidden-window -> backend/plugin readiness
and immediate rejection of unsafe windows even during backend startup. All
18 probe/read-timeout tests pass; native recovery still requires the parent's
next actual run.

The subsequent retained probe `ZKBqHo` exposed a distinct selected-world entry
gap. The actual list identified `world-c0009e708f37` as active and initializing
at the build stage, while canonical jobs and the executor ledger were empty.
The entry list itself never starts the initializer. The old row hid Continue
Preparing World for the selected world; its controller also rejected same-world
continuation, and ordinary opening of non-playable rows only showed a notice.
The parent cancelled that wait normally; its original report is not modified.

The production correction exposes the existing continuation for a selected
initializing row and permits only that explicit state-scoped same-world path.
`tests/selected-initialization-continuation.test.mjs` renders the actual React
row, then executes the actual controller callback through the real bridge,
retained-page navigation function, host panel coordinator and creation factory
with controlled initialization dependencies. Pure list reads and ordinary
selection start nothing; explicit continuation reaches the initializer, and
repeat requests do not restart an already-running initializer. Ready/failed
states and busy/unsupported cases retain their old guards. No fake jobs or
profile changes are used to manufacture readiness.

The native probe now records `ordinary-continue-preparation` for initializing,
invokes that actual existing callback once, and only then polls readiness.
Only a ready startup row is `already-ready-at-startup`. Terminal rows may use
their one explicit retry. Once ready, the probe opens through the ordinary form
once if entry is still open; it never waits for an entry form after a handler
has already left entry. Cold reopen has its own single open. Callback loss is
not a reason to repeat a mutation.

56 targeted CPU tests and desktop typechecking passed. These cover the actual
production continuation chain, state guards, private probe action ordering and
read-timeout classification. The new native package still needs parent-run
acceptance on the unchanged retained world.

The next native probe `KA5iz0` confirmed the actual Continue callback, then
returned the real `GODOT_INITIALIZATION_FAILED` message
`Error: EXPLICIT_RECOVERY_REQUIRED`, with ordinary `retry` and `details`
actions. The script retained that failure and shut down; this was not a build
success. The cause is the interrupted initialization workspace: status-driven
initialization uses ordinary `turn.begin`, whereas only explicit `recover:true`
first reads the recoverable task and resumes its exact generation. Rust's
refusal was correct and is unchanged.

The product continuation now dispatches the existing explicit-retry scheduler
after selection/initialization identity checks. The CPU chain includes the
actual initializer, with controlled interrupted workspace replies: it asserts
`task.resume` generation 7 before `turn.begin`, one fresh check, and no source
rewrite. Passive status still produces the exact recovery refusal. Separate
in-flight work joins without cancellation, another begin/check, or a queued
`recover:true` restart. An obsolete initialization ID is rejected before the
retry channel. Ready same-world and ordinary failure behavior remain intact.

For older-package diagnosis, the probe also supports the authorized two-stage
player flow within one process. Only after its own Continue, the exact same-world
error above, advertised retry, and a fresh enabled ordinary retry control may
it invoke Retry once. The original error, terminal row, UI confirmation and
second action are retained under `continueRecovery`; the mode is then
`ordinary-continue-preparation-then-retry`. Other terminal errors, foreign
selection, unavailable retry and a repeated recovery failure stop. This does
not mutate Core or manufacture a new state. A new package should use the
single explicit Continue path instead.

73 targeted CPU tests and desktop typechecking pass for this follow-up. Native
acceptance remains the parent's separate run; KA5iz0 is preserved unchanged.
