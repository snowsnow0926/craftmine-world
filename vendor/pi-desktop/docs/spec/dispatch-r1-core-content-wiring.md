# Managed content history: core wiring

R1 registers the Git content history in the core, exposes it over RPC, and moves
Godot project read/write onto it. `content_history/**` owns the contract, the
managed Git adapter and the repository operations; this document describes how
the rest of the core consumes them.

## Registration

`TaskJournal::open` declares `content_history` and runs both of its migrations
after the Godot tables, so a default build always contains them. The journal
holds a per-process `OnceCell<GitAdapter>`; the probe (version + binary hash)
runs once and the adapter is never rebuilt.

`TaskJournal::git_adapter()` discovers the managed Git program. Bundled
candidates (an explicit `CRAFTMINE_BUNDLED_GIT` path, then `git/…` beside the
executable) win; a PATH fallback is recorded as `GitSource::PathFallback` and
reported verbatim by `content.gitInfo`/`content.status`. A delivery must ship a
bundled binary before claiming one; the adapter never assumes it.

Windows verbatim paths are stripped before any path reaches the child process.
`std::fs::canonicalize` returns `\\?\C:\…`, and Git cannot read its managed
configuration, create a repository or write its index under such a path.

## One content history per world

A world is either `legacy` (the immutable revision/blob store) or `git`. The
switch is recorded in `craftmine_content_repositories`. For a Git-backed world:

- SQLite keeps a head index only: `craftmine_godot_projects` (revision,
  manifest index, manifest hash) plus `craftmine_godot_project_commits`
  (revision → commit OID, manifest hash, asset-lock hash).
- No `craftmine_godot_revisions` row is written. History, branches and versions
  come from `content.history`, `content.branch.*` and `content.version.*`.
- `godotProject.create/patch` commit the full file set plus the canonical
  `craftmine.assets.lock.json` when the world has assets, and require the host
  `OperationContext`: `branchId` must be `main` and `expectedHeadOid` must equal
  the commit the patch was prepared against. A missing context is
  `CONTENT_OPERATION_CONTEXT_REQUIRED`; a moved branch is
  `CONTENT_EXPECTED_HEAD_MISMATCH` (and Git's own CAS is the final guard).
- Reads (`godotProject.index/read`, `godotBuild.start` materialization) come
  from the commit. `project_manifest` reconciles a commit that landed before its
  index row: Git is authoritative, so the index is rebuilt from the tree and the
  `Craftmine-Revision` trailer, never the other way round.

## Builds and candidates

A Git-backed build records `content_oid` and `asset_lock_hash`; both are part of
the build identity, so the same source revision on a different commit is a
different build. `require_ready_candidate` marks a candidate stale when the
commit it was built from is no longer the commit the revision maps to, in
addition to the existing revision/manifest/asset checks.

## Progress

Godot progress may only be saved for a build with a real `applied` application
record. A world document that merely claims a build id is not enough, and the
initialising world has no exception: it becomes playable only after its own
verified check and confirmed first launch. This closes the path where a page or
model could persist progress against a self-declared build.

## Contract vectors

`tests/godot-remaining/M/contract/asset-lock-vectors.json` is executed by
`content_history::contract_vectors_tests`: every error vector must fail with its
frozen code and both positive vectors must reproduce their golden hash and
canonical text. A vector without a runner fails the test, so R4/R6 consumers and
this crate cannot drift apart.
