# Godot GD0 integration

This directory pins Godot 4.7.2 stable for Windows x64, exports fixed authored
3D/2D projects, and supplies a preview transport. It is not the product Agent's
project-authoring API. The AppContainer prototype has not passed its runtime gate.

## Reproduce the verified Web candidate

```powershell
powershell -NoProfile -File desktop/godot/prepare-toolchain.ps1 -WithExportTemplates
pnpm --dir vendor/pi-desktop build:js
node tests/godot-headless.mjs
node tests/godot-web-transport.mjs
node tests/godot-web.mjs
```

Use an existing verified cache from a dedicated worktree:

```powershell
$env:CRAFTMINE_GODOT_CACHE_DIR = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable'
```

Preparation pins archive byte counts and SHA-256, compares unpacked files with
verified archive entries, checks license bytes, and extracts only the selected
Web templates from the all-platform archive. Runtime preparation independently
checks the pinned executable and selected template hashes. The archive is a
build cache, not an application distribution asset.

`export-probes.mjs` exports only the repository's two trusted fixture projects.
A changed 3D variant modifies actual GDScript damage from 12 to 7 and is rebuilt
by the real engine. Output manifests cover exported files and license notices.
Multithreaded Web is the current candidate. Set `CRAFTMINE_GODOT_WEB_THREADS=0`
only to reproduce the retained single-threaded exit failure; it is not a silent
fallback. See [the decision record](../../docs/GODOT_INTEGRATION_DECISION.md).

The shared runner copies the engine into each test directory, supplies only a
minimal Windows environment, creates separate editor/profile/temp directories,
and always passes `--headless` with hidden process creation. Import/version runs
have a 60-second limit, exports 120 seconds, and captured output is bounded.
Directories and environment separation are not an OS sandbox.

## Preview contract and persistence

`web/host.mjs` connects an already-loaded HTTP(S) iframe on a separate origin with
a transferred MessagePort. World/build/session identities bind a handle; requests
have bounded size, concurrency and deadlines. Malformed responses settle with an
error, diagnostics retain at most 32 entries, and dispose/exit rejects pending
requests. Neither side receives a desktop filesystem or publishing capability.
Runtime-reported state remains untrusted data, not authorization or proof of a
valid application transaction.

`web/bridge.js` registers the Godot callback and drains accepted actions before
requesting engine shutdown. The authored GDScript adapter executes actual scene
methods, partitions `user://` by a hash of worldId, and validates saved identity
and format. Both scenes validate every restored field before applying state.
A save response confirms the FileAccess write; the test then waits for graceful
engine exit and proves persistence across a complete independent browser restart.
It does not claim that this response alone guarantees an IndexedDB durable commit.

Tests intentionally reuse an origin for two trusted instances to verify storage
namespacing. This is not malicious-project isolation: production must additionally
use stable, separate per-world browser storage/origins and host-managed progress.
Stable origins across application launches, failure recovery, quota handling and
Rust application transactions remain GD2 work.

The Web test embeds the real exported game beside actual React desktop components.
Session data and the native view transport are fixtures; this is not native
Electron/Godot integration. It checks rendered pixels, real physics, equipment,
rebuilds, corrupted-state rejection, same-base world independence and concurrent
save/exit. It waits for both layout bounds and the actual drawn viewport before
capturing a returned creation view. Browsers use independent profiles, headless
SwiftShader, blocked focus/Pointer Lock, and no mouse/keyboard simulation. These
samples do not establish hardware GPU performance or player feel.

## Execution boundary

[sandbox/README.md](sandbox/README.md) describes the separate, fail-closed
AppContainer feasibility experiment. Compilation succeeds; the native child
exits before main with 0xC0000142. No Godot process passed through it. Arbitrary
model projects, editor tools, importers, addons and native extensions must not be
routed through the trusted probe runner or this unverified sandbox.

Godot MIT and third-party notices are retained in `licenses/` and copied into Web
exports. Client/standalone packaging must handle those notices, existing PI LGPL
obligations and all other assets separately; no new distribution was built here.

Primary sources: [official release](https://github.com/godotengine/godot-builds/releases/tag/4.7.2-stable),
[Web export](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html),
[Web shell](https://docs.godotengine.org/en/4.7/tutorials/platform/web/customizing_html5_shell.html),
[JavaScriptBridge](https://docs.godotengine.org/en/4.7/classes/class_javascriptbridge.html).
