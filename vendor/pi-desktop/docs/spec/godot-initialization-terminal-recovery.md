# Terminal Godot initialization and explicit recovery

Automatic continuation is limited to `pending`, `drafting`, `building` and
`checked`, provided the world is not playable. `failed`, `cancelled`,
`interrupted`, `blocked` and unknown states do not start work on a status read,
an idempotent create replay, or an ordinary initializer `start` call. The
initializer re-reads the durable status before accessing managed source or
opening a task, defending callers beyond the factory.

The initialization transaction returns a raw record without `playable`, whereas
`godotWorld.initStatus` includes it. A known unfinished raw record can start its
first initialization immediately. Confirmed or unknown records cannot.

The existing explicit retry action invokes `start(worldId, {recover: true})`.
It retains the recoverable-task lookup and resume before `turn.begin`, followed
by the existing source integrity checks, build/check and first-load path. Retry
does not declare a candidate ready or bypass the engine/path budget. A retry in
the same overlong profile may fail again with the same finite reason.

For a durable failed initialization, `GODOT_TASK_PATH_TOO_LONG` from the core's
identity/hash-checked job output takes precedence over an in-memory recovery
exception. Creation stage, failed stage and error stage stay `build`, with the
existing concise Chinese explanation. A confirmed playable world similarly
cannot be made failed by a stale transient exception. Other error projections
and privacy boundaries remain unchanged.

Regression coverage uses the actual factory and initializer with managed files
and a controlled domain state fixture. After a first failed job, replacement
service instances have empty transient maps. Repeated status reads, create
replay and direct normal start must produce only `godotWorld.initStatus` calls,
no new task/build, and unchanged source. An explicit retry must resume the
previous task before opening a new turn and pass through a new check and
first-load callback. These tests are not actual engine or packaged acceptance.

Release acceptance must rerun the strict long-profile package scenario on a
newly built package with this source. The old `c4af0d2` package's restart failure
remains failed; successful module tests cannot supersede that evidence.
