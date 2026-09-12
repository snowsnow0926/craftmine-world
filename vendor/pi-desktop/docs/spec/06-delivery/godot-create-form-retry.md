# Recover a registered world from its original create form

Keep one original request, operation identity, acknowledged world identity and
return world for each live create form. Once a world has been registered, its
title/base/starter are fixed in this form. The submit action becomes “Retry
preparation and enter”. Reopening the form through its panel restores those
attributes, rather than presenting blank editable values for the same operation.

On retry, read the current world list for the acknowledged identity. A failed
world must advertise `retry`; select it through the normal save-and-switch path
if necessary, then call the existing scoped `world.creationRetry`. Wait for its
real ready state before switching and calling the original entry completion.
A world already ready only needs entry retried. Never call world.create again
for a known registered identity and never invent a new world after failure.

If the create acknowledgement was lost, keep the exact original request and
offer “Retry and confirm creation”. The existing host idempotency/owner checks
must recover its identity before reading the list and deciding recovery. Do not
infer identity from a title or replace its operation ID. An unconfirmed Cancel
retains the form with the existing error, rather than silently closing its only
request identity. Explicit validation errors that run before registration allow
editing again; unknown transport outcomes do not prove registration failed.

Every retry retains the original return world. Cancel still invokes the owned
initialization cancellation and restores that original world; it does not delete
the registered draft. A failed save prevents both the selection and retry.

Actual React form/controller tests cover registration failure, immutable values,
form remount, successful same-world recovery, lost ACK, unconfirmed cancellation,
pre-registration validation, save rejection and cancellation after retry failure.
A real factory contract test verifies that repeated create returns the same
failed identity without rematerializing, edited attributes yield WORLD_EXISTS,
and only explicit retry requests `recover: true`. Domain receipts are controlled;
this does not claim native initialization or physical-player acceptance.
