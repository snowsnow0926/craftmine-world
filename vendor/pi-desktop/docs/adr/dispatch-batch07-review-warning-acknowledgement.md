# Explicit player acknowledgement of review warnings

Status: Accepted for batch07, following the product owner's requirement that the
adversarial reviewer must run but the player decides on advisory conclusions.

## Evidence

A real native DeepSeek review completed with passing weapon, health, inventory
and extension assertions. One model-authored assertion required the destroyed
training target to remain solid in the final state. The renderer correctly made
the destroyed target non-solid. That temporal mistake blocked application despite
passing independent compilation, ABI, Worker and load verification.

## Decision

Default application still requires passing review assertions. A separate player
button, **Apply with review warnings**, displays and explicitly acknowledges the
completed review's failed assertions. Only this player action sends
`acknowledgeReviewWarnings: true`. There is no Agent application tool.

Rust binds the acknowledgement to the operation request hash, immutable input,
review identity and output hash. Commit reads the sealed acknowledgement and
rechecks the same review and verification. Changed acknowledgement on a replay is
rejected. Existing receipts without the field mean false. Failed, cancelled,
interrupted, stale or mismatched reviews cannot be acknowledged. Machine
verification, immutable dependencies and actual native loading remain mandatory.

The review's original false assertions remain false and visible after application.
Acknowledgement records a player decision, not a successful check or code fix.
The final world retains exactly the extensions in the verified artifact, including
new fixed library dependencies; it must not reuse the destination's old list.

## Validation

Rust journal tests cover default refusal, explicit acceptance, changed replay
refusal, preserved failed review, stale/incorrect evidence, failed machine checks,
failed render proof and exact extension persistence after process restart.
Broker tests cover in-flight and recovered-receipt acknowledgement mismatch.
Native acceptance uses the real warning button as the form submitter, retains the
real model's warning text, and checks the sealed acknowledgement in Rust.
