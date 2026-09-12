# Editable dialogue preparation drafts

Date: 2026-09-12. Feedback: FB03-001 and FB03-002.

## Ownership and submission

The first preparation render provides an independent text editor. It does not
mount the previous world's conversation composer under an inert wrapper. Text
entered before creation is acknowledged belongs to this preparation operation;
it cannot send, attach files to, or clear the previous session's draft.

After the host acknowledges the new world id, create its ordinary independent
session immediately through `createCopiedWorldSession`. Preserve the existing
session/model configuration rules. The preparation editor remains separate
until the world list reports playable, the actual switch succeeds, and the
runtime reports ready/paused/saved for that exact world.

Typing alone never starts a model. The player may explicitly queue the text
with **Send when ready**. On readiness, acquire the normal opaque host creation
capture and verify world and session identity again. Submit once through the
ordinary `sendPrompt`, naming the new session and capture. A changed session,
foreign runtime, failed preparation or withdrawn queue cannot send. Editing
while the capture is pending withdraws the queued submission. Once submission
is in flight, edits are disabled until its acknowledgement is resolved.

Unsubmitted text, or a rejected send, is transferred to the new session's
ordinary composer cache. Successful delivery clears the preparation draft.
The normal composer takes over text, attachments and command behavior after
preparation. This adds no model, permission or context limits.

## Cancellation and retained text

Cancel marks the operation first and calls the private
`world.creationCancel {worldId}` before awaiting pending preparation work. The
host cancellation is limited to that world's initializer and its owned first
load; it must be idempotent if initialization has already completed. It does
not close unrelated candidates or cancel an ordinary model turn.

If cancellation precedes the create acknowledgement, the late acknowledgement
supplies the id and then calls the same scoped cancellation. Session, switch
and prompt acknowledgements must settle before restoring the original world,
session and layout. An in-flight prompt is aborted only in the new active
session. Failed scoped cancellation prevents premature restoration and offers
the same cancel action for retry.

Preparation text persists under a separate local-storage key, with a renderer
memory fallback. Cancelling retains it for the next preparation entry;
storage failure must not lose the live text. Once handed to the ordinary
composer, the existing per-session draft lifecycle applies.

An initialization error exposes **Retry preparation** directly next to the
retained editor. Retry uses the same world, session and creation operation;
it does not create a replacement world or replace the original return target.
For an acknowledged world it calls the existing scoped `world.creationRetry`
action before waiting for real readiness again. Queued intent remains queued
unless the player edits it; no request sends while the error is unresolved.
A cancellation failure only offers cancellation retry, not initialization
restart of an operation the player has cancelled.

## Evidence scope

`tests/fb03-dialogue-preparation-headless.mjs` renders the actual preparation
component and hook in an isolated browser. It invokes React input and button
callbacks and controls host replies explicitly. Cases cover early input,
queue/readiness, no implicit send, wrong world, lost cancellation, delayed
create/session/send acknowledgements, rejected sends and storage failure.

The fixture does not assert a real native world initialized or a model ran.
The integrated application must additionally exercise a delayed real factory,
type before initialization completes, cancel safely, and verify any queued
prompt reaches only the newly initialized world and ordinary session. Native
input and physical keyboard behavior remain separate verification scopes.
