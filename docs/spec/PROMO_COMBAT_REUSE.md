# Promotional combat reuse

- Existing promotional templates and GLB bytes remain unchanged.
- A source package has one automatically installed root. Child IDs are deterministic derivatives of that root, with no reused hard-coded monster IDs.
- Invisible player context is shared by explicit world-relative player/camera binding, even when Sword or AK is installed first. It contains no visible hostile or weapon.
- Installing a stage exposes only that stage's requested models and behavior. Unknown/missing interfaces are errors, not claims of compatibility.
- Only one equipped module consumes attack input. Original keyboard and captured-mouse controls remain available; components never acquire pointer capture.
- Conversation/creation input disable and scene-tree pause stop hostile damage/simulation. Loading a component never teleports a player or clears terrain.
- Later installation preserves existing persistent IDs and progress. Context state uses `craftmine.promo-combat-context/1`; new component formats do not rewrite the original world's formats.
- Monster movement is the original local obstacle steering, not general navigation. Explicit scene bounds/flat placement are required.

## End-to-end acceptance

1. Build and install the monster package through the public source installer. Verify one scene insertion, six independent derived actor IDs, no sword/beast/rifle asset and no original world-root edit.
2. In the pinned headless engine, capture with the actual component registry, verify player and monster damage, and pause via the ordinary player input gate. Save/restore all component states.
3. Add a blade, then a hunt, then AK in separate source transactions; verify earlier HP/deaths/actions/ammunition survive. Verify blade damages a hornling before hunt installation and AK works without hunt.
4. Separately install only Sword or only AK into a blank world. Verify no monster, beast or arena exists. Test equipment input routing, pause, damage, reload and full cold restore in the engine.
5. Export Web with compiled scripts and exercise the same context protocol; no runtime source-code inspection is required. Record native/player-visible checks separately.
