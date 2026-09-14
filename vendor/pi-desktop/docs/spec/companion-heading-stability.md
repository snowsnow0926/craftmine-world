# Companion v4 heading stability

Approved Pomeranian and generic pet v4 change only the behavior source's heading
assignment from repeated Euler rotation mutation to a fresh unit yaw basis:
global_basis = Basis(Vector3.UP, value). Preserve the existing authoritative
heading/basis cache. Repeated Euler reconstruction accumulated scale error and
eventually failed the unchanged restored-transform validator after ordinary turns.

Publish new versioned source files/packages. Do not modify released Pom v1/v2/v3
or generic pet v2/v3 sources, archives, model/visual bytes or existing fixed recipe
pins. V4 retains v3 state, source settings, explicit receiving-world bounds,
collision/restore validation, scene paths, identity, input routing and source
requirement profiles. Its immediate upgrade metadata identifies the exact v3
script hash; ordinary source CAS/check/adoption remains required.

Append v4 to the existing builtin library. The normal latest-only asset query can
select it while explicit versions remain available. Existing world instances and
fixed composition recipes are not migrated automatically. This change does not
add pathfinding, relax checks, infer world bounds, alter progress or create an RPC.
It does not change the source-configuration installer or its authorization.

Validate in the pinned real Godot headless CPU engine, at 60 Hz for 3000 heading
updates with the existing following angle interpolation. Keep positions fixed
to isolate numerical orientation from navigation. Require v3 rejection, v4 unit
scale and successful original restored-state validation, then an independent
process restoring exact serialized identity/settings/sourceSettings/position/yaw/
interaction counts. Invalid child transforms and world-boundary violations must
still be rejected. See [the focused test plan](../e2e/companion-heading-stability-20260915.md).
