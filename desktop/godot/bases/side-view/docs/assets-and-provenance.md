# Side-view base: assets and provenance

The side-view base ships **no third-party assets**. Every visual is generated in
code:

| Element | Source |
| --- | --- |
| player, solids, platforms, hazards, pickups, targets, doors, checkpoints | `Polygon2D` and `ImageTexture` created at runtime in `scripts/` |
| background and room outline | `_draw()` in `scripts/world/room.gd` |
| fonts, audio, images, models, tilesets | none |

Consequences:

- no image/audio/model licence to audit for this base
- no import step for binary assets; the only import cache is Godot's own
  `.godot/` directory, which is gitignored and rebuilt by `--import`
- the engine itself is the pinned Godot 4.7.2 build under
  `desktop/build/godot/4.7.2-stable/`; its MIT licence and notices are handled by
  the host packaging work (task E), not by this base

If a future world adds an asset, record its origin, version, author and
redistribution terms next to the world data before it is used.
