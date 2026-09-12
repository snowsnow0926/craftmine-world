# World preparation cancellation acceptance

`world.creationCancel` accepts exactly one bounded `worldId`, through the real
main navigation gate and factory. It is available while that initializer owns a
pending first load, and is idempotent after the new world is already ready.
Success means owned work has settled and durable cancellation is recorded, or a
formal commit already completed. Failure must reject so the dialogue can retain
its text and retry cancellation before returning.

The ordinary WorldCreatePanel uses the same backend cancellation. Its Cancel
button waits for the create acknowledgement, cancels that exact new world, and
only closes after safe return. Cancellation failure keeps the form and its name
available for another Cancel attempt. Closing a failed preparation also settles
the retained attempt before return. `tests/fb03-create-form-cancel-headless.mjs`
executes the actual form and controller with delayed host calls to verify these
ordering and retry cases; normal native presentation is tested separately.

The world list uses ordinary cancelled wording, retains the world and its source,
and offers explicit retry. Retry clears only the matching cancellation marker.
Returning to a different world occurs after cancellation, through the existing
retained-view save and selection transaction. Preparation cancellation does not
cancel any model work or ordinary candidate belonging to another interaction.

Targeted checks cover cancellation during initial status, executor wait, job
submission, running jobs and native first-load wait; prepare/confirm/commit
interleavings; a durable commit winning a late cancel; a retry waiting on an old
attempt; failed cancellation persistence; precise job ownership; and shutdown.
Core tests verify persistent cancellation before a job exists and after a checked
candidate exists, explicit retry, unchanged records, and portable restoration.

The PluginRuntime gate and its real child request/response path must admit archive
and cancellation methods. Tests that call only the deletion service or private
router are insufficient to prove this main-process boundary. The UI/Rust harness
now executes PluginRuntime as well; native normal-rendering acceptance remains a
separate required product test and must not be inferred from headless fixtures.

## Retry acknowledgement and observer settlement

The `a2c228e7` packaged acceptance exposed a real visible-list race: the new
check and application passed, and the direct world list reported ready, while
the renderer retained its earlier cancelled row. A retry acknowledgement can
arrive before host preflight creates a new initializer preparation. Returning
the old terminal row at that point also stops list polling; the dialogue retry
loop would treat it as an immediate new failure.

While the acknowledged retry has not advanced past preparation, the factory
reports preparation for the previous attempt, a new attempt with no first
status reply yet, and exact retained replies from before its cancellation-marker
clear. The initializer preserves that earlier status identity solely for this
comparison. A newer terminal result after submission is still authoritative;
durable playable confirmation always takes precedence. The factory removes its
retry record before notifying both main-renderer and retained-view observers to
reread state. Notifications carry no invented completion or progress values.

`tests/fb03-retry-observer-headless.mjs` runs the actual list and dialogue hooks,
navigation coordinator and factory against delayed lifecycle replies. It covers
both entry points through the acknowledgement gaps and eventual confirmed chat
or playable row; it does not claim an engine or model run.
`tests/fb03-confirmed-retry-core.mjs` separately accepts a read-only real confirmed
profile and world ID, copies the data, and verifies its actual Rust receipt
through PluginRuntime, the private router, factory and world-list projection
without altering the saved world. Native packaged acceptance must still rerun
the original cancellation, restart and retry sequence on the revised build.
