# Reusable rain-control component

`cw.module.rain-control@1` is a playable persistent source component installed
through the existing package/source proposal, check and adoption path. It adds
one direct child to a compatible creation-sandbox world. It does not replace the
world root, player, camera, ground, environment, global input map or world save.
Its exact runtime/component-ledger source profiles are declared in the package.

## Gameplay

The component derives the approved rain world's deterministic 2,200-drop
distribution, original water shader and six-stage simulation. It uses small
procedural bead geometry rather than importing the original courtyard. The
static local weather volume spans approximately 60 by 60 metres and heights
0.2–14 metres relative to its placement. Rotation and non-unit scale are rejected.
This version does not detect roofs or make the volume follow the player.

Unmodified U slows and suspends rain; the next U reverses the same drop positions
upwards. I restores normal downward rain and cancels any automatic sequence.
O runs suspension, a 3.2-second hold, upward acceleration, a 4.5-second rise, and
return to normal rain. The normal movement controller continues during skill
suspension. The component inherits world pause; F2 pause blocks keys and direct
actions and stops simulation. Repeats, modifiers and active text editing do not
cast. The component owns a small independent HUD with the same actions.

U/I/O can be remapped via three source properties. They must be distinct letters
not already bound to an unmodified InputMap action. The component never mutates
InputMap. Existing scripts handling raw keys outside InputMap still require the
authoring agent to inspect and reconcile their controls before adoption.

## Ownership and persistence

One weather controller may own each bound player's world. A second member of
`craftmine_weather_controllers` under the same world makes actions and component
validation fail with `RAIN_WEATHER_OWNER_CONFLICT`. The approved legacy rain
world's `advance_rain`/`resume_rain` contract is also recognized and rejected with
`RAIN_EXISTING_WEATHER_CONFLICT`. These failures cannot become successful save or
check results. Different worlds retain independent owners. Removing the extra
component restores availability; existing rain is not silently replaced.

The immutable `entity_id` is remapped by the ordinary installer. The existing
component ledger persists phase, velocity, phase age, rain clock, automatic
sequence intent, casts and four canonical base64 float32 height chunks. Position
distribution, drop scales and rate multipliers regenerate deterministically from
the unchanged distribution version. Held heights restore exactly, without new
casts or resetting timers. State remains below the existing 64 KiB per-component
limit. Invalid identities, phase/velocity combinations, clocks, fields and height
encodings are rejected before mutation. `validate_restored_state()` follows the
existing zero-argument ledger contract. No parallel save store is introduced.

## Verification

Root tests `tests/rain-control-package.test.mjs` and
`tests/builtin-pet-package.test.mjs` validate bounded deterministic packages,
lineage, normal scene insertion and all 22 original shipped asset IDs/versions/
archive hashes. New content uses the `reusable-world-content` tag.

`tests/godot-components/rain-control.mjs` creates a private project from the
unchanged actual creation world, installs the package through the scene
materializer, and runs pinned native headless Godot. It verifies movement through
held rain, reversal, restore, separate-process reload, paused inputs, cancellation,
invalid state and conflicting owners/keys. It enables the original controller's
fixture-only input route and sends synthetic engine events; it never assigns
actor movement or player progress. World/player restore uses existing APIs.

Headless dummy rendering does not supply reliable MultiMesh transform readback.
These tests prove simulation and mesh-resource construction, not visible pixels
or frame rate. The original world's problematic startup self-probe is absent
from production. Final offscreen client rendering, package adoption and user
playtest remain separate integration evidence.
