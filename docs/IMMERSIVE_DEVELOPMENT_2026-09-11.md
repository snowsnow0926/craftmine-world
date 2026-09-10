# Existing-world immersive development, 2026-09-11

## Delivered scope

This development batch adds play-mode closed, compact and full creation
presentations around an existing world. The same chat, composer, draft, task and
world stay mounted. F2 opens compact creation, Shift+F2 opens full creation,
Escape respects active input layers, and visible buttons provide the same
actions. The native game view cannot cover the creation pane or its pickers.

Opening creation pauses the game through a distinct overlay reason. Manual
pause, save/checkpoint freezing, candidate failure and later manual changes keep
their own ownership. Legacy games use a scoped independent hold; plugin
workbench controls remain interactive. No new Pointer Lock request is added.

Local push-to-talk captures at most 30 seconds of mono 16 kHz PCM and transcribes
with an installed Windows speech engine. It appends text to the same draft for
correction, without sending. Cancellation and world/session changes discard
stale recordings/results. Permission is one-use and restricted to the main
document; no recording upload or audio-file retention is introduced.

The real `godot_guidance` tool now discovers a bounded, version-pinned
first-person equipment recipe and matching references. Unknown IDs, source
interface changes and incompatible versions fail closed. The production plugin
builder includes the actual guidance resources and is regression tested.

## Validation

- 149 targeted tests passed together: native host lifecycle/geometry/shortcuts,
  legacy message handling, voice capture/process/permission state, composer
  draft retention, guidance/broker contracts and actual plugin packaging.
- 23 assertions passed in an independent headless React fixture using the real
  application and stylesheet with fixture native IPC. This is layout validation,
  not a live Electron world or installed-client acceptance claim.
- Desktop TypeScript, production main/preload/renderer build and style tokens
  passed; the production world plugin rebuilt successfully.
- Electron 43.5.0 offscreen fake-device probe verified denied unarmed capture,
  one explicitly armed audio request, and denial afterward. The Windows zh-CN
  recognizer enumerated and processed synthetic silence. No real microphone,
  OS mouse/keyboard input, visible test window or provider request was used.

Evidence archive: `D:/Craftmine-Immersion-20260911`. It contains test logs,
renderer report, clearly named fixture screenshot, native fake-device probe and
the primary checkout's original user-file hashes.

Live speech accuracy and physical held-movement handoff still require player
acceptance. No broad installed-client E2E or paid model benchmark was run.
During renderer development, the existing navigation suite exposed its
unchanged legacy assertion for `world.creationAction`; current code uses
`world.creationRetry`. This unrelated assertion was not changed in this batch.

## Development and remaining scope

Coordination used Codex agents only. The request used the isolated integration
branch `codex/iw-integration-20260911` and worktree
`D:/cm-iw-integration-20260911`, plus isolated UI, voice and guidance branches.
Relevant ADRs/specs and central scenarios CM-IW-01/02/03 and AI1-G01 were updated.

This is the existing-world IW1 foundation with early voice and bounded AI1
guidance. The new creation-sandbox base, persistent object placement/editing,
new interaction logic, incremental rebuild optimization and player acceptance
remain subsequent work. No new installer/version was published and the existing
installed client/shortcut was not replaced. Remote publishing was not requested.

Merge, commit and cleanup results are recorded in the evidence archive. Original
user documents and unrelated retained worktrees are preserved.
