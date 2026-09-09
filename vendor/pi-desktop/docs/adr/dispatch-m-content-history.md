# ADR: Managed Git is the single source of truth for world source content

- Status: Accepted for implementation (VM0/VM1 delivered and unit-verified; VM2 application wiring pending)
- Date: 2026-09-10
- Deciders: Craftmine World version-management owner (task M); the frozen shared reference contract is co-owned with the asset-catalog owner (task N)
- Related: `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` sections 4.1, 4.2, 5, 7, 8, 10, 11; `docs/spec/dispatch-m-content-history.md`; `docs/dispatch-reports/godot-remaining/M/INTERFACE_M.md`; E2E-M scenarios in `docs/spec/06-delivery/dispatch-m-e2e.md`

## Context

Player-created worlds need history, branches, comparisons, checkpoints and
recoverable versions. The existing backend stores immutable revisions as rows
plus content-addressed blobs in SQLite and a blob directory. That numbering is
not a branch graph, cannot express merges or parentage, and cannot carry the
version metadata offline.

Three constraints shaped the decision:

1. **No second history.** If Git and the legacy revision store can both grow,
   the world has two conflicting sources of truth and recovery becomes
   undefined.
2. **No dependence on the player's Git.** A player may have no Git installed,
   may have a hostile global configuration, or may be on a machine with hooks,
   filters, fsmonitor, credential helpers, external diff/merge drivers or
   aliases that would run commands during import. A player email must not be
   required to commit locally.
3. **Variable-length object IDs.** Git repositories can be SHA-1 (40 hex) or
   SHA-256 (64 hex). A protocol that assumes 40 characters breaks on
   SHA-256 repositories, and asset content hashes (SHA-256) are a different
   namespace from Git object IDs.

The asset catalog also needs the same reference shapes and the same canonical
lock file. Two parallel definitions of `AssetRef`/`ContentRef`/`AssetLock`
would drift silently.

## Decision

1. **Real Git is the single source of truth for source content.** Project
   files, commit parentage, branches and version tags are authoritative in a
   managed bare Git repository. SQLite is authoritative only for deployment
   records, tasks, leases, operation logs and play progress; it may cache query
   indexes but must never independently generate content history. The
   `ContentRef` (`repoId`, `commitOid`, `assetLockHash`) binds a source commit
   and its asset lock together; neither half alone identifies playable content.

2. **One managed, isolated Git CLI with pinned provenance.** A single adapter
   (`content_history::git`) is the only place that spawns Git. It locates a
   bundled binary first and falls back to `PATH`, recording path, reported
   version, file SHA-256 and `Bundled`/`PathFallback` provenance so no report
   can claim a binary that was not used. `MINIMUM_GIT = (2, 38)`. Every call
   uses an argument array with structured stdin, no shell and no prompt; a
   managed configuration directory replaces user and system configuration
   (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<managed>`), hooks are
   redirected to an empty directory, network protocols are disabled, submodule
   recursion and credential helpers are disabled, and each child runs in a
   neutral working directory so no parent repository configuration is
   discovered. Repository configuration is scanned and refused for hostile
   keys. Commit identity comes from the host: display name plus a stable
   identifier, with the email derived as `<stableId>@craftmine.local`.

3. **The frozen shared reference contract is owned by M with N as co-owner.**
   `content_history::contract` defines `AssetRef`, `FileRef`, `ContentRef`,
   `BuildRef`, `ProgressRef`, `OperationContext`, `AssetLock`, `AssetLockEntry`
   and `AssetOverrideRef`, the `craftmine.assets-lock/1` canonical form, and
   the golden test vectors. The asset catalog imports these definitions instead
   of defining parallel shapes. Changing a golden hash or a rule is a contract
   change agreed by both owners.

4. **Legacy revisions migrate as source-only commits.** Preflight is read-only
   and verifies every manifest and blob. `apply` imports one commit per legacy
   revision with parent chaining and the trailers `Craftmine-Task`,
   `Craftmine-Legacy-Revision`, `Craftmine-Manifest-Hash` and
   `Craftmine-Assets: source-only`, records the revision-to-commit map and the
   protected migration refs, then switches
   `craftmine_content_repositories.backend` to `git` in one transaction.
   Migrated commits carry no asset lock and are never reported as playable
   content. Interrupted imports resume into the same history; damage is
   reported, never repaired by substituting current data. After the switch,
   the legacy write entry points must call
   `assert_legacy_writes_allowed`, which returns `CONTENT_BACKEND_SWITCHED`.

5. **Object IDs are variable length.** Git OIDs are validated as 4..=64
   lowercase hex and never assumed to be 40 characters. The repository object
   format is recorded in `repo.json`
   (`craftmine.content-repository/1`). SHA-256 asset hashes are validated
   separately as exactly 64 lowercase hex.

## Consequences

- History, branches, merges, tags and offline bundles are real Git objects, so
  they can be verified, bundled and (in later phases) synchronized without a
  product-specific format.
- The legacy backend becomes read-only per world. A switched world cannot grow
  a second history; a legacy write attempt fails with
  `CONTENT_BACKEND_SWITCHED`.
- Imported legacy history is honestly labelled: source-only commits have no
  asset lock and are rejected as playable content with
  `CONTENT_ASSET_LOCK_MISSING`.
- A clean Git text merge is explicitly **not** a gameplay pass. Merged content
  must be re-built and re-checked by the verifier; parent check evidence is
  never reused.
- The player needs no Git installation, no global configuration and no email;
  the client never reads or writes the player's Git configuration.
- Storage cost is a real Git repository plus build copies under the task
  journal directory. Reclaim distinguishes garbage (reachable from no ref)
  from objects still referenced outside the keep set, and only deletes true
  garbage.
- A second source of truth is still forbidden for asset bodies: Git stores the
  asset lock and references, not the asset content store's runtime index.
- Provenance is recorded, not assumed: the current measured runs used a `PATH`
  fallback Git, so the bundled binary and its license list remain an open
  delivery item.

## Alternatives considered

- **Keep SQLite revisions as the source of truth and export Git as a mirror.**
  Rejected: two histories can diverge, merges and parentage are not expressible,
  and the mirror could silently become authoritative.
- **Require the player's installed Git and its global configuration.**
  Rejected: availability and safety. Hostile hooks, filters, external drivers,
  aliases and credential helpers would execute during import, and a player email
  would be required for local commits.
- **Shell out with a command string.** Rejected: argument arrays with structured
  stdin remove shell injection and quoting classes of bugs, and let the adapter
  refuse subcommands before spawning.
- **Assume 40-character SHA-1 object IDs.** Rejected: SHA-256 repositories are
  supported and already exercised end to end; the object format is recorded
  instead of assumed.
- **Repair a missing legacy blob by substituting current content.** Rejected:
  it would fabricate history. The import is blocked and the damage is reported.
- **Treat a clean Git merge as an applied, playable result.** Rejected:
  gameplay, dependency and asset-version conflicts can survive a clean text
  merge; the result must be re-verified.
