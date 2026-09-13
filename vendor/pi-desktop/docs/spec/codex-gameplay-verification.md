# Private scripted gameplay input

`scripts/codex-gameplay.mjs` exercises the currently applied world through actual
Godot Web input handlers. It is an operator-only surface over the existing hidden
live host. It adds no model tool, Codex request, world/progress database, source
upgrade or automatic gameplay verdict. The `craftmine` tool catalog is unchanged.

## Commands and API

```powershell
node scripts/codex-gameplay.mjs run --data 'D:/Craftmine Worktrees/codex-promo-20260913/test-results/cl2' --plan examples/codex-gameplay/pet-keys.json
node scripts/codex-gameplay.mjs run --data 'D:/Craftmine Worktrees/codex-promo-20260913/test-results/codex-promo/worlds/flight' --plan examples/codex-gameplay/flight-keys.json
node scripts/codex-gameplay.mjs cancel --data 'D:/Craftmine Worktrees/codex-promo-20260913/test-results/cl2'
```

These commands are for the coordinator after authoring has settled. Component
tests never use those profiles or the active city profile. The same profile lock
refuses concurrent authors/operators. The example plans send the listed controls;
starting state and actual effects must be assessed from evidence. They do not
assume boarding, successful pet interaction, flight, hits, deaths or weather effects.
Use `--expect-build gbd-...` to refuse a plan if the applied build has changed.

A plan contains only `format` and a nonempty finite `segments` array. All segments
are validated before the first event, so a malformed later segment cannot cause
partial execution of a valid prefix.

```json
{
  "format": "craftmine.gameplay-plan/1",
  "segments": [
    {"keys": ["KeyW", "ArrowUp"], "frames": 60, "settleFrames": 15},
    {"keys": ["KeyF"], "frames": 1, "settleFrames": 60},
    {"buttons": ["right"], "motion": {"x": 20, "y": -8}, "frames": 2},
    {"buttons": ["left"], "frames": 12, "settleFrames": 30},
    {"frames": 120, "capture": false}
  ]
}
```

Physical codes cover letters (`KeyA`–`KeyZ`), digits (`Digit0`–`Digit9`), arrows,
Enter, Space, Tab, Escape, Backspace, left/right Shift and Control, and ordinary
punctuation codes. The normal Godot InputMap maps those keys to authored actions;
the caller cannot directly invoke an arbitrary action or GDScript method.
Buttons are `left`, `middle`, `right`. Motion is one relative pointer delta in
canvas CSS pixels, delivered at the canvas center; Godot performs its normal
viewport scaling. No camera transform or captured-mouse state is assigned.

`frames` is 1–600 native physics waits; `settleFrames` is 0–600 (default 1).
These reuse the base's existing finite `wait` operation. Keys/buttons are held
together, then released before settling and after-capture. Each segment releases
all its own inputs, including between segments. There is no added whole-plan,
whole-agent, token or model-call budget. DOM/worker/IPC scheduling can add frames
around the requested wait; reports do not pretend the requested number is an
exact measured key-held duration. `capture` defaults to true.

Trusted API callers use the instance returned by their own live host:

```javascript
const {worldId, buildId, instanceId} = (await live.call('open')).instance;
const identity = {worldId, buildId, instanceId};
const evidence = await live.gameplay(identity, {
  keys: ['KeyF'], frames: 1, settleFrames: 60
});
// While a segment is pending:
await live.cancelGameplay(identity);
```

Every segment and cancellation requires the exact current formal world/build/
instance. Foreign/stale identities fail before input. The plan cannot select a
world, source root, actor, arbitrary JavaScript, Core RPC or executable. Preview
candidates are excluded. Selection polling is held across the input operation;
identity is checked around asynchronous reads and dispatch.

## Input route and authority

`GodotWorldViewHost.headlessGameInput` is available only with the protected
headless profile and parent controller. It sends a fixed, validated page program
to its own formal WebContents. The program verifies the immutable runtime scope,
headless guard and canvas, then dispatches untrusted DOM `keydown`/`keyup`,
`mousedown`/`mouseup`, and `pointermove` events. The pinned Godot JavaScript input
listeners convert them into normal engine events, reaching `_input`,
`_unhandled_input`, InputMap and physical-key polling. It does not call the old
base movement override for key movement.

Godot's Web button handler normally calls `canvas.focus()`. During fixed dispatch,
the host suppresses that DOM focus step and restores the property afterward.
It verifies that the active DOM element and Pointer Lock remain unchanged. There
is no native focus, OS input, `sendInputEvent`, Pointer Lock request, Playwright
input API or control of another browser. The existing pre-script guard continues
to block authored focus/capture attempts. A new guarded attempt is reported as
`policy-blocked`; an authored control that requires captured mouse input is not
made to pass by changing its source or state.

The version is `craftmine.headless-game-input/1`; each delivery includes the
host-computed SHA-256 of the fixed dispatch program. Core continues to verify the
served Godot export bytes. Authored source and build files are never rewritten.
The CLI compares source repository/head/applied pins before and after the plan.
No engine helper migration was needed: the native fixture proved direct page
dispatch reaches the actual engine with unchanged source manifests and Git head.

## Evidence, cancellation and saving

Each segment retains real before/after observation envelopes, full runtime
snapshots, diagnostics/console lines and optionally actual captured PNG files.
It also retains the native wait reply from before release, DOM event delivery
receipts, guard readings and release receipt. These are sequential samples, not
one shared physics tick. PNG hashes refer to the saved PNG bytes.

`completed` means the finite input operation completed and released its inputs.
`semanticSuccess` is always null: unknown scripts may ignore a key or have a
prerequisite the coordinator has not met. A DOM delivery receipt is not proof of
boarding an aircraft, hitting a monster, navigating a city or satisfying any
other gameplay goal. This is functional scripted-input evidence, not human
control-feel acceptance. Read the real state, HUD, frames and authored behavior.

SIGINT/SIGTERM and the `cancel` command request release immediately, outside the
normal command queue. The pending native wait is allowed to settle; later segments
do not start. A cancelled/lost down reply still triggers matching releases. Failed
release retains the recovery record, blocks another segment, and is retried on
drain/close. Stop and parent disconnection release inputs before retiring the
owned engine context. No held virtual key can be carried into a cold instance.

The runner uses the existing normal save/close path after release. Save failures
remain errors with unpersisted runtime recovery diagnostics, never successful
save receipts. Successful completion includes the actual retirement save receipt.
Use `scripts/codex-live-world.mjs reopen --data DIR` afterward for cold reopening.
`gameplay-active.json`, cancellation requests and per-operation evidence files
are host lifecycle records, not a second world store.

## Validation

```powershell
node --test tests/codex-gameplay.test.mjs tests/codex-live-service.test.mjs
node tests/codex-live-typecheck.mjs
node tests/codex-gameplay-native.mjs <absolute-runtime> <absolute-built-plugin> <new-absolute-profile>
```

Offline tests cover schema/identity refusal, finite ordering, early/in-flight
cancellation, lost down replies, release retry and guarded input failure. The
native test creates a fresh authored fixture, checks and applies it through real
Core/engine/verifier/first-load boundaries, and then freezes the source baseline.
Normal GDScript consumes F, button and motion events; physical W polling drives
the real CharacterBody movement and observes release. Tests prove source manifest,
revision and Git head unchanged across input, reject foreign/stale identities,
cancel a held input, release on exit, preserve save failure recovery and confirm
changed progress after cold reopen. It uses no model calls, synthetic native job
success, forced actor state or coordinator-owned content profiles.

Implementation validation on 2026-09-13 passed in `test-results/gi4`; the complete
record is `gameplay-native-report.json`. It includes separate F-key before/after
PNGs, held/released movement, button/motion, cancellation, release on exit and
the unchanged source pins. The real CLI cancellation check is retained in
`test-results/gameplay-cli-cancel.log` (exit 130, release confirmed). The 6 new
offline tests, 2 existing service-boundary tests, 39 host lifecycle regressions
and strict live-host TypeScript check passed. None invoked a model or inspected
the coordinator's pet, flight or city profile.
