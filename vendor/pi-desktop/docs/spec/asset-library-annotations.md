# Asset favorites and tag editing

This AL2 slice adds favorite/unfavorite and tag forms to the selected asset's
detail pane. The forms use only `asset.annotate` browsing metadata. They never
send a world, source path, file body, license, content hash or version update.
Existing `asset.read` results remain immutable; browsing values originate in
host search rows and matching annotation receipts, not default guesses.

Each new edit gets a fresh UUID-based operation id. One unresolved edit per
logical asset is held in the controller. While saving or awaiting a retry, that
asset's forms cannot submit a different edit. A retry uses the same frozen
operation id and payload; duplicate retries join the active promise. Switching
away and back within the same panel keeps this retry record. This is session
state, not a new durable client journal or cross-client conflict protocol.

Receipts must name the request's asset and operation and confirm the requested
tag/favorite values. Errors are recorded per asset; an old completion cannot
replace a newly selected asset's detail or error. Selection and version reads
also reject stale generations. A failed list refresh does not turn an already
acknowledged edit into an unacknowledged write. The latest filter is refreshed
only when the edit has not crossed a search/scope generation.

Tags accept comma, Chinese comma or semicolon separators. Trim and deduplicate
without silently truncating tags. Match the core limit of 32 tags, 40 UTF-8 bytes
per tag, and no control characters. Empty input submits an empty array to clear
tags. Text entry is bounded at 2048 characters; invalid tags produce local
feedback without a write. Favorite state comes from an acknowledged receipt or
host search, never from an optimistic world mutation.

Validation:

- Controller tests cover fresh operation identities, exact retry, stale success
  and error, selection races, receipt mismatch, duplicate retry and filtering.
- The independent headless test bundles the actual React panel, drives DOM
  events/forms without input devices, and calls an existing core binary over
  its real private stdio API in isolated data. It drops/holds replies only after
  the core transaction, verifies replay and restart, and compares immutable
  version/source/license and world-list data before and after.
- No full Electron/Godot client or model invocation is included. This is not
  completion of all AL2 search, organization or library-management work.
