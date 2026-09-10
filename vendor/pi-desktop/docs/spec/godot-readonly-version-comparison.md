# Read-only Godot version comparison (VM2 subset)

The existing Versions and creation branches panel compares one visible version
or the selected branch head against the world's formally applied content OID.
The direction is formal → selected. Added, deleted, modified and type-changed
files come from `content.changes`; per-file patches come from `content.diff`.
No AI summary, semantic scene interpretation, restore, merge, ref movement,
candidate application, source edit or progress write occurs during comparison.

## Main boundary

- `godot.historyLoad` returns a host-created opaque `viewId`, alongside the
  existing public history/index projection. Main retains at most 16 views.
- A view binds world, repository, branch, branch head, applied OID, and the
  exact OIDs returned on that history page (plus the current branch head).
- `godot.historyCompare({worldId,viewId,targetOid,offset?})` returns identity,
  at most 32 `{path,status}` entries, `offset`, exact `total`, and `nextOffset`.
- `godot.historyDiff({worldId,viewId,targetOid,path})` only accepts an exact
  member of that comparison's change list. It returns text line counts and a
  UTF-8-safe patch prefix of at most 65,536 bytes, with exact original/shown byte
  counts and `truncated`; or binary old/new sizes (null means absent).
- Both operations recheck world selection, repository, branch head and applied
  OID before and after Git reads. Stale/evicted views require refresh. Renderer
  cannot supply refs, contexts, Git directories or arbitrary filesystem paths.
- Source-only migration has no formal version. Comparison remains unavailable
  until a real application establishes one; current source is never substituted.
- Raw Git stderr is not returned to the renderer. Unsupported/unreadable or
  over-limit upstream diffs fail as `GODOT_HISTORY_READ_FAILED`, not success.
  The core's existing bounded Git process remains responsible for computation;
  the 64 KiB limit is the displayed/transported patch, not incremental Git paging.

`godotProject.sourceContext({worldId})` is added only to the exact private host
allowlist. `historyLoad` and `historyReadSource` use this existing core-derived
workspace context; they do not call `turn.begin` or `workspace.endTurn`. Missing
source context fails explicitly. Existing index recovery may reconstruct index
metadata from authoritative Git; it does not create authoring work or alter
content/progress. Source writes and checks retain their existing task/CAS path.

## UI and concurrency

Each displayed history record and current branch have a comparison action. File
pagination and text truncation are visible. Binary changes never receive a fake
text patch. React renders all paths, commit subjects and patch content as escaped
text. There are no Markdown/HTML interpreters or clickable local file links.
World/view/target changes invalidate outstanding UI requests; response identities
are checked again before rendering. Current progress changes do not invalidate a
content comparison because they do not change either immutable content OID.

## Validation

- `tests/plan-loop/version-diff-service.test.mjs`: eight finite boundary cases.
- `tests/godot-history-panel.mjs`: actual Git/Rust + headless React, no OS input;
  32-file pagination, text/binary/deletion, Unicode truncation, inert source HTML,
  full DB/world invariance and existing branch/edit/check/restart regression.
  Its explicit Git applied-ref fixture is not gameplay application evidence.
- `tests/plan-loop/version-diff-applied-core.mjs`: copy only an explicitly
  authorized completed test's core directory. Real previously adopted source is
  compared with its earlier revision; complete progress/DB identity and restart
  are verified. The original archive is never launched or changed, and sibling
  profile directories (including credentials) are not read.
- `tests/plan-loop/version-diff-ui-races.mjs`: actual headless React rejects late
  world/version responses and malformed identity, without input/focus/Pointer Lock.

This slice does not complete all VM2 recovery/application requirements or prove
the new UI inside a Windows distribution. Those retain their separate acceptance.
