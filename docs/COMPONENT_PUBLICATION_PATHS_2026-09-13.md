# Bounded component publication paths

## Problem and specification

The integrated native library acceptance found a Windows import failure after publishing an installed Pomeranian and installing the publication in another world. Its model path retained both installation namespaces (`addons/player.component.../addons/cw.module.approved-pomeranian/model.glb`). Further publication would accumulate every preceding namespace. Godot reported an inaccessible subdirectory and failed to load the model.

Re-publication must remove installation ancestry from package paths while preserving the exact GLB bytes, relative external image paths, paired GLB import policy, source requirements, attribution and declaration lineage. This does not authorize a longer filesystem sandbox, relaxed verification, or a successful outcome after an engine import failure.

## Decision

When extracted payload contains an installed `addons/` path, put original files under short `r/<group>/` directories. Keep the fresh `_craftmine_component.tscn` extraction wrapper at the archive root. Group GLB, OBJ and MTL resources with their relative dependencies; include paired GLB import settings in the same group. Strip only each group's common directory prefix, retaining all relative relationships within it. Shared images merge model groups. Distinct groups prevent same-basename collisions.

Rewrite textual `res://` references through this exact mapping and bind attribution hashes to the relocated bytes. Binary model and GLB import settings remain unchanged. Exact original-path `sourceRequirements` remain external and pinned; dual-use dependencies retain both an original-path requirement and a relocated payload copy. Existing source lineage and parameter declarations remain attached to the new publication. Original world source, old archives, and failed evidence remain unchanged.

This bounds installation ancestry, not arbitrary original author directory depth or the number of inherited scene wrappers. The existing 256-file and 4 MiB extraction limits still apply. Source dependencies already unsupported by extraction remain unsupported.

## Verification and E2E scope

The regression installs and exports ten consecutive generations through the managed installer/source services, with two GLBs sharing a texture through different relative paths, a paired import policy, explicit license references and parameter declarations. Each generation verifies exact model/texture/policy bytes, all rewritten textual references, current lineage, and short archive paths. A separate dual-use fixture verifies relocated models still retain original shared-base requirements.

Command: `node --test tests/godot-agent/glb-dependencies.test.mjs tests/godot-agent/parameter-declaration-roundtrip.test.mjs tests/godot-agent/package-attribution.test.mjs tests/player-component-library.test.mjs`, with `CRAFTMINE_CORE_BIN` pointing at the integration Core binary: **15 passed, no skips**. This includes real Core install/export/reinstall source transactions, but those checks intentionally have no engine executor.

Full native Pomeranian publication, template copying, re-publication and fresh-world import are owned by the root integrated `tests/player-library-ui-native.mjs` acceptance. The service regressions are not a replacement for that engine/render/player acceptance.
