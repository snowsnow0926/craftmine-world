# Recoverable deletion of failed generated worlds

Date: 2026-09-12
Status: Accepted for FB03-005

## Context

Failed generated worlds remain in the normal world list and have retry controls
but no deletion action. Removing only their DOM rows would not survive restart.
Deleting their databases, source directories or Git repositories would destroy
valuable drafts, saved progress, candidate records and conversation history.

## Decision

The player action is **Delete**, with a **Recently deleted** recovery list and
a concise explanation that original files are retained. This is a reversible
core-owned archive marker, not filesystem reclamation. No automatic expiry or
permanent deletion is introduced.

Only a world whose durable initialization status is failed or blocked may enter
the archive. Rust verifies the exact world revision and formal build and rejects
active world leases, queued or running jobs, and prepared applications. The host
also refuses while initialization, candidate transactions, model work or profile
restore is active. No ongoing work is silently stopped by this operation.

If the world is selected, the trusted retained-view navigation saves and enters
an available world first. If none exists, the host creates an ordinary blank
voxel world and navigates to it. A failed departure does not archive the source
world. While deletion is pending, unrelated main navigation and retained-panel
selection writes are blocked; the service permits only its exact fallback open.

The additive `craftmine_world_archives` table stores the world identity and
archive time. Normal lists exclude these rows; the archived list and read APIs
retain them. Restore removes only the marker: it does not switch worlds, retry
initialization, clear an error, replace a candidate, or reset a session binding.
Old sessions and candidate operations cannot write or enter an archived world.

The archive table participates in full and portable backups. Older backups have
an empty additive archive table. Source repositories and all existing records
remain included in backup, so restoring a backup does not undo the deletion or
lose the ability to restore its world later.

## Interfaces and ownership

- Main player channels: `world.archiveFailed({worldId})`,
  `world.archivedList({})`, `world.restoreArchived({worldId})`.
- Private core routes: `world.archiveFailed({id, revision, baseBuild})`,
  `world.archiveStatus({id})`, `world.archivedList({})`,
  `world.restoreArchived({id})`.
- No model tool, arbitrary directory, `deleteFiles` flag, caller-supplied
  failure status, or renderer-provided saved snapshot is accepted.
- Lost mutation replies reconcile against the exact durable archive marker.

## Consequences

Players can clear failed rows and recover them later without losing work.
Deletion does not release disk space. An archived session retains its original
world binding and must restore that world before further authoring. Busy work
must finish before deletion; initialization cancellation is a separate flow.
