# Default automatic world creation and playable completion

Date: 2026-09-13. Feedback: FB03; ordinary-player creation clarification.

## Session default

Both ordinary world conversations and the new-world dialogue entry default to
automatic creation when the session permission is absent/inherit and global
`defaultPermissionMode` is absent. Persist that choice on the world session;
do not change global preferences or ordinary workbench defaults. An existing
legacy immersive session with that implicit fallback is upgraded before its
next ordinary submission. Model, provider, thinking and mode stay unchanged.

Every explicit session Ask/Accept edits/Auto setting is retained. Every explicit
global permission also retains its existing inheritance. A navigation or new
permission choice during the default-setting acknowledgement cancels the
pending submission rather than sending under a different visible context.

New-world conversations retain the existing model inheritance rules: they use
the global/default-provider model and that binding's default thinking. They do
not copy the previous session's explicit model merely because they inherit its
permission choice. Accordingly the recorded FB03-007 Flash/max/implicit-Ask
baseline and the Pro/medium new-world baseline remain distinct evidence.

## Live automatic completion

The task-status host adds `automaticallyApplied: true` only when the job is
actually adopted and the durable automatic queue receipt matches the world,
job and session with status `applied`. Model text and manual adoption do not
set this field.

The result component may return a retained-world conversation to play only if
it observed this session running and this job checking/applying during the
current mount. It also requires the matching automatic receipt, completed run,
same selected world/session, current effective Auto permission, and immersive
compact presentation. It reads the real live composer, preserving text and
attachments; a new draft keeps the conversation open. The actual runtime and
selected world are rechecked before closing the overlay. Selection/layout
events or a failed runtime confirmation cancel the handoff.

Historical results, explicit Ask, full workbench views, different sessions or
worlds, manual adoption, errors and missing live draft readers cannot close
the conversation. A successful handoff emits a short result notice; F2 can
reopen the retained transcript. A repeated receipt does not repeat the notice
or reopen chat. The existing pure-dialogue handoff retains priority.

## Verification

The permission unit tests exercise all explicit/default combinations. The
headless store test calls the production session creation and prompt functions
with controlled API receipts, including legacy entry and a newer Ask choice.
The paired result/status/immersion React test exercises visible layout and
live-draft preservation, not only an event counter. These are engineering
fixtures, not model or native-world evidence.

Final product acceptance must run two separate ordinary model workflows:
retained-world fictional playable AK47 creation with the original session's
model/strength, and a new explorable forest using the model/strength actually
selected by that entry. Preserve the missing global permission setting in the
test setup so the product itself selects Auto. Neither test may use a limited
evaluator, silently force Auto, handwrite the requested world, or manually
adopt a candidate while claiming automatic completion.
