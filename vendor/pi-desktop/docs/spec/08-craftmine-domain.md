# Craftmine domain integration

This is a downstream product specification. See ADR 0300.

## Task journal contract

- `TaskBinding` is host-owned project, session, turn, task and base-build identity.
- Starting an existing task never resets its draft or cancellation status.
- Draft revisions increase by one inside a transaction that also stores the tool receipt.
- A duplicate call with identical input returns its prior receipt. Reusing an ID with different content is rejected.
- A stale revision, foreign binding, invalid document or cancelled task leaves the current draft unchanged.
- Document size is bounded. SQLite uses full synchronous WAL transactions; file content is checked against the recorded hash.
- Formal world publication remains unavailable to model tools. W2 drafts use the session and lease protocol below; there is no model-accessible bypass that can publish an unverified draft.

## Session draft protocol

See ADR 0306. `workspace.open` binds an unbound PI session to its initial selected
world. Later calls and turns retain that binding despite panel changes. Host
project identity must match. One world has one draft writer at a time, enforced
by a SQLite transaction across service connections. A new turn copies the prior
draft into a new task with a `resumedFrom` reference, revokes the old writer and
rejects old turn IDs. Existing edited drafts with a changed formal build report
a conflict instead of being dropped.

`workspace.recordRead` persists the resource hash at a checked draft revision.
`workspace.commit` atomically stores a compiler-checked draft, immutable revision
and receipt, checking binding, current turn, lease, base build and revision.
`workspace.receipt` recovers a lost response using the exact original request;
different input with the same call ID is rejected. All identities come from the
host execution context. `workspace.endTurn` records a durable terminal marker,
including before any draft exists, and releases its lease. It does not delete
code. Progress and formal world code are unchanged by these operations.

## Plugin execution identity

The Rust `plugins.execute` notification includes its existing `sessionId`, `toolCallId`, and `executionId`, plus `turnId` from `ToolsExecuteParams`. Electron main, PluginRuntime, the plugin process, and `PluginToolExecContext` preserve these values. For Craftmine, main resolves `projectId` from the persisted session's project path (or its own session ID when projectless), hashes that identity, and requires the matching active turn with no finalization in progress. The public fields remain optional for compatibility; Craftmine draft tools reject missing identity and unknown authored identity fields. Execution IDs identify dispatch attempts; tool-call IDs remain the idempotency identity within the bound task.

The desktop awaits the private `lifecycle.turnEnded` call on turn finalization,
abort and active-session deletion. The built-in broker marks the turn ended
before awaiting Rust, so an in-flight asynchronous operation cannot submit a new
commit after that boundary even if persistence fails. Rust persists the terminal
marker and releases the lease. The call is not a panel or plugin API. Errors are
logged; draft data is retained for recovery. Abrupt process termination still
requires W3 recovery rather than claiming an acknowledged lifecycle event.

## Product service and world panel

`craftmine-core --data-dir <absolute path>` owns `tasks.sqlite` and accepts bounded JSON-lines requests on its private stdio pipe. Task and workspace methods are available to the trusted broker. The built-in `craftmine.world` plugin owns the service lifecycle. `runtime_info` reports draft tools as available and formal world publishing as unavailable.

The PI tool catalogue exposes `project_inspect`, `capabilities_read`,
`resource_read` and `workspace_patch` under the normal plugin namespace. Index
pages hold at most 32 resources; code and contract pages at most 16,000 Unicode
characters. A patch contains 1–8 additions/replacements and a checked revision.
Replacement requires a recorded read of the matching resource hash. The web
workspace and desktop broker share the same pure transformation and compiler,
including loaded extension versions and object scope validation. Desktop patches
also check immutable asset availability. Rust alone persists desktop changes.
This slice does not register a candidate-apply tool or execute authored code in
the privileged plugin process.

Electron resolves the domain executable and forwards `CRAFTMINE_CORE_BIN` only to the `craftmine.world` utility process. Other plugin processes keep the existing minimal environment; provider secrets, headless test tokens and unrelated host variables are never forwarded. Native acceptance must exercise the production utility-process spawner, because a test-only Node fork with a copied environment cannot verify this boundary.

The world view bundles trusted local resources into a sandboxed srcdoc iframe using script-hash CSP entries. The iframe exposes neither the plugin bridge nor Node. Blob Workers support the existing authored-code runtime. Message exchange requires the expected source window and a per-frame nonce. File-origin replies use a wildcard target only because the receiving document has an opaque origin; incoming validation remains mandatory.

## Desktop acceptance

The same Rust database now owns a `craftmine_worlds` table: world identity, title, revision, timestamp, compiled document, progress and content hash. The plugin's panel bridge can list worlds, create a compiler-checked empty world, open one and save validated gameplay progress. Saving progress cannot replace a build or extension catalogue. Revision and base-build checks reject stale views; integrity failures report an error without resetting the stored world. No JavaScript ProjectStore writes this desktop database.

The panel saves manually, every ten seconds while loaded, and before switching or creating another world. Switches freeze and flush the old runtime before writing progress. Restart restores the last selected world through plugin settings and re-reads its authoritative content from Rust. World switching replaces the sandboxed iframe and its nonce.

Before application quit, closing the world tab, or disabling/uninstalling its plugin, the trusted panel freezes gameplay and acknowledges an authoritative Rust save. The acknowledgement identifies the world, saved revision and build. A failure or 30-second deadline cancels shutdown and resumes the page, retaining progress for a retry. Overlapping saves and switches are serialized. The world view is excluded from opportunistic LRU eviction. A native close is not pre-authorized merely because the user chose Quit. See ADR 0302. Once the barrier succeeds and shutdown begins, renderer lifecycle notifications and late view creation stop so disposed views are not recreated. A save failure keeps the normal update path active. Candidate publishing, session-to-world binding and abrupt renderer/OS recovery remain W2/W3 work.

Native acceptance runs the actual Electron main, React renderer, sandboxed preloads, plugin utility processes and Rust services in an isolated, unfocusable offscreen mode. It validates contained profile/fixture paths and a parent IPC marker before normal startup, disables input and external/native UI actions, and uses a fixed parent-only command list. Real SQLite write contention must block close while retaining gameplay state; retry must save and exit, and a new Electron process must restore that state. Exit audits require zero input violations and unhandled page errors. Captures inspect the desktop and world separately. Physical double-click, visible desktop composition and installer acceptance are not implied. See ADR 0305.

## Read-only legacy import

The Import action obtains a directory through the existing native picker. Electron forwards only the granted directory to the built-in importer, replacing page-supplied paths. It accepts a legacy project root or its `.craftmine` directory. Rust captures every regular file and directory under a unique `legacy-imports/<id>/source` archive, synchronizes files, checks a second full source digest pass, and records a sealed manifest in SQLite. Capture never constructs a JavaScript ProjectStore on the original data, modifies it or resumes old tasks.

The compatibility compiler reads hash-checked original JSON text through `legacy.readText`. It preserves build identity for formats 2–4, full scene, progress, extension code and fixed asset versions; missing dependencies, invalid extension ABI, duplicate commands and asset/build hash mismatches reject import. Format 1 is verified using the original JSON property order, then its playable copy is upgraded to format 2 with a new canonical build ID. The original format-1 bytes and ID stay archived. Rust commits a new world and its archive provenance in one transaction. Replaying the same import does not reset later progress. Existing desktop worlds are retained. Historical modules, candidates and uncommitted task files remain complete in the archive; activation in the new creation UI is subsequent W2/W3 work.

Bounds are 256 MiB per archive, 64 MiB per file, 10,000 files plus directories and 32 nested directory levels. Symbolic links and Windows reparse points are rejected. The source cannot overlap the domain service profile. World documents allow 64 MiB for existing base64 asset packages; task documents retain their separate 2,000,000-byte limit. Private stdio requests allow 72 MiB. The product import operation has a 90-second broker deadline inside a 120-second panel-call timeout; directory selection itself remains outside this timed import. See ADR 0303.

Preserve project and session navigation, streaming conversations, cancellation, tool details, file and diff panels, model settings, themes and panel resizing. Add world and creation tabs, candidate preview and verification evidence using the same work-panel model. Provide Chinese defaults and an optional immersive play layout.

The first desktop slice adds a fixed World entry in the existing sidebar and opens it after bootstrap on a new profile with no retained session or resource tabs. A renderer-only `@craftmine/home` context lets it open, close and collapse without creating a conversation. Home and conversation panels retain separate resources when navigating; the home key is never an Agent or host session identity. See ADR 0304. The initial work-panel width is 560 pixels; persisted widths are honored. Below 520 pixels of composer space, complete toolbar groups wrap and permission labels stay on one line. The product mark and English/Chinese welcome copy identify Craftmine. The plugin world view consumes `app.getAppearance` and `appearance:changed`. Product paths, per-profile instance locks and disabled upstream updates follow ADR 0301. Immersive layout, creation-library and candidate panels remain subsequent slices.
