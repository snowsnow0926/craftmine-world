# Do not apply placement margins to unchanged geometry

## Real failure

The ordinary player follow-up on frozen package `2ae18b25` requested only: `把这扇门改成红色，其他东西保持原样。` The actual player was standing beside a closed door after the previous legitimate movement test. `creation_operation` rejected the color-only source edit with `CREATION_PLAYER_OVERLAP`.

The compiler unconditionally called `validatePlacement` for all modifications. Its conservative player half-extents are larger than the actual base capsule, so a valid existing touching pose can lie inside the placement exclusion margin. Requiring a fresh placement check for unchanged geometry prevented repainting that existing object. The original request/response is retained in `test-results/desktop-native-ordinary-jHKHPj/player-67f7cca6-ad07-4bb9-ac6b-557962559484.json`.

The model offered moving the player, moving the door or abandoning the color change. None matches the original request; the test skipped the question rather than falsely claiming movement or choosing a weaker goal. The original run remains evidence for the old package, never retroactively marked fixed.

## Behavior

The compiler now compares validated before/after kind, position, rotation and scale. Actual geometry changes, new objects and restored deleted objects still use the original bounds, occupancy and player-overlap checks. Color-only or other unchanged-placement edits do not repeat those spatial checks; explicitly supplying identical spatial values has the same behavior. Undo of a nonspatial change follows the same rule.

World/build/instance/capture/source pins, live observation identity, immutable chest rewards, source transaction guards, receipts and formal candidate/application checks remain. This is source-level placement analysis, not a claim that arbitrary scripts reacting to a property change have no runtime effects. Formal verification is still required before application.

## Verification

A regression using the actual observed pose first reproduced `CREATION_PLAYER_OVERLAP`, then passed after the fix. It also proves that scale changes at that pose remain rejected, unchanged explicit spatial values work, and undo restores the original color. The production source-service test verifies the same case without granting formal application and retains stale runtime rejection.

Independent review found an undo-order edge case in authored multi-entity inverse records: a moved entity could be validated before an unchanged peer was added to the restored set. The compiler now builds the complete final set first, then checks every spatial change against all final peers. The new negative first reproduced missing rejection and now receives `CREATION_OCCUPIED`. Thirty-six operation/source-service/summary tests pass. A newly frozen package and ordinary-player rerun are still required to establish the user-visible fix.
