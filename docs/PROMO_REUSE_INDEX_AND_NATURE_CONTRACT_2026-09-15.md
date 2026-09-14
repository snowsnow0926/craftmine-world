# Promo reuse index and nature extraction

## Scope and decision

Players should not have to teach a new provider where previously authored content lives. Generate the human inventory and the on-demand AI index from the actual source-library catalog, and distinguish installable components, model-only assets and full reference worlds. A proposed component ID is never an installable archive reference. Do not copy the entire inventory into every prompt.

The approved promo source contains finished visual and gameplay assets that were not individually cataloged. Extract adapters with independent instance identity while retaining exact original GLB bytes and their recorded provenance. Do not relabel an arbitrary regenerated replacement as the approved asset. Full-world reference metadata does not imply a cross-world source-reading API.

## Nature component contract

- `cw.nature.promo-broadleaf` v1 packages the original broadleaf model and the first promo grove tree's tint, scale and original base collision dimensions. One script root has one installer-assigned `entity_id`. Additional trees have independent identity and materials.
- `cw.scene.promo-meadow` v1 packages the original complete grass/flower arrangement, approximately 56 by 56 meters. It adds no ground, collision, player, tree or combat logic. The existing ground must cover its footprint; individual flower assets suit smaller requests.
- Model files are read from the checked-in promo source and verified against the outer source manifest before packaging. Runtime wrappers have deterministic UID files. Source declaration and independent rights verification remain separate.
- Source installation preserves the existing source and saved player progress, uses the normal source revision/hash precondition, and requires the normal check/apply workflow. A saved source is not evidence of a visible applied world.

## Validation evidence

`tests/promo-nature-reuse.test.mjs` verifies deterministic packages, exact source GLBs, one automatic root and no accidentally copied world/player/combat code. With `CRAFTMINE_CORE_BIN` and `CRAFTMINE_TEST_GODOT`, it installs two trees and a meadow through the real managed source installer, exports the resulting pinned source, and imports/runs it in the bundled headless Godot.

The engine verifies three distinct identities, two actual collision bodies, no introduced player/enemy, the original tree scale and collision dimensions, and a physics ray hitting the trunk boundary. Measured model bounds are approximately 2.54 by 4.15 by 2.52 meters for the tree and 56.11 by 0.63 by 56.13 meters for the meadow. The saved world snapshot remains unchanged by source installation.

The fixture intentionally has no managed export executor: its source install reports `source-saved-check-blocked`, followed by an independently executed real Godot import/probe. This is source-install and CPU component evidence, not native UI, model selection, managed Web export or complete player-flow acceptance. Those remain separate integration checks.

The earlier failed test fixture omitted the required source pin; its failure log is retained. It was corrected by supplying the actual `godotProject.index` revision/hash, without relaxing the installer guard.

## Integrated catalog

The production source-library builder now includes these two nature packages and the four promo combat packages. Its generated inventory lists 34 distinct assets across 41 version records, plus four complete reference worlds. Existing released archive versions retain their original bytes.

`tests/promo-reuse-discovery.test.mjs` seeds the entire built catalog into an isolated real Core process and uses the actual source-library search/read route. Default results find the correct packages for the player's Chinese words for tree, flowers/grass, monsters, sword, heavy sword, large monster, monster hunting and AK47. Exact returned archive references resolve to the declared single-root packages. The test has no active receiving world and correctly reports unknown compatibility rather than claiming it is ready to install. Historical combat v1 bytes remain available while an exact-ID search selects v2.

The on-demand guidance index is explicitly regenerated from this catalog. Existing source-interface hashes and controller cohorts remain unchanged. The index consistency regression rejects an outdated component/version inventory after later catalog changes.
