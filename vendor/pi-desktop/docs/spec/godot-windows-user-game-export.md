# Fixed Windows user-game export

This slice adds the private broker operation `exportWindows`. It is distinct
from the Craftmine desktop installer, a component ZIP, a backup and Web preview.
There is no renderer command, new model permission or arbitrary native launch.

The request uses the existing broker schema, source binding and private channel.
The source must contain exactly `desktop/godot/sandbox/windows-export.cfg` as
`export_presets.cfg`. The broker compares bytes in its isolated copied source
after checking the copied snapshot digest. Windows export selects only the
pinned 4.7.2 editor, version marker and Windows release x86_64 template. It runs
the fixed arguments `--headless --path <task-project> --export-release
"Windows Desktop" <task-export>/game.exe` under the existing LPAC, Job,
network preflight, budget and cleanup checks. No policy checks are weakened.

The preset disables signing, console wrapper and executable resource editing;
it neither accepts template paths nor invokes external resource tools. Handoff
requires precisely `game.exe` and nonempty `game.pck`, with the EXE equal to the
109268480-byte pinned release template, SHA-256
`d34d36f3be1a6c49c56525ae86469b92e4f417ddf0b43cf00dd80c385c4b0562`.
Additional native DLLs and modified executables fail closed. PCK remains
untrusted project code; a fixed EXE hash does not make arbitrary PCK safe.

`sandbox/windows-toolchain.mjs` verifies the existing locked TPZ and editor,
extracts only that archive entry into a new task-owned directory and verifies
its exact size and digest. It does not mutate the shared template cache.
Consumers must ship the Windows template and rebuild/re-pin the integrated
broker; Web template presence alone is insufficient.

## Acceptance boundary

`tests/godot-final-install-assets/windows-game-native.mjs` stores all 58 files
of an authored first-person training range in the real Rust managed project,
reads the pinned revision through pagination, verifies every hash and exports
through the real broker. It copies the EXE/PCK to a separate directory, runs
the game headlessly using its default bundled PCK, equips a sword through
`BaseOps`, saves through `SaveStore`, and compares the complete JSON snapshot
after a second game process loads and restores it. No state fields are omitted.
Godot release templates reject `--path`; use the executable's own PCK lookup.

The acceptance script is inert during ordinary play and requires the headless
display for its explicit command-line acceptance modes. All runs use fresh
test data and no mouse, keyboard, focus or Pointer Lock calls. The separate
profile is test data isolation, not a security sandbox for native game code.
Direct execution is restricted to this fixed authored fixture, never a model
artifact. Source registration remains source-only and is not a fabricated
formal application/check receipt.

Pending product work: a private current-source export service, a native output
picker, user-facing export controls, an ordinary standalone bootstrap for each
managed base, and visible independent play acceptance. Model-authored native
execution is not opened by this slice. Godot license and full copyright files
accompany this test output; all base/module/dependency distribution rights still
need the delivery review. Do not mark full CP4 or real-model acceptance complete.

Primary references: [Godot Windows export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_windows.html),
[Godot Windows path implementation](https://github.com/godotengine/godot/blob/master/platform/windows/os_windows.cpp).
