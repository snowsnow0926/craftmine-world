# Source-library instance configuration

Source prerequisites and receiving-world configuration are separate conditions.
A companion v3 archive declares `entry.positionValidation` with
`mode: explicit-receiving-world-bounds`, `requiresWorldConfiguration: true`, and
the `saved_position_min` / `saved_position_max` exports. Its historical ±80
defaults do not authorize silently installing it into an arbitrary world.

Search and read expose `targetCompatibility.resources[].configuration`.
The original prerequisite result is retained as `sourcePrerequisitesStatus`;
a matched prerequisite result with unresolved configuration becomes
`configuration-required`. Missing prerequisites remain `adaptation-required`.
All of these remain advisory: `runtimeVerified` is false and normal checks and
candidate adoption are still required.

For exact stock sources, all configured controller and entry selector pins in
`companion-position-profiles.json` must match. A city override prevents fallback
to sandbox bounds. A `configuration-planned` result carries source-bound
`positionBounds`. The installer independently recomputes that plan against its
complete source snapshot, then writes both exports on every new instance before
the source transaction and check. It does not edit the component archive.

For a custom or changed world, inspect its actual source and supply:

```json
{
  "positionBounds": {
    "minimum": [-240, -20, -300],
    "maximum": [240, 160, 80],
    "expectedSource": {"revision": 4, "manifestHash": "<current 64-digit SHA-256>"}
  }
}
```

The numbers above illustrate the city profile, not an arbitrary-world default.
`install` and `propose` accept this field beside `ref`; `install-group` and
`propose-group` accept it on each ordered item. Vectors contain exactly three
finite numbers within ±100000, with minimum strictly below maximum on every
axis. Extra properties and missing source pins are refused. Explicit bounds
require exactly one configurable component in that item's archive. This is a
small structured contract, not raw GDScript or an unrestricted export map.

The host supplies world/task/turn identity. Each frozen request includes its
world and source revision/manifest; each explicit configuration must match that
same source. A source edit invalidates an old explicit configuration even when
its numeric values remain plausible. This also applies after a previous install
changes a stock scene: read the new source and confirm bounds again. Normal
lease, formal head, progress revision and file CAS checks remain in force.
Missing/stale required configuration is rejected before `package.planInstall`,
`godotProject.applyFiles` or `godotBuild.start`. Host binding and proposal
records can still be created; the source and runtime progress are untouched.

Manual proposal confirmation and automatic author installation use the same
materializer. Frozen proposals retain the structured configuration. Installation
intents and receipts retain per-instance `sourceConfigurations`, including
instance/entity identities and the source used. Cold retries return the same
committed operation; they do not configure a replacement instance. A receipt or
blocked check is not a running-world or save/reopen verification.

The direct library UI blocks preparation only when a newly declared required
configuration is unresolved. It explains that AI must inspect/configure the
world. Historical companion v1/v2 archives do not have this required-config
contract. They remain selectable/installable for limited-area usage, with an
explicit ±80 save-range warning in search/read, direct UI and install receipts.
Large/unknown world hints never claim that legacy range covers the world. The
host does not change their bytes, versions, IDs, settings or saved state, and
does not broaden their validation. Use v3 or an explicitly reviewed source-local
upgrade for following across a larger world.

The manifest accepts recipe versions 1, 2 and 3, matching the composition domain
and current v3 default. Composition still asks the agent to read exact component
and source requirements before installation.
