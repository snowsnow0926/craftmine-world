# Craftmine domain integration

This is a downstream product specification. See ADR 0300.

## Managed Godot source projects

ADR 0312 adds a source-only Godot file-set capability to the same Rust domain
database. It does not replace applied legacy worlds, scene drafts or progress.
`hello` reports `godotProjects: true` and `godotExecution: false`; a stored project
is neither a verified candidate nor a runnable/published base.

The trusted broker owns every identity passed to these private stdio methods:

| Method | Parameters in addition to host `context` and `worldId` | Result |
| --- | --- | --- |
| `godotProject.create` | `toolCallId`, current formal `baseBuild`, source `baseId`, `files: [{path,text}]` | Source receipt with world/task/call, revision 0, manifest hash and sizes |
| `godotProject.index` | Optional paired `revision`/`manifestHash`, `offset` (default 0), `limit` (1–32) | Project target, writer provenance, sorted file path/hash/size entries, total and next offset |
| `godotProject.read` | Required `revision`, `manifestHash`, `path`; character `offset` and `limit` (1–16,000) | Exact UTF-8 source page, file hash/size, total characters and next offset |
| `godotProject.patch` | `toolCallId`, current `revision`/`manifestHash`, `operations` | New source receipt; identical call replay returns the original result |

A put is `{op:"put",path,text,expectedHash}`; `null` is required for a new path,
and replacements use the previous file hash. A remove is
`{op:"remove",path,expectedHash}`. Empty/no-change changes and a missing final
`project.godot` are rejected. Invalid multi-file changes do not publish partially.
Unknown fields are refused. The private `godotProject.receipt` method takes the
original `binding`, `worldId`, `toolCallId`, `method` and complete original
parameter object as `request`; it can recover a committed receipt after the turn
ended without accepting a late edit. There is no model-facing binding/receipt tool.

World identity comes from the persisted session binding, not panel selection.
Writes use the existing task/turn and exclusive world lease, reject changed formal
base builds and check both the project revision and manifest hash. Reads can bind
to immutable historical revisions. A new session turn can continue the existing
world source head while an old turn loses write authority.

The fixed source target is Godot `4.7.2-stable`, GDScript, `gl_compatibility`, Web.
The `baseId` values `first-person`, `top-down`, `side-view` describe the authored
file set; they do not certify those gameplay bases as delivered. Every successful
mutation returns `status:"source-only"`, `verified:false`, `applied:false`.

Manifest metadata and immutable revisions/receipts live in `tasks.sqlite`; source
bytes are independent hash-addressed files scoped under the domain world's managed
directory. File data is synchronized/verified before committing references. A
failed transaction can leave an unreachable blob but cannot advance the visible
head; a retry verifies and reuses it. Corrupt or missing referenced files report an
error. No model-supplied read path is passed through to host filesystem APIs.

The core accepts 1–16 files per create/patch, at most 4 MiB per UTF-8 file and
8 MiB changed text, and at most 64 MiB/4,096 files per manifest. This is independent
of the legacy 2,000,000-byte scene-document limit. Historical/orphan blobs can
exceed 64 MiB; retained-storage quotas and garbage collection remain pending.
Physical world directories use SHA-256 of the case-sensitive world ID, preventing
Windows reserved-name and case aliasing. The broker's stricter public
request budget remains valid. Source paths are ASCII portable segments (240 bytes,
16 levels maximum), with Windows device names, ADS, absolute/traversal paths,
hidden/cache entries, case aliases and file/directory collisions rejected. The
allowed text extensions are `godot`, `gd`, `tscn`, `tres`, `gdshader`, `gdshaderinc`,
`json`, `cfg`, `txt`, `md`, `csv`, `svg`. Managed filesystem links/reparse points
are refused. Binary assets, runtime source validation, import/export, execution,
OS isolation, candidate application and Godot backup/library support remain
unavailable; legacy backups do not capture this new source authoring head.

PI tools `godot_project_create`, `godot_project_index`, `godot_file_read` and
`godot_project_patch` expose creation, index, read and patch through host context only; the
model never supplies world/session/project/turn/binding or call IDs. Index and
read hashes provide the observations needed to form a checked patch. Storage
success must never be reported as game behavior, model validation or deployment.
The Craftmine model context explicitly instructs the Agent to check `runtime_info`,
treat these tools as source storage and never describe legacy `verification_submit`
as building or verifying a Godot project.

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
Tool input is bounded to 180,000 UTF-8 bytes. Object/schema guidance matches the
current scene format and explicitly defines offsets as minimum corners, with
ground at y=6. It does not advertise appearance fields to a format-3 world.
Replacement requires a recorded read of the matching resource hash. The web
workspace and desktop broker share the same pure transformation and compiler,
including loaded extension versions and object scope validation. Desktop patches
also check immutable asset availability. Rust alone persists desktop changes.
This slice does not register a candidate-apply tool or execute authored code in
the privileged plugin process.

The Rust hello response advertises `sessionDrafts`; the runtime information tool
uses that actual capability instead of inferring support from registered tool
names. Successful turn termination removes the broker's temporary rejection
entry only after Rust acknowledges persistence; failed termination keeps the
entry and permits an acknowledged retry.

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

## Central world presentation

ADR 0311 supersedes the initial right-world layout while retaining the same
work-panel, session and native-view identities. The active Craftmine world occupies
the central flexible column, with a complete 400 px conversation on the right.
Conversation width is saved independently in the existing layout preference and
bounded to 360–640 px. Older preferences use the new default without losing mode
or existing resource widths. Create/play transitions preserve mounted world and
conversation instances. Non-world resources and settings retain PI presentation.

At 1100 px or below, the world workspace initially collapses the sidebar, with its
normal reopen action retained. At 760 px or below, world and conversation stack
without hiding the input. Native view bounds follow layout and size changes.
The layout never activates a window, enters OS fullscreen or requests input lock.

## Immutable desktop verification jobs

The PI `verification_submit` tool snapshots one exact session draft revision in Rust.
A durable receipt binds the host tool call to that input; altered replays, unchanged
worlds, stale revisions and a second active check of the same world are rejected.
The broker claims queued jobs with a private runner token. Rust owns the state
transitions and hashes both input and output. Tools and panels cannot submit
verification results or claim a job.

Edits, cancellation and a later session turn revoke pending checks transactionally.
Normal turn completion allows an already submitted check to finish. Service startup
marks unfinished jobs interrupted, preserving their inputs; it does not replay
model actions. Successful evidence must identify the compiled scene, extension set,
behavior artifacts and actual rendered build. A machine pass is not a published
world or a claim of player-request acceptance. Advisory model review, candidate
application and progress migration remain separate gates. See ADR 0307.

The built-in plugin exposes `verification_submit/read/cancel` to PI. Reads are
paginated to 16,000 Unicode characters and include a compact check overview. The
World work-panel tab retains the full PI shell and adds Check records, result
details and independent preview copies. Preview freezes and saves the formal
world first; it never writes preview progress back. Reviewed application is a
separate player action using the latest formal progress, as specified below.
World switches clear the old world's check list immediately.

The private `craftmine.verify` service is callable only by the built-in plugin
process. Each job uses an unfocusable offscreen BrowserWindow, ephemeral session,
no Node/bridge, denied permissions/navigation/network, and input guards installed
before authored runtime initialization. Two checks may run across worlds; each
world has at most one pending check. Native work has a 30-second deadline; Rust
expires lost worker/receipt states after 60 seconds. Cancellation destroys the
isolated renderer and its Workers. No path, source text or success claim from a
model is evaluated in Electron main.

The shared checker observes actual collision, color, items and resources. A loaded
message and nonempty screenshot are insufficient: the native service samples the
composited game frame to reject black canvases. This is a presentation check, not
semantic visual acceptance. ResizeObserver redraws after hidden-canvas resize.
Desktop syntax checking uses bundled @babel/parser 7.29.8 (license included), never
a subprocess using Electron's executable. The web compiler retains Node --check
and explicitly refuses an unprepared Electron runtime. See ADR 0308.

## Reviewed application transactions

The Rust review journal binds the host request and executor model to an immutable
verification result. A one-shot model response and its executable assertion plan
are sealed before test execution. Completed reviews preserve the exact response,
usage and assertion outcomes. The advisory verdict itself never prevents player
application; only machine gates may do so. See ADR 0309.

The private application API prepares one exact verified/reviewed build against
the latest world revision and progress. It excludes concurrent world/draft saves,
requires real native load/render evidence with the same player position, and
atomically commits the world, receipt and consumed draft. Preflight startup
effects are discarded, so formal activation does not replay preflight rewards.
Abort, startup and timeout retain the original world and draft. Only a consumed
draft may advance its next turn's base without an explicit conflict resolution.

The built-in broker now connects PI's one-shot model API, sealed review plans,
native event/mesh assertions and the preview Apply action. The host request and
model come from the actual session, not model tool arguments. Cancellation revokes
both the durable review and the active PI request. Input remains bounded; review
syntax errors retain the raw response and do not publish a success.

The trusted preview diagnostics expose observations and bounded data-only events
inside disposable game frames. The formal game rejects these messages. Assertions
read actual runtime and mesh state with no simulated OS input. The preview shows
the request, suggestions, unverified aspects and assertion outcomes; an advisory
block does not disable Apply when machine checks pass. A failed operation keeps
the old runtime paused until its authoritative receipt is resolved. See ADR 0310.

Native fixture-provider acceptance covers this complete protocol and actual game
execution. An opt-in real DeepSeek review through native PI configuration also
passes; its draft is still fixture-authored. Full Agent-generated creation remains
a separate requirement; a fixed response must never be labeled a real model result.
Reviews include authoritative ground/visibility semantics and distinguish module
fixture traces from renderer observations. Agent reads include bounded failed
assertions for repair. Receipt identity is checked on concurrent and durable
replays; late successful provider replies cannot override cancellation.


For a Godot mutation transport error without a structured domain error code, the
broker performs only an internal exact receipt lookup with the captured original
binding, call, method and parameters. This read can finish after the turn ended;
it neither reopens a lease nor repeats a mutation. Missing/unavailable receipts
preserve the original uncertain error. A dead core may be restarted for that
read, which still runs normal task recovery; a live timed-out core is not restarted.
The existing `craftmine.request/2` host snapshot marker is unchanged by the added
Godot instructions. Six actual broker/core integration tests include commit-then-
lost-response/ended-turn and missing-receipt fault injection. They do not certify
arbitrary network failures or a full native PI desktop lifecycle.
