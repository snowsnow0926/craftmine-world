# Asset sources and licensing

## Third-party assets shipped by this base

**None.** The base ships no PNG, audio, font, model or plugin from a third party.
Terrain tiles, the player, the crafting station and the HUD are drawn at runtime
with `_draw()` / `draw_rect` from the `color` values declared per material in
`world.json`. There is therefore no art import step, no texture licence question
inside the base, and nothing to re-distribute under a third-party licence.

## Engine

The base targets the pinned engine in `desktop/godot/toolchain.lock.json`:
Godot `4.7.2-stable`, MIT licensed. When the engine is redistributed with the
product, the Godot licence and copyright notices are required; the repository
already carries them at `desktop/godot/licenses/GODOT_LICENSE.txt` and
`desktop/godot/licenses/GODOT_COPYRIGHT.txt`, and the release manifest in
`delivery/base-assets.mining-sandbox.json` references their real bytes and hashes.
The engine licence does not change the licence of this base's own code.

## Base code

The scripts, tools, parameters and world templates in this directory are original
work for this project. The movement model is a declared reuse of the side-view
base 1.0.0, which is itself project-original; `docs/REUSE.md` records the source
paths and hashes. The base does not contain code copied from third-party
projects.

## What a redistribution must check (not done here)

- The engine notices above must be present in the actual package.
- A world exported or shared by a player includes the base scripts; the exporter
  must carry the applicable notices (task K owns the packaging check).
- This file records what the base contains. It is not a legal opinion, and the
  project-wide licence decision in `docs/LICENSING_STRATEGY.md` is still marked as
  not yet applied per module.
