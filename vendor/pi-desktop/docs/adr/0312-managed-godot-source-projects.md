# ADR 0312: Managed Godot source projects in the existing domain journal

- Status: Accepted for the first GD2 source-storage slice
- Date: 2026-09-09
- Related: ADR 0300, ADR 0306, ADR 0311

## Problem

The legacy task document contains a compiled scene and has a 2,000,000-byte limit.
Godot authoring needs real project configuration, GDScript and scene resources as
separate files, with stable revisions, exact reads and recoverable tool receipts.
Raising that JSON limit or executing arbitrary projects with the current user's
permissions would not provide the required storage and execution boundaries.

## Decision

The existing `craftmine-core` service owns three additive tables in `tasks.sqlite`:
`craftmine_godot_projects` (one authoring head per existing world),
`craftmine_godot_revisions` (immutable manifest versions) and
`craftmine_godot_receipts` (task/call identity and exact operation receipts).
There is no second world database or Agent loop.

Godot source authoring uses the existing host-owned `WorkspaceContext`, session
world binding, task identity and exclusive world writer lease. A selected panel
world cannot redirect a bound session. A mutation checks the active task/turn,
application barrier, lease and unchanged formal base build before accepting work.
Each patch additionally requires the current project revision, manifest hash and
each replaced/deleted file's content hash. `null` means a new path must not exist.
The project revision is separate from the legacy scene-draft revision.

An authoring manifest contains `worldId`, `baseBuild`, `baseId`, the fixed Godot
4.7.2/GDScript/Compatibility/Web target, revision, last-writer `TaskBinding` and a
sorted path-to-content-hash/byte-count map. `baseId` classifies the source project;
it does not advertise a delivered playable first-person, top-down or side-view
base. `project.godot` must exist, but neither its semantics nor references in
GDScript/scenes are validated by storage. A successful patch is explicitly
`source-only`, `verified: false`, `applied: false`.

UTF-8 source bytes live in independent content-addressed files under
`<domain-data>/godot-source/<sha256(worldId)>/blobs/<sha256>`. Hashing the world ID
keeps SQLite identities such as `a` and `A` distinct on Windows. Virtual paths never
become host filesystem paths supplied by the caller. Identical content in different
worlds has independent storage. Immutable blobs are synchronized and checked before
the SQLite transaction atomically advances the head, version and receipt. An
existing blob must match its recorded size/hash; it is never silently repaired.
An aborted transaction may leave an unreachable immutable blob, which is safe to
reuse after verification. No automatic garbage collection or revision pruning is
introduced. Reads fail on missing/corrupt data rather than resetting a world.

Portable source paths reject absolute paths, drive letters, backslashes, ADS,
empty/dot segments, Windows reserved devices, trailing dots, hidden/cache paths,
case-insensitive duplicates and file/directory prefix collisions. This first slice
accepts ASCII path components and a documented UTF-8 text extension set. Regular
filesystem entries are required at every managed directory/file boundary; links
and Windows reparse points are refused. This is a broker file API restriction,
not an OS sandbox for a concurrently malicious native process.

Private stdio RPC methods are `godotProject.create`, `.index`, `.read`, `.patch`
and `.receipt`. The hello response advertises `godotProjects: true` and
`godotExecution: false`. The PI-facing broker maps project creation, index,
file reads and patches through these methods. Its world, project, session, turn,
base build and tool call ID come from trusted execution context; model input may
not author those identities. Receipt recovery is an internal host operation and
requires the original task binding and exact method/parameters. Ended turns can
recover an acknowledged result without reopening a writer lease.
The model context also states that source writes are not playable candidates,
requires checking `runtime_info`, and distinguishes legacy `verification_submit`
from unavailable Godot build/verification. Capability claims come from the actual
core response rather than inferred tool names.

## Limits and consequences

- Core limits: 4 MiB per UTF-8 file, 8 MiB changed source per operation, 16 files
  per create/patch, 64 MiB and 4,096 files per project. Serialized request overhead
  is bounded separately; escape-heavy JSON can reach that limit sooner.
- The 64 MiB limit applies to one manifest's referenced source set, not cumulative
  retained revisions. Historical/orphan blob storage can grow beyond it. A total
  retained-storage quota and garbage collection require a later lifecycle design.
- Index pages contain at most 32 files. Read pages contain at most 16,000 Unicode
  characters and remain bound to an immutable revision and manifest hash.
- The public PI broker may retain its stricter 180,000-byte request budget.
- Legacy applied world code, player progress and scene drafts are unchanged.
  Existing legacy verification/application success is not Godot verification.
- Binary asset ingestion, materialization, Godot import/export/run, OS sandboxing,
  Godot candidate verification/application, migration, backups/library integration,
  model-authorship acceptance and normal player UI are subsequent slices. Existing
  legacy backup artifacts do not contain these new source files.
- File synchronization plus atomic SQLite transactions is tested for service
  restarts and injected transaction failure, not certified against device power
  loss or a malicious process racing filesystem ACLs/links.

## Validation

`cargo test --offline -p craftmine-core godot_projects` covers actual files over
2 MB, exact source reads, Unicode pagination, immutable old versions, restart,
idempotency, ended-turn receipts, world/host binding, stale turns, exclusive leases,
optimistic conflicts, invalid paths, removals, corruption and a real SQLite abort
after blob creation. The unchanged formal world and legacy draft are compared.

The Windows junction test's fixture creation was denied, then its bounded retry
timed out before producing the link. That test is explicitly ignored on Windows
until fixture creation is available; its runtime reparse denial assertion is
unverified on this host. The Unix symlink counterpart remains enabled. Do not
replace this missing evidence with a fabricated reparse object or a success claim.

Core stdio and the PI broker require independent integration checks. No test in
this slice imports or executes model-authored Godot code, simulates user input,
requests Pointer Lock or focuses a window.


The broker integration now performs internal receipt reads for uncertain transport
outcomes using the original host binding; it never retries a write to discover
whether it committed. Actual stdio tests cover a committed write whose response
is discarded before turn completion, and an absent receipt after a pre-commit
failure. The snapshot wire marker remains `craftmine.request/2`; changing the
model instruction text does not upgrade that protocol. Source tool integration
is tested independently of the native PI host lifecycle and real inference.
