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
