# Content history: managed Git for player-created worlds (VM0/VM1)

Status: implemented (VM0/VM1) and unit-verified against a real Git binary; VM2
application wiring, VM3 semantic/gameplay conflict judgement, VM4 fork/export,
VM5/VM6 remote and community work are explicitly out of scope here.

- Module: `crates/craftmine-core/src/content_history/{mod,contract,git,repo,migration}.rs`
- Frozen vector file: `tests/godot-remaining/M/contract/asset-lock-vectors.json`
- Product plan: `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` sections 4.1, 5, 7, 8, 10, 11
- Interface contract with the other tasks: `docs/dispatch-reports/godot-remaining/M/INTERFACE_M.md`

## 1. Scope and non-goals

### Scope

- **VM0 managed Git adapter.** One process-spawning boundary for Git with a
  pinned program provenance, argument-array invocation, a managed configuration
  directory and an allowlist of subcommands.
- **VM0/AL0 frozen shared reference contract.** `AssetRef`, `FileRef`,
  `ContentRef`, `BuildRef`, `ProgressRef`, `OperationContext`, `AssetLock`,
  `AssetLockEntry`, `AssetOverrideRef` and the canonical
  `craftmine.assets-lock/1` form, defined once in `contract.rs`. The asset
  catalog imports these types; a parallel definition is a contract violation.
- **VM1 managed repository store.** Layout, identity, commits with
  compare-and-swap, branches, history paging, task checkpoints, drafts, named
  versions, applied marker, build copies, changes and file diffs, three-way
  text merge, bundles, integrity verification and reclaim planning.
- **VM1 legacy migration.** Read-only preflight, one commit per legacy
  revision with parent chaining, byte re-verification, a revision-to-commit
  map, protected migration refs, resumable imports and a one-way backend
  switch away from the legacy revision store.

### Non-goals

- No second content history. SQLite never becomes an authority for source
  content, parentage, branches or version tags.
- No network. `protocol.allow=never`, `protocol.file.allow=never` and
  `protocol.ext.allow=never` are forced on every call; VM5 remote sync and VM6
  community collaboration are not implemented.
- No gameplay/build evidence. A clean Git merge is not a gameplay pass; the
  verifier that judges semantics is owned by another task.
- No fork/export end-to-end flow (VM4), no partial undo or cherry-pick (VM3
  follow-up), no performance numbers.

## 2. Frozen shared contract

`crates/craftmine-core/src/content_history/contract.rs` is the single
definition. Types are `serde` `camelCase` with `deny_unknown_fields`.

| Type | Required fields | Notes |
| --- | --- | --- |
| `AssetRef` | `assetId`, `version`, `contentHash` | `version` must not be `latest` or `head`; `contentHash` is 64 lowercase hex |
| `FileRef` | `path`, `sha256`, `bytes`, `mediaType` | relative validated path; SHA-256 separate from Git OIDs |
| `ContentRef` | `repoId`, `commitOid`, `assetLockHash` | source commit plus the asset lock together identify playable content |
| `BuildRef` | `content`, `baseId`, `baseVersion`, `engineVersion`, `target`, `buildId` | any change requires a re-check |
| `ProgressRef` | `worldId`, `progressId`, `revision`, `build`, `stateSchemaVersion`, `contentHash` | confirmed progress; does not move when branches merge |
| `OperationContext` | `operationId`, `worldId`, `repoId`, `branchId`, `expectedHeadOid`, `expectedAppliedOid`, `expectedProgressRevision` | the three `expected*` keys must be present (may be `null`); filled by the host, never by a model |
| `AssetLock` | `format`, `assets[]` | `format == "craftmine.assets-lock/1"` |
| `AssetLockEntry` | `asset`, `installPath`, `files[]`, `dependencies[]`, `overrides[]` | dependency closure must be closed; cycles rejected |
| `AssetOverrideRef` | `scope`, `path`, `contentHash` | collisions are only checked inside one scope |

Constants: `ASSET_LOCK_FILE = "craftmine.assets.lock.json"`,
`ASSET_LOCK_FORMAT = "craftmine.assets-lock/1"`,
`PATH_BYTE_LIMIT = 240`, `PATH_SEGMENT_LIMIT = 16`, `PATH_PART_LIMIT = 80`,
`OID_LIMIT = 64`.

### Canonicalization rules (frozen)

- Canonical lock text is the pretty JSON serialization of `AssetLock` with
  two-space indentation, LF line endings and exactly one trailing newline. No
  CR, no BOM.
- `assetLockHash` is the SHA-256 of exactly those bytes, lowercase hex.
- Sorting: `assets` by `(assetId, version)` byte order then `installPath`;
  `files` by `path`; `dependencies` by `(assetId, version)`; `overrides` by
  `(scope, path)`. Exact duplicates are collapsed.
- The same `(assetId, version)` with a different `AssetRef` is
  `ASSET_LOCK_VERSION_CONFLICT`; an identical duplicate is collapsed.
- Dependencies must resolve inside `assets[]`
  (`ASSET_LOCK_DEPENDENCY_UNRESOLVED`); cycles are
  `ASSET_LOCK_DEPENDENCY_CYCLE`.
- Committed bytes must already be canonical:
  `AssetLock::parse_canonical` returns `ASSET_LOCK_NOT_CANONICAL` for a
  schema-valid but re-serialized document. `AssetLock::parse` alone accepts it.
- Git object IDs are 4..=64 lowercase hex (`validate_oid`). A 64-character
  lowercase hex string is a valid OID and is never assumed to be 40
  characters. SHA-256 hashes are a separate namespace (`validate_sha256`,
  exactly 64 lowercase hex).
- Paths are relative, `/`-separated, at most 240 bytes, at most 16 segments,
  at most 80 bytes per segment. Traversal, `.`, absolute paths, drive letters,
  backslashes, control characters, Windows device names, `.git` components and
  case-insensitive collisions are rejected.
- Unicode NFC normalization is the producer's responsibility; the hash always
  covers the stored bytes.
- `AssetLock::parse` rejects documents over 8 MiB (`ASSET_LOCK_TOO_LARGE`) and
  non-UTF-8 bytes (`ASSET_LOCK_NOT_UTF8`).

### Test vectors

`tests/godot-remaining/M/contract/asset-lock-vectors.json` holds the frozen
canonical text, the golden hashes and the error vectors:

- Fixture lock hash `b95794a2afd498e782e6ec64ec84f1a595d9b56ac723ee4c997a15bbcaad9f0b`
  (1688 canonical bytes; the SHA-256 of the stored text equals the lock hash).
- Empty lock hash `70396c0e7b3582530fb2765684ae9a8bbc6579c93066539e5ed83ce0db5a4809`
  (58 canonical bytes).
- 25 error vectors covering OID/SHA-256 confusion, mutable versions,
  duplicate versions, unresolved and cyclic dependencies, traversal, absolute
  and backslash paths, Windows device names, case collisions and
  non-canonical lock bytes.

Regenerate the vectors with the ignored probe in section 9. Changing a golden
value is a contract change agreed with the asset-catalog owner, not a bug fix.

## 3. Managed Git boundary

`git.rs` is the only module in the crate that spawns Git. Frozen rules:

- **Program provenance.** Bundled candidate paths are tried in order; only if
  none exists does the adapter fall back to `PATH`. The result is recorded as
  `GitSource::Bundled` or `GitSource::PathFallback` in
  `GitProgramInfo { path, version, versionMajor, versionMinor, sha256, source }`,
  so no report can claim a bundled binary that was not used. A
  player-installed Git is never required.
- **Version floor.** `MINIMUM_GIT = (2, 38)`. Lower versions fail with
  `GIT_VERSION_TOO_OLD`. The floor exists because `merge-tree --write-tree` and
  reliable `update-ref` compare-and-swap need it.
- **Argument arrays only.** Every call is `Command` with an explicit argument
  vector and structured stdin. There is no shell, no string interpolation and
  no interactive prompt. Default timeout 120 s; a timeout kills the child and
  returns `GIT_TIMEOUT`. stdout is capped at 64 MiB, stderr at 1 MiB.
- **Managed configuration replaces user and system configuration.**
  Environment forced on every child process:
  `GIT_CONFIG_NOSYSTEM=1`,
  `GIT_CONFIG_GLOBAL=<configDir>/gitconfig`,
  `GIT_TERMINAL_PROMPT=0`,
  `GIT_ASKPASS=<configDir>/deny-askpass.{cmd,sh}` (a helper that always fails),
  `GIT_PAGER=cat`, `GCM_INTERACTIVE=never`, `GIT_OPTIONAL_LOCKS=0`,
  `HOME=<configDir>/home`, `XDG_CONFIG_HOME=<configDir>/home/.config`,
  `USERPROFILE=<configDir>/home`.
  The managed `gitconfig` is created by Craftmine and never reads or writes the
  player's global configuration. Tests prove that a host global `user.name` is
  invisible to the managed adapter and that every reported configuration origin
  is the managed file or a command-line override.
- **Command-line overrides on every invocation** (they win over repository and
  system configuration): `core.hooksPath=<configDir>/empty-hooks`,
  `core.fsmonitor=false`, `core.autocrlf=false`, `core.safecrlf=false`,
  `core.symlinks=false`, `core.longpaths=true`, `core.quotepath=false`,
  `core.fileMode=false`, `core.editor=false`, `core.pager=cat`,
  `credential.helper=`, `protocol.allow=never`, `protocol.file.allow=never`,
  `protocol.ext.allow=never`, `fetch.recurseSubmodules=no`,
  `submodule.recurse=false`, `advice.detachedHead=false`, `gc.auto=0`.
- **Neutral working directory.** Every child runs in `<configDir>/work`, so Git
  cannot discover a repository by walking up from the host process's current
  directory (this was a real defect that was found and fixed; the product
  checkout's `.git/config` must never be read).
- **Subcommand allowlist.** `init`, `hash-object`, `cat-file`, `ls-tree`,
  `mktree`, `update-index`, `write-tree`, `read-tree`, `commit-tree`,
  `update-ref`, `symbolic-ref`, `for-each-ref`, `rev-parse`, `rev-list`, `log`,
  `show`, `diff-tree`, `diff`, `merge-tree`, `merge-file`, `merge-base`,
  `mktag`, `prune`, `fsck`, `bundle`, `config`, `count-objects`,
  `verify-pack`, `tag`, `check-ref-format`. Anything else, including `clone`,
  `fetch`, `push`, `submodule`, `filter-branch` and `daemon`, is refused before
  spawning with `GIT_SUBCOMMAND_REFUSED`.
- **Repository configuration is scanned and refused.** Both `key = value` lines
  and `[section "name"]` headers are examined. Forbidden prefixes:
  `core.hookspath`, `core.fsmonitor`, `core.pager`, `core.sshcommand`,
  `core.gitproxy`, `core.editor`, `core.askpass`, `core.attributesfile`,
  `filter.`, `diff.external`, `difftool.`, `mergetool.`, `merge.`,
  `credential.`, `include.path`, `includeif.`, `alias.`, `protocol.`, `url.`,
  `http.`, `remote.`, `submodule.`, `uploadpack.`, `receivepack.`, `gc.`,
  `pager.`, `safe.`, `fsmonitor.` — reported as `GIT_CONFIG_FORBIDDEN`. The scan
  runs after `init` and whenever an existing repository is opened.
- **Host identity, no player email.** `GitIdentity::local(displayName,
  stableId)` validates the display name (non-empty, at most 120 characters, no
  control characters or `<`/`>`) and derives the email as
  `<stableId>@craftmine.local`, where the stable id is filtered to
  ASCII alphanumerics plus `-`, `_`, `.` and truncated to 64 characters.
  `GIT_AUTHOR_*` and `GIT_COMMITTER_*` are set per commit; no global identity
  is read and no email is requested from the player.
- **Variable-length object IDs.** `validate_oid` accepts 4..=64 lowercase hex.
  `repo.json` records the repository object format instead of assuming 40
  characters; SHA-256 repositories are exercised end to end by the tests.
- **Reference names.** `validate_ref_name` rejects empty names, names other
  than `HEAD` that do not start with `refs/`, `..`, `@{`, trailing `/`,
  `.lock`, `//`, whitespace and `~ ^ : ? * [ \`.

## 4. Repository layout and identity

```text
<root>/repos/<repoKey>/repo.git      managed bare repository
<root>/repos/<repoKey>/repo.json     identity and object format
<root>/repos/<repoKey>/copies/<key>  build copies, never containing .git
```

- `repoKey` is the first 16 bytes of SHA-256 of the logical repository id,
  written as 32 hex characters. The logical id is validated with
  `validate_identifier` and is never used as a filesystem component, so
  case-insensitive filesystems cannot alias two worlds and no world-authored
  string can traverse a path. `RepositoryStore::repo_key` is the only mapping.
- `repo.json` is `craftmine.content-repository/1` (`RepoMetadata { format,
  repoId, objectFormat, createdAt, legacyWorld }`). `objectFormat` is the value
  reported by Git after `init --object-format`; `create` fails with
  `GIT_OBJECT_FORMAT_UNSUPPORTED` when the requested format is not `sha1` or
  `sha256` or when Git reports a different format. `DEFAULT_OBJECT_FORMAT` is
  `sha1`.
- Content history lives under the task journal directory; the store root is
  created on `open` (`CONTENT_STORAGE_UNAVAILABLE` on failure).
- Build copies are materialized by reading committed objects, never by
  `checkout`: no hook, filter, smudge/clean driver or `.git` directory can reach
  a build input. Only `100644` and `100755` entries are written; symlinks and
  submodules are reported as `CONTENT_COPY_UNSUPPORTED_ENTRY` instead of being
  skipped. An existing target is `CONTENT_COPY_EXISTS`; an empty tree is
  `CONTENT_COPY_EMPTY`. The returned `MaterializedCopy` records path, file
  count, byte count and object format.
- Authoring exclusions are enforced on every committed path and on every tree
  entry read back: `.godot/`, `.git/`, `credentials/`, `secrets/`,
  `user-data/`, `save/`, `saves/`, `logs/`, plus the exact names `.env`,
  `.git`, `credentials`, `secrets` → `CONTENT_PATH_EXCLUDED`.
- Commit limits: at most 100,000 files, at most 64 MiB per file, at most
  512 MiB per commit. A bulk commit hashes all files in one
  `hash-object -w --stdin-paths` invocation so a large import does not spawn
  one process per file; staging files are removed afterwards.

## 5. History, branches, checkpoints, drafts, versions, applied marker

- **Branches.** `refs/heads/<branchId>`; `MAIN_BRANCH = "main"` is the formal
  branch. Branch ids are validated identifiers; display names never become ref
  names. `branch_head` returns `None` when the branch does not exist.
- **Commits.** `commit` writes blobs, tree and commit first, then advances the
  branch with `update-ref --stdin` using `create` (no expected value) or
  `update` (expected old value). A concurrent writer that moved the branch wins
  and the loser gets `GIT_REF_CAS_FAILED`; the losing objects stay unreachable
  and harmless.
- **Commit messages.** `commit_message(requestId, taskId, title, detail)` writes
  the title, optional detail and the trailers `Craftmine-Request` and
  `Craftmine-Task`. `group_by_request` groups history by the request trailer;
  commits without one are grouped alone so no history is invented.
- **History.** `history(rev, skip, limit)` returns
  `HistoryPage { records, skip, limit, total, nextSkip }`, newest first, page
  size 1..=200 (`INVALID_HISTORY_PAGE` otherwise). Each `CommitRecord` carries
  `oid`, `parents`, author name/email/date, subject, and the `requestId`,
  `taskId`, `legacyRevision`, `legacyManifestHash` trailers.
- **Checkpoints.** `refs/craftmine/checkpoint/<taskId>/<sequence:04>`
  (`set_checkpoint`). Re-setting the same task, sequence and OID is idempotent;
  the same sequence with a different OID is `CONTENT_CHECKPOINT_CONFLICT`.
  Checkpoints are internal, never shown as player-visible versions, and are
  protected from reclaim.
- **Drafts.** `refs/craftmine/draft/<branchId>` (`set_draft` / `draft`).
  Drafts live outside `refs/heads`, survive failed checks and stale candidates,
  and are protected from reclaim.
- **Versions.** `refs/craftmine/version/<versionId>` (`create_version`) creates
  an annotated tag object with `mktag` so the version metadata survives
  bundling without the product database. Re-creating the same version with the
  same tag object is idempotent; a different target is `CONTENT_VERSION_EXISTS`.
- **Applied marker.** `refs/craftmine/applied/<worldKey>` (`set_applied` /
  `applied`) records the content the host confirmed as applied. The database
  remains the authority for "applied"; the ref makes the Git side auditable and
  recoverable. It is protected from reclaim.
- **Diffs.** `changes(from, to)` uses `diff --name-status -z --no-renames`.
  `file_diff` returns `FileDiff::Text { path, added, removed, patch }` or
  `FileDiff::Binary { path, oldBytes, newBytes }`; binary content is never
  rendered as a text patch.
- **Integrity.** `verify(refs)` runs `fsck --strict --no-progress
  --connectivity-only` and returns only lines that indicate real damage
  (missing, corrupt, broken, unable, invalid, error, fatal, bad), sorted and
  deduplicated, so progress chatter cannot be mistaken for damage and damage
  cannot be hidden behind a passing exit code.
- **Bundles.** `bundle(target, refs)` runs `git bundle create` followed by
  `git bundle verify`. The bundle is the Git carrier only; asset bodies, drafts
  and database data are packaged separately by the backup owner.

## 6. Merge and conflict reporting

`merge(base, ours, theirs)` runs
`merge-tree --write-tree --name-only --messages --merge-base=<base>`.

- Exit code 0: `MergeOutcome { tree: Some(<tree oid>), conflicted: false,
  messages, conflicts }`.
- Exit code 1: `MergeOutcome { tree: None, conflicted: true, messages,
  conflicts }`. A conflicted merge never returns a tree. `conflicts` lists the
  paths Git reported; the informational `messages` section is parsed
  separately.
- **A clean Git merge is not a gameplay pass.** It only means Git merged text.
  Semantic conflicts, scene entity deletion/reference, asset dependency
  conflicts, two versions of the same asset and binary conflicts must still be
  judged by the verifier, and a merged result must be re-built and re-checked;
  parent check evidence must not be reused. That verifier is owned by other
  tasks and is not part of this delivery.
- `commit_tree(branchId, expectedHead, tree, parents, message)` records the
  merge result as a commit and advances the branch with the same
  compare-and-swap rule.

## 7. Legacy migration and backend switch

The legacy store keeps an immutable manifest plus content-addressed blobs and
an increasing revision number. That numbering is not a Git graph, so it is
imported as linear history with an explicit map.

- **Logical identity.** `repo_id_for(world)` = `world-<sanitized world id>`.
- **Preflight.** `plan(db, directory, world)` is read-only. It reads every
  legacy manifest and every blob, checks the stored manifest hash and returns
  `MigrationPlan { worldId, repoId, objectFormat, sourceDigest, headRevision,
  revisions, problems }`. A non-empty `problems` list blocks the import. The
  digest is a stable `craftmine.legacy-source/1` hash of the source as it is
  right now.
- **Apply.** `apply(db, directory, store, world)` refuses to start when the plan
  has problems (`CONTENT_MIGRATION_SOURCE_INVALID`) or has no revisions
  (`CONTENT_MIGRATION_NO_LEGACY_REVISIONS`). It imports one commit per legacy
  revision on `main` with parent chaining, message trailers
  `Craftmine-Task`, `Craftmine-Legacy-Revision`, `Craftmine-Manifest-Hash` and
  `Craftmine-Assets: source-only` (and no `Craftmine-Request`, because a legacy
  revision carries no player-request identity). Every imported file is re-read
  from Git and compared byte for byte; a mismatch is
  `CONTENT_MIGRATION_BYTE_MISMATCH` and the mapping is not recorded.
- **Migrated commits carry no asset lock.** They must never be reported as
  playable content. `RepositoryStore::asset_lock` returns `None` for such a
  commit, and `content_ref` returns `CONTENT_ASSET_LOCK_MISSING`.
- **Mapping and refs.** Each revision is recorded in
  `craftmine_content_revision_map` (world, legacy revision, commit OID, tree
  OID, manifest hash, file and byte counts, import time) and tagged with the
  protected ref `refs/craftmine/migration/<repoKey>/<8-digit revision>`. A tag
  left by an interrupted attempt is replaced only after its commit is
  re-verified and recorded.
- **Backend switch.** The final transaction upserts
  `craftmine_content_repositories` (world, repo, object format,
  `backend = 'git'`, legacy head revision, created and switched timestamps) and
  `craftmine_content_migrations` (`status = 'switched'`, source digest, detail).
  Running `apply` again on a switched, fully mapped world returns
  `already_migrated: true` with no new commits.
- **Resumption, never a second history.** If a commit is already on `main` with
  matching `Craftmine-Legacy-Revision` and `Craftmine-Manifest-Hash` trailers,
  it is adopted only after its bytes are re-verified (`adopted`); otherwise a
  fresh commit continues the same parent chain. Interrupted imports therefore
  resume into one history, never two.
- **Post-switch verification.** `verify(db, directory, store, world)` re-checks
  the legacy blobs against the Git bytes and reports damage (missing blob,
  byte mismatch, file-count mismatch, head mismatch) instead of repairing it.
- **Write guard.** `assert_legacy_writes_allowed(db, world)` is the guard the
  legacy `godotProject.create` / `godotProject.patch` paths must call before
  writing. It returns `CONTENT_BACKEND_SWITCHED` once a world is Git-backed, so
  a switched world cannot grow a second content history.
- **Audit retention.** The old directory and the old database rows are left
  untouched for audit and rollback.

## 8. Reclaim and protection

- Protected ref prefixes (`PROTECTED_REF_PREFIXES`):
  `refs/craftmine/migration/`, `refs/craftmine/checkpoint/`,
  `refs/craftmine/draft/`, `refs/craftmine/version/`,
  `refs/craftmine/applied/`.
- `reclaim_plan(keep)` reports, without deleting anything:
  `reachable_objects` (reachable from the keep set),
  `referenced_elsewhere` (reachable only from refs outside the keep set — still
  referenced, so they must not be deleted), and `garbage_objects` /
  `garbage_bytes` (reachable from no ref at all: the only reclaim candidates),
  plus a sorted sample of up to 20 OIDs. A missing keep ref is
  `CONTENT_RECLAIM_REF_MISSING`; an empty keep set is
  `CONTENT_RECLAIM_KEEP_EMPTY`.
- `prune(keep)` deletes objects only when the plan reports true garbage, then
  runs `git prune --expire=now`. Protected versions, named branches, unfinished
  tasks, migration maps and local backup entries stay reachable by their own
  refs and are therefore never candidates.
- Cleanup policy must be validated together with the asset catalog; reclaim
  never removes a protected reference or a user source asset.

## 9. Error codes

Codes are exact strings; the table lists the codes owned by this delivery.

| Code | Raised when |
| --- | --- |
| `INVALID_GIT_OID` | an object id is not 4..=64 lowercase hex |
| `INVALID_SHA256` | a content hash is not exactly 64 lowercase hex |
| `INVALID_RELATIVE_PATH` | a stored path is empty, too long, too deep, has an empty/oversized segment, a control character, or a segment starting/ending with a space or ending with `.` |
| `PATH_TRAVERSAL` | a segment is `.`/`..`, or is `.git`/`git~1` |
| `PATH_RESERVED_NAME` | a segment is a Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, `COM0`–`COM9`, `LPT0`–`LPT9`, case-insensitive, ignoring an extension) |
| `PATH_COLLISION` | two paths differ only by case (or two overrides collide inside one scope) |
| `ASSET_LOCK_FORMAT_MISMATCH` | the lock document `format` is not `craftmine.assets-lock/1` |
| `ASSET_LOCK_MUTABLE_VERSION` | an `AssetRef.version` is `latest` or `head` (case-insensitive) |
| `ASSET_LOCK_VERSION_CONFLICT` | the same `(assetId, version)` appears with a different `AssetRef` |
| `ASSET_LOCK_DEPENDENCY_UNRESOLVED` | a dependency is not present in `assets[]` |
| `ASSET_LOCK_DEPENDENCY_CYCLE` | dependency cycles exist |
| `ASSET_LOCK_NOT_CANONICAL` | committed lock bytes are schema-valid but not canonical |
| `CONTENT_PATH_EXCLUDED` | a committed or read path is in the authoring exclusion list |
| `CONTENT_COMMIT_TOO_LARGE` | a commit exceeds 512 MiB in total |
| `CONTENT_FILE_TOO_LARGE` | one file exceeds 64 MiB |
| `CONTENT_COPY_EXISTS` | a build-copy target already exists |
| `CONTENT_COPY_UNSUPPORTED_ENTRY` | a tree entry is not a regular file (symlink/submodule) |
| `CONTENT_ASSET_LOCK_MISSING` | `content_ref` is requested for a commit without a canonical asset lock |
| `CONTENT_CHECKPOINT_CONFLICT` | the same task/sequence checkpoint already points at different content |
| `CONTENT_VERSION_EXISTS` | a named version already exists with a different tag object |
| `CONTENT_BACKEND_SWITCHED` | a legacy write entry point is called for a Git-backed world |
| `CONTENT_MIGRATION_SOURCE_INVALID` | the preflight plan reported problems, so the import is refused |
| `CONTENT_MIGRATION_BYTE_MISMATCH` | Git bytes differ from the legacy bytes during import or adoption |
| `GIT_SUBCOMMAND_REFUSED` | the subcommand is not on the allowlist |
| `GIT_CONFIG_FORBIDDEN` | a repository config key matches a forbidden prefix |
| `GIT_REF_CAS_FAILED` | a compare-and-swap reference update lost (stale expected value or existing ref) |
| `GIT_TIMEOUT` | a Git call exceeded its timeout and was killed |
| `GIT_PROGRAM_NOT_FOUND` | no bundled candidate and no Git on `PATH` |
| `GIT_VERSION_TOO_OLD` | the located Git is older than 2.38 |

Other codes in the same namespaces are returned by the same modules, including
`INVALID_ASSET_ID`, `INVALID_ASSET_VERSION`, `INVALID_MEDIA_TYPE`,
`INVALID_REPO_ID`, `INVALID_BRANCH_ID`, `INVALID_WORLD_ID`,
`INVALID_TASK_ID`, `INVALID_VERSION_ID`, `INVALID_REQUEST_ID`,
`INVALID_OPERATION_ID`, `INVALID_OVERRIDE_SCOPE`, `PATH_NOT_RELATIVE`,
`PATH_TOO_DEEP`, `INVALID_ASSET_LOCK`, `ASSET_LOCK_TOO_LARGE`,
`ASSET_LOCK_NOT_UTF8`, `CONTENT_COMMIT_FILE_LIMIT`,
`CONTENT_COMMIT_MESSAGE_INVALID`, `CONTENT_REPOSITORY_EXISTS`,
`CONTENT_REPOSITORY_NOT_FOUND`, `CONTENT_REPOSITORY_CORRUPT`,
`CONTENT_PATH_NOT_FOUND`, `CONTENT_COPY_EMPTY`,
`CONTENT_STORAGE_UNAVAILABLE`, `CONTENT_RECLAIM_KEEP_EMPTY`,
`CONTENT_RECLAIM_REF_MISSING`, `CONTENT_RECLAIM_TOO_LARGE`,
`CONTENT_BACKEND_UNKNOWN`, `CONTENT_BACKEND_CORRUPT`,
`CONTENT_MIGRATION_CORRUPT`, `CONTENT_MIGRATION_NO_LEGACY_REVISIONS`,
`INVALID_GIT_IDENTITY`, `INVALID_HISTORY_PAGE`,
`GIT_PROGRAM_UNREADABLE`, `GIT_PROGRAM_UNUSABLE`, `GIT_VERSION_UNKNOWN`,
`GIT_CONFIG_UNAVAILABLE`, `GIT_CONFIG_UNREADABLE`, `GIT_CONFIG_TOO_LARGE`,
`GIT_OBJECT_FORMAT_UNSUPPORTED`, `GIT_REPOSITORY_EXISTS`,
`GIT_OBJECT_MISSING`, `GIT_HASH_OBJECT_FAILED`, `GIT_INDEX_FAILED`,
`GIT_WRITE_TREE_FAILED`, `GIT_COMMIT_TREE_FAILED`,
`GIT_COMMIT_MESSAGE_INVALID`, `GIT_TREE_MODE_INVALID`,
`GIT_REF_NAME_INVALID`, `GIT_REF_PREFIX_INVALID`, `GIT_REF_UPDATE_EMPTY`,
`GIT_LIST_REFS_FAILED`, `GIT_REV_UNKNOWN`, `GIT_LOG_FAILED`,
`GIT_MERGE_BASE_FAILED`, `GIT_MERGE_TREE_FAILED`, `GIT_MERGE_TREE_INVALID`,
`GIT_MKTAG_FAILED`, `GIT_DIFF_FAILED`, `GIT_DIFF_INVALID`,
`GIT_LS_TREE_FAILED`, `GIT_LS_TREE_INVALID`, `GIT_TREE_PATH_NOT_UTF8`,
`GIT_CAT_FILE_FAILED`, `GIT_REV_LIST_FAILED`, `GIT_REV_LIST_INVALID`,
`GIT_BUNDLE_REFS_EMPTY`, `GIT_BUNDLE_FAILED`, `GIT_BUNDLE_INVALID`,
`GIT_PRUNE_FAILED`, `GIT_SPAWN_FAILED`, `GIT_WAIT_FAILED`,
`GIT_OUTPUT_NOT_UTF8`.

## 10. Verification commands

Run from `vendor/pi-desktop` in this worktree:

```powershell
# VM0/VM1 unit and integration tests against the real Git binary
cargo test -p craftmine-core --offline content_history

# Ignored probe that prints the frozen canonical lock text and hashes
cargo test -p craftmine-core --lib content_history::contract_tests::print_frozen_vectors -- --ignored --nocapture
```

At the time of writing the module filter reports **35 passed, 0 failed, 1
ignored** for the five modules documented here (contract, git, repo, migration:
36 tests). The same `content_history` filter also matches the 6 VM2
Git-transaction tests of the wider delivery, so the full filter reports **41
passed, 0 failed, 1 ignored** (42 tests). The single ignored test is the vector
probe above.

The probe prints `LOCK_HASH`, the canonical lock text between `LOCK_TEXT_START`
and `LOCK_TEXT_END`, `EMPTY_HASH` and the debug form of `EMPTY_TEXT`. The
committed vector file must be regenerated from that output, and
`sha256(lockText)` must equal `LOCK_HASH`.

No browser, mouse, keyboard, focus or Pointer Lock test is part of this
verification. Automated acceptance runs only in independent headless/offscreen
processes with an independent data directory, or as pure-logic tests.

## 11. Known gaps / not implemented

- **VM2 real application wiring is not implemented here.** The Git-side
  reference transaction and crash-recovery state machine exists, but the real
  deployment record, progress transaction, asset persistence and instance
  promotion depend on tasks A (deployment/host wiring), C (build/execution) and
  D (runtime/instance). This document makes no claim that a candidate was
  applied, played or rewarded.
- **`lib.rs` / `main.rs` wiring belongs to task A.** The module is not
  registered by this delivery; the mergeable snippet and the guard call are
  recorded in `docs/dispatch-reports/godot-remaining/M/INTERFACE_M.md`. The
  tests above were obtained with a temporary module registration, which was
  withdrawn.
- **The bundled Git binary is not delivered.** The adapter records provenance
  and prefers bundled candidates, but the measured run used a `PATH` fallback
  (`git version 2.53.0.windows.1`). VM0's pinned bundled binary, provenance and
  license list still need to be supplied.
- **VM3 semantic/gameplay conflict judgement is not implemented.** Only Git
  text merge and conflict-path reporting exist; asset-version, dependency,
  scene-entity and binary conflict judgement and partial undo belong to VM3.
- **VM4 fork/export end-to-end is not implemented.** Named versions, bundles
  and protected refs exist; creating a new world from a version and exporting a
  shareable package is not wired.
- **VM5/VM6 are not implemented.** Remote sync, credentials, LFS-compatible
  asset transfer, hosted work pages, remote change proposals and team
  permissions do not exist. Network protocols are explicitly disabled.
- **No real Godot build/apply evidence.** No real build, no real instance
  promotion, no real player-visible apply was executed; no real-model creation
  task was run.
- **No performance figures.** The 1k/10k file and commit tiers, history/diff
  P50/P95, cancellation latency, migration and backup timings have not been
  measured, so no speed commitment is made.
- **Backup scope is not jointly accepted.** `bundle()` and the table list are
  provided; adding the `craftmine_content_*` tables and
  `content-history/repos/**` to the full-backup and fresh-directory restore
  path is task H's work.
