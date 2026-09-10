# Durable first-load failures

The existing SQLite domain stores first-load failures in
`craftmine_godot_init_launch_failures`. A record binds the initialization, world,
candidate and application IDs. It stores no renderer message, path, screenshot,
credential, token or caller-selected reason. The reason is the fixed code
`GODOT_INITIAL_LOAD_FAILED` and the failed creation stage is `confirm`.

Private RPCs `godotWorld.initLaunchFailed` and `godotWorld.initLaunchRetry` accept
exactly `{worldId, initId, candidateId, applicationId}`. Both return these IDs
and `{recorded: true, replayed: boolean, cleared: boolean}`. This is an operation
receipt, not a declaration of current playability. Core re-reads hash-checked
application data and requires an aborted/interrupted latest application, its
matching latest ready candidate and current source/assets. Prepared, applied,
foreign and stale new requests cannot record a failure or clear another one.

Duplicate requests replay only their own record. Explicit retry marks it
cleared without deleting it. A delayed failure delivery cannot recreate a
cleared record or overwrite a newer candidate/application. Confirmed deployment
always wins. `initStatus` exposes an active failure as `status: failed`,
`playable: false`, the finite reason, `failureStage: confirm`, and `launchFailure`
containing the four IDs. Otherwise both additional fields are null. No success
or formal progress is written by these RPCs.

The Main-only coordinator captures the actual first application before existing
abort/recovery drops its session. After failure recovery settles, it records the
failure and validates the receipt identity. Persistence failure is explicitly
`GODOT_INITIAL_LOAD_FAILURE_RECORD_UNCONFIRMED`; unsettled recovery is never
claimed durable. A committed lost reply still reconciles as applied.

The initializer does not automatically start a terminal failure. Explicit retry
clears its exact failure, re-reads Core, then follows the existing task recovery
and checked-candidate path. Direct first-load also refuses an uncleared failure.
Main owns the private route allowlists and creation UI projection.

The domain archive includes failure records and cleared tombstones. Older
archives missing this additive table restore with its exact current columns
and zero rows. No second authoritative file is introduced.

Boundary: failures without a verified prepare receipt (including a lost prepare
reply) retain their previous error handling. A crash before a settled failure can
be recorded is not covered by this failure-record mechanism. Tests use real
Core transactions for persistence/backup and controlled host callbacks for JS
ordering; no new native renderer, OS input or model run is claimed here.
