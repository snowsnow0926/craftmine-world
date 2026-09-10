# Player target feedback parameters

The creation library exposes the platform-owned `fp.target.feedback/1` instance
configuration for supported first-person training targets. The player chooses an
explicit target ID and an integer duration of 1 through 1000 milliseconds. Zero
is excluded because the baseline flash lifecycle does not restore its material
after a zero-duration hit.

## Ownership and transactions

The panel has exactly three channels: `targetFeedback.describe`,
`targetFeedback.submit`, and `targetFeedback.status`. Main validates world
selection and finite fields before calling the private authoring service.
Renderer `sourceBinding` is an immutable source observation, not a host task
binding. Main projects results without source bodies, paths, or host authority.
Candidate activity, initialization, restore, and copy operations block reads or
new submissions; status queries remain available for the original operation.

Submission uses the existing workbench operation journal. Preparing persists the
same target, source binding, value, and operation ID. Executing or recovering
reuses that ID. An initial queued receipt is durable; current job status comes
from a separate read. A transport failure remains uncertain and directs the
player to the existing pending-operation controls. Exactly three proven
pre-write source errors become completed `rejected` receipts: stale binding,
unapplied draft, and unavailable formal source. Other failures cannot be assumed
to have made no write.

The private service creates a source draft and an existing check job. Passing
does not adopt the candidate. Preview, close, and adoption use the established
candidate controls. Closing preview retains the draft. Parameter configuration
does not edit health, damage counters, ammunition, or saved player progress.

## Presentation and recovery

The form locks its original intent while a response or check is unresolved.
Polling queries that original check only. Switching worlds or pages invalidates
late responses and stops timers. Concurrent reads use both a view epoch and a
read sequence so an older response cannot overwrite a refreshed value. A
proven pre-write rejection permits rereading and editing again.

Source configuration is supported only for reviewed script implementations.
Unknown or older incompatible sources must remain unavailable, never presented
as an effective live value. Runtime observation is separate evidence: authored
values alone cannot prove that a full level applies them.

## Verification

`tests/plan-loop/target-feedback-panel.test.mjs` checks finite projection,
validation, selection, pre-write classification, and restart of the existing
journal. `tests/local-issues/target-feedback-headless.mjs` exercises actual UI
source with fixture transport in an independent headless browser, including
double submission, pending recovery, polling, and stale responses. These tests
do not represent native runtime or model acceptance. The separate native client
harness verifies a real checked candidate and full-progress preservation across
preview, adoption, and process restarts; only an executed passing report counts
as native evidence.
