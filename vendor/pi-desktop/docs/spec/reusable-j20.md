# Reusable drivable J20 component

The asset catalog adds `cw.module.reusable-j20@1` and a separate visual-only
`cw.model.approved-j20@1`. Both carry `reusable-world-content`; the original
22 catalog packages retain their exact hashes. The GLB is the accepted demo
model, 1,130,080 bytes, SHA-256
`458105858e12f513dbef111672e83a9897f274796d4321358425a479f094bafe`.
Model rights remain unverified; the new wrapper's MIT license does not establish
a separate generated-model redistribution license.

The playable component includes simplified game flight, nearby ray interaction
to board, throttle, pitch, bank, rudder, gear, follow/cockpit cameras, collisions,
landing, braking and persistent flight state. It is not a realistic aircraft
simulator. The raw model does not include these capabilities.

The target must provide a real level runway with the declared 2400 m length,
56 m width and open airspace. The aircraft points toward world negative Z and
its center sits 2.18 m above the runway. The parent world uses an identity
transform. Runtime boarding preflight checks actual collision along three lanes
and ground samples; it refuses the stock bounded 64 m field. These samples are
preflight evidence, not a guarantee that all future flight paths are clear.
The component never removes boundaries, substitutes a toy/VTOL aircraft, adds an
entire airport behind the player's back, or replaces existing world source.
The agent may author the required open flight area through ordinary source tools
before installing. Only the existing player/component interfaces are hash-pinned;
the complete world's source is not pinned to the stock environment.

W/S controls throttle; down/up arrows pitch up/down; A/D bank; Q/E steer rudder;
Space brakes; Shift adds afterburner; G toggles gear; C changes camera; Enter
exits after parking. Actions use the `cw_j20_` namespace and only the piloted
instance consumes them. Aircraft collide with normal world geometry and other
aircraft. Independent instances retain different entity IDs and state.
The aircraft participates in normal object collision layer 2 as well as aircraft
layer 16; its mask includes terrain, ordinary objects and other aircraft. The
flight HUD starts below the retained world's top caption to avoid overlapping
player instructions.

This version uses a vehicle-camera abstraction: the actual on-foot controller
remains at its collision-valid boarding point under an aircraft-owned movement
lock. The camera and aircraft move; the player is not teleported. To exit a
healthy plane, actually land, taxi within 18 m of parking, and stop below 0.5 m/s.
After an accident Enter releases driving control while retaining the crashed
aircraft at its actual crash position and the walking player at the original
boarding position. It does not reset or repair the aircraft.

The component uses the existing `craftmine_persistent_components` ledger and
`snapshot`, `validate_state`, `restore`, and `validate_restored_state` contract.
State includes aircraft pose/velocity, control surfaces, throttle, gear, flight
and landing history, piloted state, selected camera, and boarding position.
Cold reopen restores these fields exactly while paused. The unchanged native
collision guard validates the actual parked on-foot controller. Aircraft camera
presentation activates on ordinary resume's first physics frame; an unpiloted
peer cannot steal it. Aircraft-camera operation is not evidence of on-foot
controller walking. Removing or exiting the component releases its owned lock.

Validation covers native source installation as two independent instances and a
separate actual Godot runtime bridge sequence: stock-field refusal, ray boarding,
runway acceleration, takeoff/climb, bank, gear, cockpit, airborne save, cold
reopen, actual controlled descent/landing, physical taxi, exit and another cold
reopen. Existing target source and marker transforms remain unchanged. These
headless checks send no OS input, show no windows and call no model. They are not
a sealed Windows client visual playtest.

The playable catalog entry includes an unchanged 104,956-byte actual formal-world
PNG showing the complete aircraft from its follow camera, with the runway and
flight HUD visible. Its provenance pins the capture's world/build/instance and
the exact rendered model/controller source hashes. The catalog display scope is
`component-view`; the underlying image is explicitly a receiving-world view,
not an isolated neutral model render or a gameplay/compatibility certificate.
The raw model entry keeps no driving screenshot. Exact source bytes are retained
across checkouts so a source change cannot silently reuse a stale preview.
