# Promotional combat reuse

- Existing promotional templates and GLB bytes remain unchanged.
- A source package has one automatically installed root. Child IDs are deterministic derivatives of that root, with no reused hard-coded monster IDs.
- Invisible player context is shared by explicit world-relative player/camera binding, even when Sword or AK is installed first. It contains no visible hostile or weapon.
- Installing a stage exposes only that stage's requested models and behavior. Unknown/missing interfaces are errors, not claims of compatibility.
- Only one equipped module consumes attack input. Original keyboard and captured-mouse controls remain available; components never acquire pointer capture.
- Conversation/creation input disable and scene-tree pause stop hostile damage/simulation. Loading a component never teleports a player or clears terrain.
- Later installation preserves existing persistent IDs and progress. Context state uses `craftmine.promo-combat-context/1`; new component formats do not rewrite the original world's formats.
- Monster movement is the original local obstacle steering, not general navigation. Explicit scene bounds/flat placement are required.
- For the same bound player, known original promotional combat formats or the supported existing player-vitals interface reject with `PROMO_EXISTING_COMBAT_ADAPTATION_REQUIRED`. Preserve and edit the original combat source instead of installing another system. Same-family helpers and unknown node names/formats do not trigger this guard.
- Entering or leaving a trial synchronizes the original encounter HUD and damage-overlay visibility without advancing paused HP/timers. Trial control hints describe the actually equipped weapon. Return/defeat messages refer only to existing content and progress, not an assumed dog or forest.
- The temporary battle-start announcement does not repeat blade-specific controls: a trial can also start with the rifle equipped. The persistent HUD supplies current weapon controls.
- Component HUD controls use a full-viewport Control parent and relative anchor offsets. Encounter life/downed/hit feedback and blade top/bottom/central panels must have nonzero global rectangles inside the actual viewport, including viewport resize while the tree is paused. This layout change does not depend on the original world's presentation node or mutate combat snapshots/timers.
- Hornling and riftbeast restore must preserve the actual Node3D Euler yaw through the strict JSON state roundtrip. Restore resets the unit basis and sets `rotation` directly; reconstructing only a basis must not introduce an additional trigonometric roundtrip. Snapshot continues to read real transforms, including external movement. No tolerance, shadow snapshot or saved-format migration is introduced.

## End-to-end acceptance

1. Build and install the monster package through the public source installer. Verify one scene insertion, six independent derived actor IDs, no sword/beast/rifle asset and no original world-root edit.
2. In the pinned headless engine, capture with the actual component registry, verify player and monster damage, and pause via the ordinary player input gate. Save/restore all component states.
3. Add a blade, then a hunt, then AK in separate source transactions; verify earlier HP/deaths/actions/ammunition survive. Verify blade damages a hornling before hunt installation and AK works without hunt.
4. Separately install only Sword or only AK into a blank world. Verify no monster, beast or arena exists. Test equipment input routing, pause, damage, reload and full cold restore in the engine.
5. Export Web with compiled scripts and exercise the same context protocol; no runtime source-code inspection is required. Record native/player-visible checks separately.

## Implemented packages and controls

| Package | Automatic visible content | Prerequisite | Controls |
| --- | --- | --- | --- |
| `cw.module.promo-monsters` | Six original hornlings | Compatible explicit player/camera; flat configured footprint | Approach activates local pursuit; R recovers after defeat |
| `cw.module.promo-heavyblade` | Original held heavyblade | Compatible explicit player/camera; no monster required | J / captured left mouse light slash; K / captured right mouse heavy slash; Shift dodge; arrows look |
| `cw.module.promo-hunt` | Original beast, trial sign, barriers active during trial | Exact installed heavyblade v1 source; flat clear 22 by 28 metre footprint | H starts/retries; B returns to entry pose; Esc pauses; 1 potion |
| `cw.module.promo-ak47` | Original held rifle | Compatible explicit player/camera; no blade/boss/monster required | Hold J / captured left mouse fire; K / right mouse aim; R reload; 2 rifle / 3 installed blade; arrows look |

Monster pursuit remains the original local obstacle steering. The arena validates ground samples and a clear physical volume, not general terrain suitability or navigation. Direct compatible hostile damage is limited to the promotional hornlings and the active promotional beast. Each weapon role and hunt is unique per player; repeated monster encounters derive independent child IDs. Pack installation does not imply a successful check or adoption.

`buildPromoCombatPackages({repository})` returns four `{file,bytes,entry}` items. `buildPromoCombatPackage({repository,stage})` selects `monsters`, `heavyblade`, `hunt` or `ak47`. Aggregation into the shipped catalogue is a separate caller responsibility.

## Verification commands

```powershell
node --test tests/promo-combat-packages.test.mjs
$env:CRAFTMINE_GODOT_CACHE_DIR='ABSOLUTE_PINNED_4.7.2_CACHE'
node tests/godot-components/promo-combat-headless.mjs --web-export
$env:CRAFTMINE_CORE_BIN='ABSOLUTE_CRAFTMINE_CORE_EXE'
node --test tests/promo-combat-source-install.test.mjs
```

The engine fixture uses isolated data and no OS input or pointer capture. It covers behavior assertions including the no-monster solo stages, a real slash and rifle collision ray, beast attacks, conversation pause, later additions preserving state, reload and precise known-conflict rejection. The expected-error bootstrap probe confirms an existing old health component remains intact and new combat input is disabled. A separate engine process restores the player and full component ledger. The normal product Web preset currently uses source text (`script_export_mode=0`); a second Web export uses binary tokens (`script_export_mode=1`) and is checked for `.gdc` output. Both actual exported PCKs restore through the pinned CPU runtime. This does not claim browser rendering or a natural AI/player victory.

The source-transaction fixture uses the ordinary archive/proposal/CAS installer on a real Core process. Without an executor its check request remains explicitly blocked with `GODOT_EXECUTION_UNAVAILABLE`; this is recorded rather than reported as a passed engine check. Existing source bytes and prior lock/instance entries are preserved while the two package ledgers append new entries. The separately recorded engine fixture is the behavior evidence.
