# ADR: portable complete archive and backup protection references

Status: accepted (R5, second Godot round).
Supersedes nothing; it completes the backup half of H's delivery (`da41621`).

## Context

The round-one delivery produced two JSON archives: the bounded domain archive
(32 MiB) and `craftmine.complete-backup/1`. The latter carries a *manifest* of
external content only. Its own report states the consequence: the raw archive
bytes are not embedded "because that would exceed the 32 MiB portable archive
limit", so a restore still needs the source data directory.

The version, asset and package plans require the opposite:

* `VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md:129` - a complete backup includes the
  protected Git references and objects, drafts, revision maps, every asset body
  referenced by a lock, application/check metadata and the player's chosen save.
* `VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md:131` - verify all references and
  produce a hash manifest; register the restored world only after validation in
  a new isolated directory; never replace the original world on a missing body,
  a full disk or a hash error.
* `ASSET_LIBRARY_DEVELOPMENT_PLAN.md:142` - a snapshot across two stores must
  have a verifiable common boundary and must not copy a folder while a world is
  being written.
* `ASSET_LIBRARY_DEVELOPMENT_PLAN.md:144` and
  `VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md:133` - formal worlds, drafts,
  branches, named versions, migration keep-items and local backup keep-items
  all block deletion; old Git objects must never be pruned just for age.
* A's round-one report leaves two open items: source blob reclamation racing a
  pre-commit blob write, and orphan build directories. A's own suggested fix
  ("skip recent blobs by mtime") is explicitly rejected by the R5 task.

## Decisions

### 1. One streaming container file, not a JSON document

`craftmine.portable-archive/1` is a length-prefixed stream: magic, one JSON
header line, then per entry one JSON line plus its raw bytes, then one JSON
footer line. Bodies are copied in 128 KiB chunks and hashed in a single pass.
The 32 MiB JSON limit therefore no longer constrains content, and memory use is
constant regardless of archive size.

### 2. Content is enumerated from durable rows, never by walking a directory

Each content root is described by rows that reference it: sealed imports by
their manifest, source blobs by revision manifests, asset bodies by asset file
rows, Git objects by the reachable set of the snapshot's references. A body is
immutable once written, so it is either present and hash-verified or the export
fails. No mtime, size or "recently touched" heuristic is used to decide safety.

### 3. Git is carried as objects through the managed whitelist

`RepositoryStore::bundle` exists, but importing a bundle needs `git fetch` or
`git clone`, and neither is in `content_history/git.rs::ALLOWED_SUBCOMMANDS`.
Rather than widen another owner's security whitelist, the archive reads objects
with `rev-list --objects --all` + `cat-file --batch` and recreates them with
`hash-object -w` + `update-ref`. Recomputing each object id proves the restored
history. Consequence: restore cost is one Git invocation per object, acceptable
for authoring repositories; a future bundle-plus-fetch path would need R1 to add
`fetch` to the whitelist.

### 4. Protection is a durable pin, released explicitly

A `craftmine_backup_pins` row is written in the same transaction as the domain
snapshot, before any body is read. Reclaimers consume `backup.protected-refs`
instead of keeping their own list. A pin survives a crash as `streaming`; startup
recovery either promotes it (the export job completed) or abandons it. This is
the race resolution for A's open item: a blob cannot be reclaimed while an
archive that references it is being written, and no age threshold is involved.

### 5. Restore in place only into an empty installation

Restoring over a live world is impossible: the target must be empty, or the
running installation must hold no user data at all. The domain is applied last
and inside a transaction, after every body is on disk and verified.

## Consequences

* A complete backup is genuinely self-contained; the source directory may be
  gone, moved or unreadable.
* Archives are larger than the manifest-only version. Rebuildable caches
  (import cache, build artifacts, build scratch, repo worktree copies, Git
  config) are declared and excluded, and the receipt lists them.
* A restored world reports `rebuildRequired` for its derived build copies. The
  fixed toolchain can rebuild them; user content cannot be re-sourced and is
  therefore always inside the archive.
* Protection can outlive its usefulness if a host never releases it. The
  `backup.release-portable` operation drops the pins of one archive once its
  bytes are stored somewhere the installation no longer depends on.
* The archive format is versioned (`schemaVersion: 1`). An archive whose table
  columns are not a subset of the target schema is refused with
  `BACKUP_COLUMNS_MISMATCH` rather than silently dropping data.
