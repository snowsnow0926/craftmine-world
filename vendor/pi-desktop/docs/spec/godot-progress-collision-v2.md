# Creation v2 restore collision validation

New creation worlds use the `creation-player-collision/1` source cohort. Core,
exported PCK verification and host observer pins bind all twelve resources. The
v2 adapter inherits the exact existing v1 adapter and adds a pinned restore
collision helper. Published v1 and legacy source bytes remain compatible; they
are not silently upgraded or reported as possessing this guard.

After restoring the legitimate saved state, v2 keeps simulation paused across
two native physics-frame boundaries. It rechecks the actual fixed Player,
camera, shape and restored pose, then queries the full native capsule at its
actual shape-owner transform. Only the real player's RID is excluded. Declared
native names, entity metadata and imported package labels grant no exemption.
Physical contact up to 1 mm is tolerated; deeper penetration fails. Missing
contacts, unsupported identity, nonfinite data and query saturation reject as
inconclusive. Concave room interiors without surface intersection remain clear;
whether the room has an exit requires separate navigation evidence.

A failed restore returns an error after attempting to restore the original
capture and verify it, without moving the player to find a passing location.
Unconfirmed rollback is explicit. The existing verifier/load rejection and
latest-progress candidate staging therefore reject the candidate for v2 worlds.
The observation reports only the last restore attempt, not continuous clearance.

See the root `godot-creation-progress-collision-v2` specification for exact
limits and native/Web evidence. Production-class fixtures use authored
descriptors and do not establish a Core-issued application commit, sealed-client
adoption, ordinary player experience, or arbitrary dynamic-script safety.
