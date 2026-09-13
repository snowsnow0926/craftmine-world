# Fixed page dispatch for private gameplay verification

Date: 2026-09-13

Extend the existing hidden live-world helper with a finite operator input driver.
Reuse the protected `GodotWorldViewHost` page and normal engine input listeners;
do not introduce model tools, generic evaluation, another Core owner or a source
migration. Inspection of the pinned Web input code and actual native fixtures
showed that canvas DOM events reach the engine without focus or trusted OS events.

The alternative of expanding `headless_play_action.gd` would require a managed
source upgrade, check and adoption for every existing world. It is unnecessary
for these physical keys/buttons/motion because direct page dispatch works. Source
bytes, source identity and save ownership remain unchanged by verification.

Only a fixed program receives validated events. Its version/hash is reported;
runtime scope, formal instance and headless guard are checked. The Web button
handler's automatic DOM focus is suppressed locally, and the existing guard
blocks authored Pointer Lock/focus attempts. No actor, camera, health or success
counter is assigned by the driver. Relative motion is an input event, not a camera
or aircraft transformation.

Each finite segment owns its pressed inputs and releases them on completion,
error, cancellation and departure. Cancellation bypasses the queue while a native
wait drains. Source pins and actual observations, snapshots, frames and release
receipts make the resulting evidence inspectable. Unknown gameplay success remains
null and human control feel is explicitly outside this scripted evidence.

See [interface and native validation](../spec/codex-gameplay-verification.md).
