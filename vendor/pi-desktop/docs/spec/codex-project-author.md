# Codex project author CLI

The repository root exposes `npm run author:codex -- ...` (or the equivalent
`node scripts/codex-world-author.mjs ...`). This is a project authoring surface;
the desktop composer remains on its existing PI runtime. See the
[architecture decision](../adr/codex-project-author.md).

## Host setup and first two requests

Run from this request worktree. All paths below are trusted caller configuration,
never model arguments. Use a **new, independent** data directory. The sealed
runtime is read-only. Build the current plugin because the sealed release's
plugin can predate current continuation behavior.

```powershell
node desktop/build-world-plugin.mjs --output desktop/build/codex-author-plugin

$runtime = 'D:/Craftmine Worktrees/blender-integration-20260913/desktop/build/releases/04b18aafc8fd-d56bef63-9bd7-4685-9e81-5f6ef5f611f4/output/win-unpacked'
$plugin = 'D:/Craftmine Worktrees/codex-promo-20260913/desktop/build/codex-author-plugin'
$data = 'D:/Craftmine Worktrees/codex-promo-20260913/test-results/promo-author'
$codex = 'C:/Users/WINDOWS/AppData/Local/OpenAI/Codex/bin/bffc5354119c8421/codex.exe'

node scripts/codex-world-author.mjs init --data $data --runtime $runtime --plugin $plugin --world promo-author-world
node scripts/codex-world-author.mjs doctor --data $data --codex $codex
node scripts/codex-world-author.mjs turn --data $data --codex $codex --prompt '我想生成一些树'
node scripts/codex-world-author.mjs turn --data $data --codex $codex --prompt '我希望地上有花草'
```

`init` materializes the shipped blank `creation-sandbox`, initializes the real
Rust world, imports source through `godotProject.create/applyFiles`, migrates to
the existing Git source backend, and closes the bootstrap turn. Its receipt says
`applied:false` and `playableVerified:false`. It never creates a fake initial
application. Partial failed initialization remains in its directory for diagnosis;
the CLI refuses to overwrite an existing directory.

`doctor` starts the native broker preflights and an ephemeral, no-model Codex
thread. It validates the exact model/effort/isolation contract and shows actual
capabilities. Default `godot.checkAvailable` is false because no verifier is wired.
Successful `doctor` is not evidence of a successful model request or playable world.

`turn` streams JSONL to stdout and appends `events.jsonl`. `session.json` retains
model, effort, native paths, world/project/session identity, source repository
identity, tool-catalog digest, Codex thread ID and unfinished native turn. The
native Core owns source, task history, drafts, requirements, receipts and jobs;
Codex owns its rollout. The host never substitutes a history summary for resume.
World, runtime and plugin flags are accepted only by `init`; continuation rejects
them instead of silently ignoring a caller's attempted identity change.

The normal CLI waits for real turn completion without a new model/time budget.
The existing per-tool validation and native job constraints still apply. A
question in the assistant response is answered with another `turn` command in
the same data directory; there is no automatic choice of a clarification option.

## Cancellation, continuation and diagnostics

```powershell
node scripts/codex-world-author.mjs status --data $data
node scripts/codex-world-author.mjs cancel --data $data
```

`cancel` records a request for the exact active host turn. Its immediate
`cancellation-requested` result is not completion: wait for the running entry's
`turn-end` with `aborted` after the Rust fence and active-tool drain. SIGINT and
SIGTERM use the same lifecycle. No window is activated and no keyboard event is
sent to a native app. A second author process is refused by the data-root lock;
a dead process lock can be reclaimed. Crash recovery fences the recorded old
turn and uses fresh native identity, without replaying the old prompt or tools.

Events distinguish `user`, `session`, `status`, `text` deltas, complete `message`,
`tool-start`, `tool-result`, `tool-error`, `tool-rejected`, `usage`, `diagnostic`,
`recovered`, and `turn-end`. Completed model turns do not mean completed gameplay.
Native result states remain intact. Usage is the actual app-server token object
with thread-cumulative and last-request scope; unavailable cost is `null`, not an
estimate or a fabricated native budget settlement. `elapsedMs` is measured from
host-turn start through native end/drain. Consumers should display either text
deltas or final messages without duplicating both as separate answers.

Model, provider, world/source identity, tool catalog, unexpected instruction
sources, custom endpoint, unsupported CLI version, missing login and unavailable
rollout failures stop authoring visibly. There is no PI fallback. Tool calls are
serialized and replayed by call ID/digest without repeating source writes. A
mismatched replay is rejected. Other threads, turns, namespaces and unknown tools
never reach a world broker. Generic app-server server requests are denied.

## Existing verification services

`--services ABSOLUTE_MODULE_PATH` is optional trusted host integration. It exports
`async createServices({core, state, data})` and returns `{verifier, toolServices, stop?}`
using the existing `createGodotExecutor` verifier and `createWorldTools` service
contracts. `core` is the same native client used by the tools/executor; state is a
copy of the trusted session binding. Optional `stop()` drains its owned resources
when the entry exits. The module is loaded only by the caller,
not selected or authored by the model. It must use independent headless data,
disable Pointer Lock at initialization, and use page scripts/HTTP/native brokers
for checks. Never expose shell, OS input or arbitrary file access through it.

Without these services, missing target capture, view capture, check and adoption
remain explicit gaps. With them, a real PNG returned by the existing view-capture
broker is sent as a Codex image content item. Pixel receipt and source imports
still do not prove gameplay or application. Native adoption requires the existing
candidate/application/first-load boundaries; the CLI exposes no model apply RPC.

## Targeted validation

A source-only world's first check may pass before its first application. The
ordinary build-read tool preserves that passing candidate when formal runtime
lookup returns exactly `GODOT_WORLD_NOT_INITIALIZED`; it does not claim adoption.
Other runtime errors, mismatched receipts and world switches still reject.
`tests/godot-build-source-only.test.mjs` covers this boundary, and
`tests/promo-godot-check-native.mjs` exercises the real broker and product verifier.

```powershell
node --test tests/codex-world-author.test.mjs tests/blender-tools.test.mjs tests/blender-jobs.test.mjs
node tests/codex-world-native.mjs --data 'D:/Craftmine Worktrees/codex-promo-20260913/test-results/codex-native-check' --runtime $runtime --plugin $plugin
```

The unit suite uses a fake app-server subprocess and controlled domain services;
it does not invoke a model. The native suite uses actual Rust source transactions,
completion, cancellation, restart recovery and world-binding refusal, with no
model, browser or input. Real Codex authoring is a separate live validation, using
the original tree/flower requests above and exact `gpt-6-astra`/`xhigh`. Preserve
failed attempts and their honest usage; they are not successful player acceptance.

## Recorded implementation validation (2026-09-13)

The offline protocol suite passed 15 tests, and the existing Blender tool/job
suites passed 30 tests. Real Rust validation passed in `test-results/cn5`, including
source writes, completed-turn continuation, late-write rejection, restart recovery
and foreign-world refusal. No browser or OS input was used.

The real `我想生成一些树` call in `test-results/cl2` used exact
`gpt-6-astra`/`xhigh`, completed Blender import and scene edits, and passed a native
Godot build. Its subsequent check failed with no verifier attached. The final
assistant response correctly stated that the result was not applied. This is
source/build integration evidence, not visual or playable acceptance. The JSONL
record is `test-results/cl2/live-tree.jsonl`; measured host-turn time was 363087 ms.
The last app-server cumulative usage object reported 1107351 input tokens,
1015040 cached input tokens, 8391 output tokens and 1115742 total tokens. These
are cumulative across the turn's repeated requests, not unique context size;
cost remains unknown.

A real no-model `thread/resume` after process shutdown retained thread
`01a0981a-33f4-73b0-ac00-54da2eb9ba03`, its completed turn and 28 recorded dynamic
tool calls, world `codex-live-direct`, and repository `world-codex-live-direct`.
The coordinator can continue flowers by using the same `test-results/cl2` data
directory. This implementation validation did not submit the flower request.

An earlier real attempt in `test-results/cl1` failed because flat dynamic tools
were wrapped in the disabled code-mode executor. It made no world-source change
and remains a failed record. The final namespace/direct-only configuration was
validated by the subsequent real calls above; no PI or substitute model was used.
