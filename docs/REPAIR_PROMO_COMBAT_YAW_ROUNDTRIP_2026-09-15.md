# Promotional combat yaw roundtrip repair

A subsequent text-only source edit exposed a saved-state restore failure. The affected hornling's saved yaw was `0.192851096391678`; restoring with `Basis(Vector3.UP, yaw)` and then reading `rotation.y` produced `0.192851111292839`. Position, health and the other ten components were unchanged. The same valid yaw reproduces the problem in riftbeast restore.

The component fix preserves the Node3D Euler value directly while resetting the basis to unit scale first. The ordinary snapshot still reads `rotation.y` and actual position. Generic component equality, collision checks, state formats, IDs, input, gameplay and original GLBs are unchanged.

## Existing installed source

A new bundled package does not update already installed source files. Use the ordinary authoring file read and source CAS patch flow, then check and adopt. Read the current source index/revision/hash first; do not reuse an old source revision. In `restore(data)`, replace exactly one occurrence in each applicable file:

```gdscript
	basis = Basis(Vector3.UP, float(data.yaw))
```

with:

```gdscript
	basis = Basis.IDENTITY
	rotation = Vector3(0.0, float(data.yaw), 0.0)
```

Leave all other source and progress unchanged. The actual failing world had these source file hashes; these are evidence pins, not permission to skip a fresh read:

| Installed path | Original SHA-256 | SHA-256 after only the literal replacement above |
| --- | --- | --- |
| `addons/cw.module.promo-monsters/hornling.gd` | `0f7ac42766625c3f8abde59925ea9e75bc2e8c13d03307e87ab0b946b2e603fb` | `808aa0ab2f7fad82327e00f2afca5d3fd6c5e3aea706b5381e385e751f28c9fa` |
| `addons/cw.module.promo-hunt/riftbeast.gd` | `d3b32816e15fbbd51866e9be8f090dd5679622b691a1e1a288711aa9c457c092` | `6b119778ff9ede6a21edf30c411b0d9dc5ee1f1e8af975ffb02e7599ce075251` |

The bundled sources also include explanatory comments, so their full hashes differ from this minimal existing-world repair.

## Validation

The complete original failed source and captured job snapshot were copied to an isolated CPU Godot fixture. The unchanged adapter and component guard reproduced the exact original error. The literal repair then restored the full player and all eleven components with strict equality, followed by two separate cold processes with the same exact result. The original failed input/output and all probe logs remain in ignored evidence; no live profile or immutable package was edited.

The normal component regression now checks positive/negative yaws, both pi boundaries, the precise failing position/yaw, 2,048 turn/restore cycles per actor without accumulating scale, and external position/basis changes appearing in the real snapshot. The prior gameplay, HUD and cold-restore checks remain enabled. Run `node tests/godot-components/promo-combat-headless.mjs` with the pinned `CRAFTMINE_GODOT_CACHE_DIR`, plus `node --test tests/promo-combat-packages.test.mjs`.
