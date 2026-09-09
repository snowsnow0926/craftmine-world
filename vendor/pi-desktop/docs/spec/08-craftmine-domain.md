# Craftmine domain integration

This is a downstream product specification. See ADR 0300.

## Task journal contract

- `TaskBinding` is host-owned project, session, turn, task and base-build identity.
- Starting an existing task never resets its draft or cancellation status.
- Draft revisions increase by one inside a transaction that also stores the tool receipt.
- A duplicate call with identical input returns its prior receipt. Reusing an ID with different content is rejected.
- A stale revision, foreign binding, invalid document or cancelled task leaves the current draft unchanged.
- Document size is bounded. SQLite uses full synchronous WAL transactions; file content is checked against the recorded hash.
- The application has not yet delegated live world writes to this journal. Compiler, evidence and project lease integration are W1/W2 work; there is no model-accessible bypass that can publish an unverified draft.

## Plugin execution identity

The Rust `plugins.execute` notification includes its existing `sessionId`, `toolCallId`, and `executionId`, plus `turnId` from `ToolsExecuteParams`. Electron main, PluginRuntime, the plugin process, and `PluginToolExecContext` preserve these values. The public fields remain optional for compatibility. Craftmine mutating tools must reject missing identity rather than accepting IDs supplied by the model. Execution IDs identify dispatch attempts; tool-call IDs remain the idempotency identity within the bound task. Cancellation and project binding remain separate requirements.

## Product service and world panel

`craftmine-core --data-dir <absolute path>` owns `tasks.sqlite` and accepts bounded JSON-lines requests on its private stdio pipe. `hello`, `task.start`, `task.inspect`, `task.commit` and `task.cancel` are available to the trusted broker. The built-in `craftmine.world` plugin owns the service lifecycle. Its first agent tool reports actual runtime status and explicitly reports world publishing as unavailable.

The world view bundles trusted local resources into a sandboxed srcdoc iframe using script-hash CSP entries. The iframe exposes neither the plugin bridge nor Node. Blob Workers support the existing authored-code runtime. Message exchange requires the expected source window and a per-frame nonce. File-origin replies use a wildcard target only because the receiving document has an opaque origin; incoming validation remains mandatory.

## Desktop acceptance

The same Rust database now owns a `craftmine_worlds` table: world identity, title, revision, timestamp, compiled document, progress and content hash. The plugin's panel bridge can list worlds, create a compiler-checked empty world, open one and save validated gameplay progress. Saving progress cannot replace a build or extension catalogue. Revision and base-build checks reject stale views; integrity failures report an error without resetting the stored world. No JavaScript ProjectStore writes this desktop database.

The panel saves manually, every ten seconds while loaded, and before switching or creating another world. Switches freeze and flush the old runtime before writing progress. Restart restores the last selected world through plugin settings and re-reads its authoritative content from Rust. World switching replaces the sandboxed iframe and its nonce.

Before application quit, closing the world tab, or disabling/uninstalling its plugin, the trusted panel freezes gameplay and acknowledges an authoritative Rust save. The acknowledgement identifies the world, saved revision and build. A failure or 30-second deadline cancels shutdown and resumes the page, retaining progress for a retry. Overlapping saves and switches are serialized. The world view is excluded from opportunistic LRU eviction. A native close is not pre-authorized merely because the user chose Quit. See ADR 0302. This protects intentional closes; abrupt renderer/OS failure recovery and full native Electron acceptance remain separate work. Candidate publishing and session-to-world binding remain W2 follow-up work.

## Read-only legacy import

The Import action obtains a directory through the existing native picker. Electron forwards only the granted directory to the built-in importer, replacing page-supplied paths. It accepts a legacy project root or its `.craftmine` directory. Rust captures every regular file and directory under a unique `legacy-imports/<id>/source` archive, synchronizes files, checks a second full source digest pass, and records a sealed manifest in SQLite. Capture never constructs a JavaScript ProjectStore on the original data, modifies it or resumes old tasks.

The compatibility compiler reads hash-checked original JSON text through `legacy.readText`. It preserves build identity for formats 2–4, full scene, progress, extension code and fixed asset versions; missing dependencies, invalid extension ABI, duplicate commands and asset/build hash mismatches reject import. Format 1 is verified using the original JSON property order, then its playable copy is upgraded to format 2 with a new canonical build ID. The original format-1 bytes and ID stay archived. Rust commits a new world and its archive provenance in one transaction. Replaying the same import does not reset later progress. Existing desktop worlds are retained. Historical modules, candidates and uncommitted task files remain complete in the archive; activation in the new creation UI is subsequent W2/W3 work.

Bounds are 256 MiB per archive, 64 MiB per file, 10,000 files plus directories and 32 nested directory levels. Symbolic links and Windows reparse points are rejected. The source cannot overlap the domain service profile. World documents allow 64 MiB for existing base64 asset packages; task documents retain their separate 2,000,000-byte limit. Private stdio requests allow 72 MiB. The product import operation has a 90-second broker deadline inside a 120-second panel-call timeout; directory selection itself remains outside this timed import. See ADR 0303.

Preserve project and session navigation, streaming conversations, cancellation, tool details, file and diff panels, model settings, themes and panel resizing. Add world and creation tabs, candidate preview and verification evidence using the same work-panel model. Provide Chinese defaults and an optional immersive play layout.

The first desktop slice adds a fixed World entry in the existing sidebar and opens it on a new profile with no retained session or resource tabs. The initial work-panel width is 560 pixels; persisted widths are honored. The product mark and English/Chinese welcome copy identify Craftmine. The plugin world view consumes `app.getAppearance` and `appearance:changed`. Product paths, per-profile instance locks and disabled upstream updates follow ADR 0301. Immersive layout, creation-library and candidate panels remain subsequent slices.
