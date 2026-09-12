# Durable cancellation of world preparation

Date: 2026-09-13
Status: Accepted for FB03-002 and FB03-006

World preparation can be waiting for source registration, executor readiness,
job submission, compilation, or a first native load. Treating Return as ordinary
navigation races the candidate mutex and can leave a world preparing after the
player has already returned. A failed load also cannot represent intentional
cancellation: valid source and checked candidates must remain usable.

The private main action `world.creationCancel({worldId})` waits for cancellation
of that world's own initializer. It does not cancel a normal model turn, an
ordinary preview, another world, or a formal native instance. A caller handles
its own dialogue-turn cancellation separately.

Each initializer attempt has a cancellation token and immutable job ownership.
Checks surround asynchronous work, including job submission with a lost reply.
Cancellation reads and compares the actual job's task identity before cancelling
that job. The owned workspace is ended as aborted after job cleanup.

First-load cancellation uses `GodotWorldViewHost.cancelStaging(worldId)`, which
interrupts only the matching pending startup. The candidate coordinator retains
its own application identity and checks cancellation after preparation and
confirmation, and before commit. It recovers its normal application transaction
instead of closing a global runtime. Uncertain aborts can be retried against that
same first-load application. A durable commit that already won is retained.

The additive core table `craftmine_godot_init_cancellations` records acknowledged
cancellation for the exact world/init identity. The private `godotWorld.initCancel`
route requires jobs, workspace leases and prepared applications to have settled.
Already-confirmed worlds return ready without a marker or runtime mutation.
`godotWorld.initStatus` reports cancelled until explicit retry invokes the private
`godotWorld.initCancelClear` route. Read/status polling cannot restart cancellation.
No source failure receipt is manufactured by this path.

The marker participates in portable backups and is an empty additive table for
older backups. Cancelled preparations may use recoverable Delete; restoring a
deleted row retains its cancelled status until the player explicitly retries.
Normal shutdown waits for owned initialization cancellation before candidate
departure and native saving, preventing the previous WORLD_BUSY quit race.
