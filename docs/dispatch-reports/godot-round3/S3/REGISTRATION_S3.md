# S3 registration and handoff

Task: `docs/dispatch-prompts/godot-round3-20260910/S3-bases-and-package-install.md`
Branch: `codex/godot-round3-s3-20260910`
Worktree: `D:\Craftmine World-worktrees\godot-round3-s3-20260910`
Base: `24edb0c` (S1's round-three start commit on top of the committed R2 integration head)

S3 owns `desktop/godot/bases/**`, `desktop/godot/shared/**` and the
package/install/reuse part of `library/**`. The modules below are implemented,
tested and committed; the **product entry points are not registered yet** because
`main.rs`, the plugin service construction and the Electron UI belong to S1, S2
and R2. Nothing in this document has been applied to their files.

## 1. S1 — core RPC dispatch (`crates/craftmine-core/src/main.rs`)

Two lines in the first `match method` block register the existing core methods:

```rust
"package.formatCheck" => return journal.package_format_check(params),
"package.planInstall" => return journal.package_plan_install(params),
```

- `package_format_check(&self, &Value) -> Result<Value>` —
  `library/package_format.rs`. Accepts `text`, `paths`, `kind`, `legacy`,
  `lock`, `manifest`, `package` + `entries`. The `lock` branch now validates and
  canonicalizes the **single** `craftmine.assets-lock/1` contract and returns
  `{lock:"ok", lockFormat, assetLockHash, assets}`.
- `package_plan_install(&self, &Value) -> Result<Value>` —
  `library/installer.rs`. Returns `{ok, operationId, worldId, order, instances,
  remappedInputActions, conflicts, lock, assetLockHash, applied:false, note}`.
  `lock` is a canonical `{format, assets[]}` document; the old
  `{direct, closure, graph}` shape is gone. Any existing consumer that read
  `lock.direct/closure/graph` must migrate (nothing in this branch still does).

No new operation-journal entry is needed: `package.planInstall` is read-only and
`package.formatCheck` writes nothing. The formal commit of a draft stays with
S1's existing content/`godotProject` transaction — S3 does not add a core method
for it.

## 2. S2 — plugin service and routing

`plugins/craftmine-world/package-format.mjs` exports `validateLock` again, but
it now delegates to `plugins/craftmine-world/asset-lock.mjs`; the only accepted
document is the canonical lock. The ZIP layer gained
`assertShareablePath`, `uniqueAssetVersions` and the
`PACKAGE_VERSION_CONFLICT` / `PACKAGE_PRIVATE_FILE_REFUSED` rejections.

Service channels to forward (field lists are the exact accepted keys):

```js
'package.formatCheck':['text','paths','kind','legacy','lock','manifest','package','entries'],
'package.planInstall':['operationId','resources','target','options'],
```

The draft install is a **host-side** step (it writes project files, not database
rows), so it is constructed in the host/plugin process rather than routed to the
core:

```js
import {planDraftInstall, applyDraftInstall, recoverDraftInstall}
  from '../../../desktop/godot/shared/draft_install.mjs';

const planned = planDraftInstall({plan, payload, projectDir, sceneEdits, inputActions,
  expectedHead, currentHead});
// planned.ok === false -> show planned.conflicts, write nothing
const receipt = applyDraftInstall({plan, payload, projectDir, sceneEdits, inputActions,
  expectedHead, currentHead, shouldCancel});
// receipt.ok, receipt.applied, receipt.alreadyApplied, receipt.conflicts
// receipt.created / replaced / unchanged, receipt.fileSetHash, receipt.assetLockHash
```

`payload` is `[{contentHash, path, bytes}]` (the unpacked package), `sceneEdits`
come from `components.mjs`'s `planInstallation`, `inputActions` are the actions
the installed components declare. `recoverDraftInstall({projectDir, operationId})`
rolls back an interrupted apply; unknown operation ids are refused.

## 3. R2 — client wiring

The install is one reviewable step, not a file-by-file loop:

1. `package.formatCheck` + `unpackStaticPackage` → show conflicts and the
   dependency order (no writes).
2. `package.planInstall` → show `order`, new `instanceId`s, `entityMap`,
   `installPath` and `conflicts`; `applied:false` means "plan only".
3. Build `sceneEdits` with `components.mjs` `planInstallation` and call
   `planDraftInstall` → show the complete file set (paths + hashes + lock hash).
4. `applyDraftInstall` → apply the draft, then run the existing build check and
   the formal content transaction; a failed check or transaction must leave the
   previous world untouched (the draft rollback covers the file step, the
   transaction covers the commit).
5. Navigation/UI entry: the existing "作品/创作包" panel; `package.*` must be
   routed through the panel gateway like the other Godot methods.

## 4. S5 — assets and media types

`plugins/craftmine-world/asset-lock.mjs` owns the canonical lock for
JavaScript; the media-type table it uses to convert a package file into a lock
`FileRef` is mirrored in Rust (`library/package_format.rs::media_type_for_path`)
and frozen in `tests/godot-round3/S3/vectors/asset-lock-vectors.json`
(`mediaTypes`). If the asset library needs a new media type, add it to both the
table and that vector list; do not add a second lock shape.

## 5. S6 — model tools

Read-only entries only: `package_inspect` (`package.formatCheck` +
`unpackStaticPackage` summary) and `package_plan_install`
(`package.planInstall`). Do not expose `applyDraftInstall` to the model; the
package README/scripts are analysed content, never instructions.

## 6. What is still missing for product acceptance

- S1 registration (§1) — without it `package.formatCheck` / `package.planInstall`
  are not reachable from the real client.
- S2 construction/routing (§2) and R2 wiring (§3) — without them the draft
  installer is only called by tests.
- The formal revision transaction and build check for the applied draft (S1/S2)
  and the real client run (R2/S7).
