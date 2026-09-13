# Private Codex live-world host and image inputs

This extends the [project author CLI](codex-project-author.md) without replacing
the desktop composer or changing the `craftmine` dynamic-tool catalog. All
commands are explicit operator actions. Model tools cannot initialize an
application, choose another world, select local files, or invoke private IPC.

The [private gameplay input surface](codex-gameplay-verification.md) additionally
lets operators exercise physical keys/buttons/motion through normal Godot input,
with finite waits, real evidence and release on cancellation. It is not an author
tool and does not rewrite source or assign gameplay success.

## Normal initialization and operator commands

Use a new independent directory for component validation. The configured runtime
must contain the current Core and pinned native toolchains; the prepared
`test-results/codex-promo/runtime` is a development component set, not a sealed
full client. The existing sealed runtime remains read-only.

```powershell
node desktop/build-world-plugin.mjs --output test-results/codex-live-plugin
$runtime = 'D:/Craftmine Worktrees/codex-promo-20260913/test-results/codex-promo/runtime'
$plugin = 'D:/Craftmine Worktrees/codex-promo-20260913/test-results/codex-live-plugin'
$data = 'D:/Craftmine Worktrees/codex-promo-20260913/test-results/my-live-world'

node scripts/codex-world-author.mjs init --data $data --runtime $runtime --plugin $plugin --world my-live-world
node scripts/codex-live-world.mjs initialize --data $data
node scripts/codex-live-world.mjs capture --data $data
node scripts/codex-live-world.mjs save --data $data
node scripts/codex-live-world.mjs reopen --data $data
```

`init` retains its source-only meaning. `initialize` performs the current source's
ordinary native check through `createGodotExecutor` and `GodotBuildVerifier`, then
passes its real checked candidate to `createGodotCandidateCoordinator.firstLoad`.
The product coordinator prepares the native application, obtains a Core-issued
candidate descriptor, starts/restores a real Godot view, confirms the exact
runner snapshot, advances the existing content operation, commits the application
and promotes the candidate. There is no authored executor registration, injected
job success, fabricated launch receipt or competing application store.
An already confirmed `initialize` reopens the formal world without checking or
applying again.

For later source edits, the author can produce the checked candidate, or the
operator can explicitly check the current source:

```powershell
node scripts/codex-live-world.mjs check --data $data
node scripts/codex-live-world.mjs preview --data $data --candidate <gcan-ID-from-passing-check>
node scripts/codex-live-world.mjs apply --data $data --candidate <same-gcan-ID>
```

`preview` uses the ordinary product checkpoint/prepare/stage flow, captures the
candidate with its actual candidate identity, then aborts the preview on departure.
It does not adopt its code or preview progress. `apply` reopens the formal world,
creates a fresh preview if necessary, and uses the product candidate-apply flow.
Native source/lease/progress checks remain authoritative. For a world without a
formal application, `apply` uses the real first-load path. That first-load path
is distinct from an ordinary preview of an already applied world.

An initial launch failure is not silently cleared. `retry-first-load --candidate
<candidate-ID-in-launchFailure>` invokes the existing native retry receipt; a
subsequent explicit `apply` retries a checked candidate. `status` reports native
initialization, formal/candidate instance identity, and view state. The output
distinguishes applied durable content, a running instance, check results and
candidate captures. It never claims broad gameplay correctness.

Every operator command holds the same profile lock as authoring, starts its own
hidden Electron helper, and saves/closes before completion. Thus `reopen` is a
real cold process reopen, not a reused view. Successful operator output
includes a `retirement` receipt; `result` describes what was observed while the
instance was running. `status` does not open a formal view. Native save failure leaves the
instance alive for retry through the service API. If a one-shot process must exit
after an unrecoverable cleanup failure, it reports error and retains the actual
unpersisted runtime snapshot as a diagnostic artifact; that artifact is explicitly
not a Core save receipt. A confirmed native application is never undone by a
caller cancelling its post-commit capture. SIGINT cancels checks and initial
staging; an ordinary application already committing settles through the product
coordinator and reports the actual result with `operatorInterrupted`.

## Live authoring services

```powershell
$codex = 'C:/Users/WINDOWS/AppData/Local/OpenAI/Codex/bin/bffc5354119c8421/codex.exe'
node scripts/codex-world-author.mjs turn --data $data --codex $codex --live-host true --prompt '我希望地上有花草'
```

The same flag works with `scripts/promo-world-author.mjs`: its existing verifier
remains attached, while the live host adds actual formal-world readers. No edit
to the coordinator-owned wrapper/services is required. `--services` can still
provide other trusted services. Shutdown now drains those services while their
shared CoreClient is still available for ordinary saves.

`scripts/lib/codex-live-service.mjs` also exports `createServices({core,state,data})`
for composition and `startCodexLiveService` for explicit operator orchestration.
Its helper runs `GodotWorldViewHost`, `createGodotRuntimeAdapter`, the candidate
coordinator, and the existing live/OS performance samplers. Durable calls travel
over private parent-child IPC back to the already-owned CoreClient. The proxy
admits only the product runtime/application/content methods and the bound world;
it cannot register executors, finish jobs, edit source or invoke a shell. The page
retains the existing sandboxed, instance-scoped Godot preload. No generic Core
RPC is exposed to the model or page.

`godot_runtime_state` and project facts receive a fresh `observe-envelope` from
the actual formal instance, retaining both game `sampledAt` and host receipt
time. `godot_view_capture` reads the actual already-attached world view through
the product capture implementation and checks native turn identity before and
after capture. A visible candidate cannot masquerade as a formal capture. PNGs
are actual image blocks to Codex, with the exact receipt/hash. No check screenshot,
saved snapshot or timestamp substitutes for a live observation. OS memory comes
from the actual renderer process; engine-specific timing remains unwired.

The helper uses the existing headless profile guard, a new independent Electron
profile, hidden nonfocusable offscreen windows, permission denial and the
pre-script Pointer Lock guard. It never sends OS input or controls a user browser.
Its finite private `walk` call is an existing base physics command used by native
component tests, not an author tool or generic page evaluator.

An unexpected helper exit retains its exit code, pending operation names and
bounded sanitized diagnostics under the isolated helper directory. Operator
errors are recorded before retirement so a later cleanup error cannot erase the
original failure evidence. An exit is not an application receipt: inspect the
native formal build before retrying an uncertain adoption. The transport-exit
test uses a real hidden helper and a deliberately stalled stub Core; it is not
gameplay or application evidence.

The independent candidate verifier retains teardown console errors and the
actual exit/dispose failure in its bounded diagnostics. These records never
turn a failed recovery assertion into a pass. The promotional capture observer
retains a native bitmap and encodes its final PNG once after verification; it
does not compress every animated paint. A passive page error listener records
the engine stack without modifying the authored scene or injecting input.

## Explicit reference and feedback images

The project CLI's author service pauses the formal scene after opening it,
matching the normal desktop conversation overlay. Source tools and actual
captures remain available, while combat and other simulation do not advance
through a long model turn. The separate operator gameplay/open commands retain
their ordinary running behavior.

Gameplay cancellation metadata is published before opening the native view.
Cancelling during startup abandons only the owned helper before any gameplay
input, preserves the last durable snapshot, and records `abandoned-before-input`
instead of a fabricated save receipt. Cancellation during gameplay still
releases held inputs and follows the normal save/close flow. Reports exist even
when cancellation occurs before a helper directory is available.

```powershell
node scripts/promo-world-author.mjs turn --data $data --codex $codex --live-host true --prompt '请参考这两张图制作模型' --image 'D:/references/front.png' --image 'D:/references/side.jpg'
```

Repeat `--image` for explicit absolute PNG/JPEG files. The host rejects links,
non-image extensions and mismatched image signatures, copies the selected bytes
into a hash-addressed input archive, and records original path, stored path,
MIME type, SHA-256, byte size and import time beside the unchanged raw prompt.
Modified archive bytes are refused. The model receives actual app-server
`{type:"image",url:"data:image/...;base64,..."}` items, not filenames or a shell
request. These are operator-provided references/feedback, not model-generated
render evidence. The loader does not read Codex credentials. Existing exact
`gpt-6-astra`/`xhigh` and no added model budgets remain unchanged.

## Validation and limits

```powershell
node --test tests/codex-world-author.test.mjs tests/codex-input-images.test.mjs tests/codex-live-service.test.mjs
node tests/codex-live-typecheck.mjs
node tests/codex-live-native.mjs $runtime $plugin 'D:/Craftmine Worktrees/codex-promo-20260913/test-results/new-live-native-test'
```

The protocol/image tests are offline. The native suite performs actual native
check/first-load/application, captures a real PNG, exercises the existing physics
walk command, saves the changed player position, and confirms complete snapshot
equality after a full process restart. It then checks a second real source
revision, previews without adoption, applies through the existing coordinator,
and cold-reopens again with the same progress/source. An injected save transport
failure verifies refusal and retry; it does not fabricate success. Foreign-world,
stale-instance and ended-turn captures are refused, and actual runtime guards
show zero Pointer Lock/focus calls. No model calls or live player input are used.

The reached surface is an applied, persistent headless project world. Desktop
composer integration, player target selection, automatic adoption, and acceptance
of pet/combat/rain/aircraft/city gameplay remain separate. The live host neither
rewrites those wishes nor proves them from a frame or a successful application.
