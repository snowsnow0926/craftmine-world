# Windows export service

Host-only createGodotWindowsExportService receives domainCall, selection, checkpoint(worldId), pickDirectory({worldId}), stagingRoot, resourcesRoot and pinned toolchain {broker,brokerIdentity,engineRoot}. The private channels godot.exportWindows, godot.exportWindows.status and godot.exportWindows.cancel accept only {worldId,operationId}; renderer paths and commands are rejected. The parent constructs this service and routes these exact channels. Use a short per-profile staging root, e.g. temp/cwx-<profile hash>. resourcesRoot is the staged Godot directory. Required new files: shared/standalone_bootstrap.gd and shared/windows-export.cfg. The broker build identity now includes the latter compile-time preset.

Before export, checkpoint must obtain a real durable active-view save receipt. Formal exportSource returns the exact source and progress lineage; each body is read at contentOid and hash checked. Package-only project.godot mutations add a fixed standalone autoload, unique native user-data scope, fixed Windows preset and the exact initial snapshot. Original source hashes and complete transformed source accompany EXE/PCK, pinned Godot license/copyright and provenance. Copy identity mapping changes only the two world identity fields at the runtime boundary. No managed source files or progress are written.

The broker and native template are pinned. The service checks source and artifact hashes, request/source identities, LPAC/network/process/cleanup receipts and exact log diagnostics before atomic publication into a fresh selected-directory child. Same-world concurrent operations are rejected. Same-operation replay returns its receipt; failed transport does not initiate another export. Persisted publication intent allows a renamed output to be recognized after a lost completion write. Interrupted task recovery uses only the pinned broker journal for the exact owned tasks root; it never claims recovery means export succeeded. Staging and failed evidence are retained; cumulative export/staging quota and GC are not implemented.

Save bootstrap remains native, with no browser or editor bridge. It restores full managed state, saves periodically/F5/button/on close, and preserves previous JSON on failed writes. Exported native programs run with normal user permissions. Local preview does not clear pending source/module redistribution rights. First-person, top-down and side-view are accepted; mining-sandbox remains separately pending.

Mining-sandbox follow-up: now enabled after real formal export and full native restart; nested body.state.worldId is validated and mapped explicitly. Standalone failed-state mapping refuses writes. Backup recovery preserves the known valid backup and retains a rejected primary separately. Native corrupt-primary, both-corrupt and failed-write acceptance passed; see windows-service/mining evidence.

## Applied runtime license notices (2026-09-15)

After the owner's project-code authorization, future exports include the exact
`CRAFTMINE-RUNTIME-MIT.txt` and `CRAFTMINE-RUNTIME-NOTICES.md` from staged Godot
licenses beside the existing Godot texts. All four texts are hash-verified before
any notice is written. Missing or modified texts fail the unpublished export;
the existing owned-stage cleanup and publication boundary remain unchanged.

The MIT grant applies only to original project runtime in the source scopes named
by the notice. Models, fonts, other assets, user content and independently
generated code are not automatically licensed. Export provenance and README
describe this distinction instead of claiming every authored module lacks a
license. Existing receipts retain their historical status; exports are not
retroactively rewritten. Full source continues to accompany the exported game.

Future desktop packages also carry the root license, bilingual scope index,
third-party index and project license texts in `resources/licenses/`. Package
verification compares their bytes with the current source tree. This is not a
claim that every third-party dependency or user asset has passed a rights audit.
