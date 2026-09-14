# Experimental Codex CLI world backend

Settings → General → **World authoring backend** selects the default provider
backend or **Local Codex CLI (experimental)** and an absolute executable path.
The latter uses the actual local Codex app-server, with the existing local ChatGPT
login, exact `gpt-6-astra` and `xhigh`. It does not use the PI OpenAI provider
adapter. The existing backend remains the default. Changing the backend/path
requires idle turns; no saved API provider or credentials are modified.

The reached surface is the normal desktop world conversation, including the
conversation overlay in a Godot world. The normal prompt/abort/status IPC opens
the same Rust durable turn and binds the same selected world, project, source
and creation target as the provider backend. The composer identifies Codex and
its fixed model/effort, then displays the verified effective configuration after
the app-server handshake. Missing executable/login, unsupported CLI version,
different effective model/effort or tool catalog, foreign world binding, and
unexpected built-in tools fail visibly. There is no PI/model fallback.

This is a Godot **Agent-mode** authoring backend. Coding/Plan retain the provider
backend. A non-Godot world is rejected by this experimental adapter. Auxiliary
API-provider completions (prompt enhancement, generated titles, plugin side
completions/reviews) are unavailable with the Codex world binding and fail
explicitly. Manual PI compaction is unavailable; Codex manages its context.
Plain-text clarification uses the next ordinary conversation message. The
existing PI asktool card is not advertised to Codex.

## Execution and authority

`CodexDesktopRuntime` runs inside the existing packaged Node sidecar, using the
same restricted `codex-app-server.mjs` as the project CLI. Both unbundled TypeScript
build and packaged runtime bundle contain the module. No development absolute
path or project CLI world initialization is used in the desktop.

Electron selects only registered, project-scoped Craftmine tools from the finite
Godot/Blender authoring catalog. The direct `craftmine` namespace uses their short
names. Every call maps back to the registered full plugin name and reaches
`tools.execute`, including its declared risk, Rust permission evaluation and the
existing `plugins.execute` dispatcher. World/session/turn identity and receipt
IDs are host-derived. No generic Core RPC, shell, repository editing, filesystem,
external MCP, agent delegation, preview/adopt operator interface or user files
are exposed. Existing source revisions, leases, native broker sandbox and
candidate/application consent remain unchanged.

Current host context is rebuilt before the request; native source/task state is
authoritative. Thread/turn configuration disables environment access and all
built-in author tools. The subprocess inherits only OS/profile essentials so it
can reuse its own login. The host never reads/copies an auth file, resolves a
provider API key for this backend, logs account/config payloads or forwards raw
CLI stderr. Exact supported CLI: `codex-cli 0.154.0-alpha.6.2`.

## Transcript, usage and cancellation

Rust's existing session transcript remains the only visible conversation. The
existing SQLite `kv` namespace `codex-transport` holds a bounded opaque checkpoint:
thread ID, submitted/synchronized flags, tool digest, exact model/effort and last
reported cumulative usage. Electron adds hashes of the host world/project/source
binding and canonical transcript. Checkpoints contain no transcript or credentials
and are removed with the session. Private checkpoint RPC is not renderer IPC.
Rust rejects checkpoint writes for ended or foreign durable turns.

A synchronized checkpoint resumes the same Codex thread only when the Rust
transcript and world binding still match. An interrupted/unacknowledged transport
or edited/regenerated transcript is restored into a new **opaque transport thread**
from the canonical Rust history, including available image content. It creates no
new visible conversation/world and never replays source mutations. The status
distinguishes `resumed` from `restored-from-transcript`. A changed world binding or
tool catalog fails closed. A missing synchronized rollout also fails visibly.
Native interrupted-task resume/discard continues to require the existing player's
world recovery action; transport recovery cannot grant a native write lease.

An interruption may retain synchronization only when the actual user `turn/start`
was acknowledged before abort, no tool reply was pending when abort began or when
the tail settled, the exact CLI thread/turn reports `interrupted`, and the host
checkpoint save succeeds. The terminal acknowledgement can arrive while the
owned process closes; unrelated or post-retirement acknowledgements cannot revive
it. Missing acknowledgement, partial start, pending tools, failed native fence or
checkpoint save remain unsynchronized. This preserves native compaction already
performed in a cleanly interrupted CLI thread without weakening partial recovery.
Existing overwritten checkpoints are not reconstructed from external rollout files.

Full restoration uses the pinned CLI's `thread/inject_items` interface to append
ordinary historical-data messages without starting a model turn. Each canonical
record retains its PI session/message ID, timestamp, original role/status, tool
name/arguments and complete visible content. Serialized payloads are divided into
32,768 UTF-16-unit fragments without splitting surrogate pairs. Fragment headers
carry the original payload SHA-256 and ordered part/count. Up to eight text items
are sent per request; each real historical image is a separate `input_image`
item, never base64 text inside the historical JSON. These are request transport
bounds, not history truncation or model/token/whole-turn limits.

For history exceeding one 256 KiB textual hydration segment, insert every original
textual record in complete ordered segments and call CLI-native
`thread/compact/start` between segments, including after the last original-text
segment. No source text is cropped. Native summaries carry prior segments forward;
Rust's full visible transcript remains untouched. Finally anchor original player
requests and real historical images with their original message IDs. An unusually
large anchor set also uses native segmented maintenance instead of a silent cut.

Maintenance has a distinct native turn identity. Await the compact RPC ack, a
matching completed `contextCompaction` item and successful matching terminal turn
before adding the next segment. Maintenance completion cannot finish the enclosing
player request, execute domain tools or substitute another model. Actual native
maintenance usage belongs to the enclosing PI request; no total-history,
compaction-count, token or time budget is imposed. A segment is not a guarantee of
provider acceptance: preserve actual native refusal/error evidence.
Cancel captures the current native maintenance turn ID before rejecting its local
waiter, then sends ordinary `turn/interrupt` for that ID before closing the owned
transport. A maintenance interruption never establishes a synchronized checkpoint.

The adapter awaits each injection acknowledgement and checks the active native
turn before and after it. There is no invented idempotency: failed/uncertain or
aborted injection leaves the checkpoint unsynchronized; the next ordinary retry
starts a new opaque thread from the full canonical transcript. It neither
continues a partially injected thread nor executes synthetic historical tools.
After complete history hydration and maintenance, it refreshes host facts and sends one
ordinary `turn/start` with those facts, the current player request/images and an
explicit recovery notice. Historical results are not proof of the current source,
build, gameplay or acceptance. Codex retains its own normal context management.
An injection refusal stays visible with its protocol diagnostic, with no fallback
to an oversized prompt or automatic history trimming.

Validation includes a source-shaped historical tool result above 1 Mi characters,
exact reconstructed payloads and hashes, original player wording, image blocks,
no historical tools, one actual player `turn/start`, interrupted injection and rejection. The
original player's 207-message transcript was also projected read-only: all
2,159,106 payload characters reconstructed exactly, with four image blocks and no
base64 text. This is transport projection evidence, not a successful live model
restoration or packaged acceptance; the coordinator runs that through normal UI.

Text, tools and terminal messages use the current agent event contract. Codex's
cumulative thread usage is converted to **current-turn deltas**, streamed in
`AgentStatus.transportUsage` and attached once to the final assistant message.
Absent/reset counters stay unknown; cost is `null` and displayed as unavailable.
Cache-read/write input is removed from the desktop's uncached-input count. The
context inspector uses separately recorded `codexUsage.lastRequest` and the
CLI-reported model context window; it never treats an aggregate turn total as
prompt occupancy or substitutes a generic provider window when they are absent.
Internal model-request count and generation-only timing are not inferred from
one app-server turn; the existing request-level metrics panel may have unknown
coverage for Codex. No invented PI model-call records, cost, throughput or native
budget settlements are produced. This backend adds no model/token/turn budget.

Native maintenance usage has incomplete coverage in the verified CLI notification
contract. Actual compaction writes separate native usage records, but the consumed
`thread/tokenUsage/updated` stream resets its total counters to zero afterward and
may expose context occupancy as an otherwise-zero `last` total. These resets are
not model consumption, must not display zero usage and never become a zero
checkpoint baseline. Do not silently import private rollout counters into product
events or call account-wide APIs to fill the gap.

When maintenance occurred, omit generic `message.usage` and `status.transportUsage`
as complete totals. Persist `message.codexUsage.coverage`, and expose the same
`status.codexUsageCoverage`, with `status: incomplete`, reason
`native-maintenance-usage-unreported`, completed `maintenanceTurns`, observed
`maintenanceElapsedMs` (null if timing is unavailable), and optional
`reportedCreationUsage`. The latter contains only subsequently reported creation
counters, never a complete operation total. These optional fields survive Rust's
canonical transcript roundtrip. UI and exports show total usage as unknown,
explicitly label creation counters/maintenance absence, and preserve the coverage.
Known valid post-reset creation counters may seed later-turn deltas; unreported
maintenance is never reclassified as zero. No cost is inferred.

Legacy persisted context-capacity markers (all-zero components, total equal to
model window) are filtered in the metrics/context UI as a read-only projection.
The original SQLite/transcript record remains unchanged. Existing no-maintenance
turns with consistent reported usage retain their ordinary behavior.

Cancellation first revokes local dispatch and native turn authority, cancels
owned permission/tool waiters, interrupts/closes the CLI and drains outstanding
work. Late tool requests fail. The native fence must succeed before cancellation
can be reported; failure remains an error/recoverable native task. Parent-process
closure also closes owned Codex children. Ordinary world save/cold-reopen remains
owned by the existing desktop Godot host; model completion is not application or
gameplay evidence.

PNG/JPEG attachments are prepared by the existing host attachment boundary and
sent as actual app-server `image` input data. The raw user prompt and attachment
references remain in Rust's ordinary transcript. Other files, missing bytes and
non-inline/oversized images fail with an explicit unsupported-image diagnostic;
the agent is never asked to open their paths. Tool-returned Godot PNGs are actual
`inputImage` result blocks, not textual timestamp substitutions or model renders.

## Build and isolated validation

```powershell
node desktop/build-world-plugin.mjs --output vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world
pnpm -C vendor/pi-desktop --filter '@pi-desktop/desktop^...' build
cargo build --release --manifest-path vendor/pi-desktop/Cargo.toml -p host-core
pnpm -C vendor/pi-desktop --filter @pi-desktop/agent-runtime bundle
pnpm -C vendor/pi-desktop --filter @pi-desktop/desktop build

pnpm -C vendor/pi-desktop --filter @pi-desktop/agent-runtime exec vitest run src/codex-desktop-runtime.test.ts
node --test tests/codex-checkpoint-host.test.mjs tests/codex-world-author.test.mjs tests/codex-input-images.test.mjs
cargo test --manifest-path vendor/pi-desktop/Cargo.toml -p host-core codex

node tests/codex-desktop-native.mjs --live --codex C:/absolute/path/codex.exe --runtime-resources D:/absolute/development/runtime/resources
```

New native runs create a fresh `test-results/desktop-native-codex-*` profile,
launch the actual desktop offscreen, select the normal Godot world
entry through its fixed page handler and uses ordinary renderer prompt IPC.
Without `--live` it tests native creation, missing-CLI failure and save with no
model call. With `--live`, tree and flower requests use the real local CLI and a
cold desktop restart between them. Its output contains the exact profile and
cancel-file path; SIGINT or that file invokes ordinary Abort. All native window,
input and profile guards remain active. No OS input, focus, Pointer Lock,
Playwright input or `sendInputEvent` is used.

For a driver failure after a completed tree request, `--resume-test` accepts only
this driver's own report under that marked fixture directory, preserves the
original report and continues flowers in a new continuation report. It cannot
accept a standalone author CLI/content profile or a different worktree. On cold
reopen it selects the existing conversation from ordinary session history and
waits for the actual formal runtime before taking an identity-bound capture.

For development components only, `CRAFTMINE_RUNTIME_RESOURCES` can name an
absolute directory containing `godot` and `blender`; packaged releases always
use their packaged resources. `CRAFTMINE_GODOT_BASES`, `CRAFTMINE_CORE_BIN` and
`PI_DESKTOP_HOST_BIN` retain their existing development roles. This is not an
installed/sealed full-client claim. The prepared local component set can be used
read-only. Normal product selection requires no environment variables beyond
the existing development component wiring.

## Recorded validation, 2026-09-13

Player onboarding is extended in [Codex player connection](codex-player-connection.md).
It retains this backend and its authoring protocol, adding the existing Settings
row's path, login and actual account/model capability checks.

The actual desktop fixture `test-results/desktop-native-codex-vlwaPc` used no API
provider rows and the existing local Codex login. Session
`ee1cd78a-1900-43e3-9609-f33f7c0a9be9` stayed in world `world-d2cac5cc93f8`.
The original tree request completed through registered creation tools. After a
cold desktop restart, the flower request resumed the exact transport thread,
received the actual tree PNG as an image attachment, generated assets with the
native Blender broker, patched source, checked and automatically applied through
the normal product consent path. Both formal PNGs were inspected; they show
trees, then the same trees with flower/grass patches. This is backend/component
evidence, not acceptance of the coordinator's promotional content profiles or
human gameplay feel.

The flower candidate is
`gcan-ad5c1fe1df6076c263cb3cfaa7920ece59959a6065bf7f2dda6542841c9e9c45`;
its applied/reopened build is
`gbd-74cbbed82b3f2a78940d01b0cf22ed720e5ac827eb3585f32b5fdee95a7af8d0`.
Final passing report:
`test-results/desktop-native-codex-vlwaPc/continuation-df59683c-28da-4d65-b132-274a498fa754.json`.
It references the earlier raw request/event reports rather than overwriting them.
The ordinary world-view Save returned a native progress receipt, revision 3;
the reopened formal capture remained on that flower build. All final launch
audits recorded empty input/focus, page-error and shutdown-failure lists.

`settings-busy.json` in the same fixture records an actual refused attempt to
switch backend during the live resumed flower turn: `AGENT_BUSY`; the effective
backend/model/effort remained Codex/gpt-6-astra/xhigh. Turn-total usage was
1,300,629 tokens for trees and 3,187,857 for flowers, including cache hits; these
are separate turn deltas, not a running thread total or a price estimate.

Earlier failures remain recorded: an omitted CLI cache-write counter initially
rejected checkpoint persistence; the fixed usage schema is tested in TypeScript
and Rust. Driver corrections follow the current world chooser, select ordinary
session history, wait for a formal instance, use bound capture in the immersive
view, and send Save through the world view's authorized channel. The final driver
supports completing such an already-authored fixture without repeating model
requests. Last-request context metadata is separately tested through Rust's
canonical transcript serializer; old messages without that metadata show no
fabricated context-window estimate.
# Failed transport diagnostics

Asynchronous `error` notifications and failed `turn/completed.error` now retain
their selected, bounded sanitized message/additionalDetails and recognized native
error classification in both terminal message and error-event details. Thread and
turn identities must match. A retryable native notification alone never terminates
the turn. Unknown error objects, raw provider fields and credentials are omitted.

Usage totals must satisfy `inputTokens + outputTokens === totalTokens` before
being displayed, persisted as a new transport baseline or converted into turn
usage. A real context-full marker with zero input/output and total equal to the
model context window is recorded only as `usageSignal.notTokenUsage`, never as
consumption or cost. Previously persisted error/usage records remain immutable;
this validation applies to new events and rejects invalid historical baselines.

The adapter preserves its existing terminal code and adds selected observations
to the existing `error.details`: a fixed host stage, and for a recognized RPC
failure only, its request method, integer code and bounded redacted message.
Stages distinguish context/checkpoint/binary/app-server setup, thread start or
resume, transcript restoration, checkpoint save and turn start. Request methods
are selected from initialize, config/read, account/read, thread/start,
thread/resume and turn/start; no request arguments or arbitrary error fields are
projected. The message retains at most 1,024 Unicode characters plus an explicit
truncation marker. Tokens, common credential assignments, local paths, URLs and
email addresses are redacted before persistence. Raw stderr remains discarded.

This is diagnosis, not a recovery policy change. Interrupted or divergent
checkpoints still restore the canonical transcript in a new CLI thread; valid
synchronized checkpoints still resume. No automatic retries, history truncation,
model fallback, token limits or model-call limits are introduced. A successful
connection check proves setup, not that a later turn-start request succeeds.
Old generic errors cannot be retrospectively reconstructed or rewritten.

Regression tests use fixture protocol failures and assert the actual emitted
details, original terminal code, one turn/start, exact Astra/xhigh selection,
unsynchronized failure checkpoint and normal process cleanup. Native E2E requires
a separately labeled ordinary recovery attempt in the original isolated profile;
source-mode diagnosis is not final packaged acceptance. Inspect the persisted
error details before inferring account quota, context limits or world errors.
