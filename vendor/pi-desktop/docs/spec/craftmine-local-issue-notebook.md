# Craftmine local issue notebook (PP3a)

Storage contract and ownership: [local issue records](local-issue-records.md)
and [the notebook ADR](../adr/local-issue-records-20260910.md).

The Backup and Diagnostics page contains a local issue notebook. A player can
enter a description, record it against the current formal Godot world, list
records in that world, inspect the original description and version, and
explicitly confirm deletion. All display of descriptions uses text nodes.

Creation requires a ready, paused or saved formal runtime with matching
selection, world, build and instance identities. Loading, failed runtimes,
candidate sessions and world transitions reject creation. The base version
comes from the formal descriptor's validated progress envelope; the envelope
body is never included. The artifact manifest hash identifies the built files.
Client version and a packaged source commit, when available, come from Main.
Missing development commit metadata remains absent.

The description is immutable after creation. Request operation IDs survive
uncertain replies within the current form, and an explicit retry uses the same
description and ID. While uncertain, the text is read-only. The player can
inspect the list before choosing to write another record. After restart the
list reads the durable records; no pending creation is replayed automatically.

List reads have a sequence independent of world selection. An older response
must not erase a newly created or deleted record. Switching worlds or clearing
the view invalidates outstanding responses. Record reads and deletion remain
available when that world's runtime cannot start; only creation needs a live
formal instance.

If a previous world's workbench action still owns the UI lock, the new page
refresh is queued until that action finishes. Its stale result is discarded;
finishing the action must mount the currently requested page instead of leaving
the new world's notebook blank. Closing the view cancels the queued refresh.

Limits and exclusions must be visible and truthful: local profile only, not
included in world backups, no screenshots, chat, raw console, world source or
progress body. Records are not claims of reproduction or resolution. Storage
errors retain the description for retry and never display a successful save.

Validation consists of real service storage/fault tests, host identity and
gateway tests, isolated headless UI tests, and a separate actual desktop
create/read/restart/delete run. Fixture UI tests do not prove native runtime
behavior; actual desktop evidence records its own build and limitations.
