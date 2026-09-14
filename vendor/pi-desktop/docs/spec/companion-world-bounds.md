# Explicit receiving-world bounds for companion v3

Approved Pomeranian and generic pet v3 expose source-configured Vector3 fields
`saved_position_min` and `saved_position_max`. All endpoints and coordinates must
be finite within ±100000, with each minimum below its maximum. Defaults remain
the legacy ±80 cube and do not cover the full city. Description and
`entry.positionValidation` require configuration from the receiving world source.

Coordinates use the pet's feet. A 2 mm vertical contact tolerance matches the
existing restored-collision inset; horizontal bounds remain exact. Validation
never clamps or writes state. Identity, sourceSettings, yaw and integer count
validation remain mandatory even for positions outside the old prototype cube.
`craftmine.pet-companion-state/1` and all saved fields remain unchanged. Bounds
are source policy, not new saved fields. Native collision still uses pet shapes.
Generic pet v3 also corrects an existing branch that incorrectly rejected a
supported nonoverlapping cylinder/box peer as unsupported.

The library appends v3; published Pom v1/v2 and pet v2 archives and models stay
byte-for-byte unchanged. Default recipe 3 pins Pom v3. Recipes 1/2 keep old pins.
Exact world script and scene/project selector cohorts produce required instance
properties: city x[-240,240], y[-20,160], z[-300,80]; sandbox x/z[-32,32], y[0,32].
Changed selectors or custom overrides produce `world-source-review-required`
without guessed properties. The read-only plan does not install or configure
anything; the agent applies properties through normal source/check/adoption.

`desktop/plan-companion-bounds-upgrade.mjs` creates only exact-old-script-hash
source patches using explicitly reviewed finite bounds. It retains paths and
identities, includes expectedHash CAS, and never writes progress or old packages.
Custom authored overrides require manual source review. No new Host/Core RPC is
introduced. Do not use the player-pose validator for pets: anchors and collision
shapes differ, and arbitrary callbacks could recurse into component validation.

V4 inherits this entire bounds/state contract and fixes only accumulated heading
scale drift. See [the versioned orientation amendment](companion-heading-stability.md).
Existing recipe 3 and explicit v3 references retain their original bytes.
