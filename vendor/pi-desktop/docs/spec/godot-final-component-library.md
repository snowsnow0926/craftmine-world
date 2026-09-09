# Managed Godot component library

The Godot world's existing Library page now opens a dedicated component UI.
Legacy worlds keep their existing library. The page lists identifiable objects
from the managed project's actual `project.godot` main scene, exports a selected
object, imports a native-picked ZIP, and repeats an import as a new independent
instance. It links the workflow to the existing Check Records preview/apply
surface; saving/installing source alone never means the formal world changed.

## Trusted source service

`createManagedPackageSourceService({call, bind})` is exported from the bundled
`reuse-service.mjs`. `bind(worldId)` validates the selected world and returns
`{context, worldRecord}` using the existing workspace ownership. It is read-only
and does not create a Git operation context. Both methods pin every source read
to a manifest revision and verify complete file sizes and hashes:

- `listSource({worldId})` returns `{worldId,revision,manifestHash,mainScene,
  items:[{nodePath,name,entityId,supported,reason?}]}`.
- `exportSource({worldId,revision,manifestHash,nodePath,assetId,version})` returns
  private `{archiveBase64,archiveSha256,files,bytes,source,requiredSourceFiles}`.

`createReuseService` accepts optional `sourceList` and `exportSource` callbacks
forwarding to these methods, alongside `installSource`. Missing callbacks
refuse explicitly. The plugin build bundles the extractor, static ZIP layer
and scene parser, so deployment does not need checkout-relative module paths.

## Native UI gateway

The UI calls `package.request` with `{worldId,method,params:{worldId,...}}`.
Native gateway methods are `sourceList`, `exportSource`, `importSource` and
`repeatImportSource`. The last two accept a fresh `operationId`; repeat also
accepts `grantId`. The native gateway owns file selection, file bounds/hash
verification, expiring world-bound grants, and saving exported ZIP bytes. It
must never return archive bodies or host paths to the page. Its import result
includes the installer projection plus `grantId`; otherwise repeat stays
disabled. Unknown install outcomes keep the original method/operation/arguments
for explicit retry. A successful repeat gets a new operation ID.

## Extraction and installation boundary

The extractor takes the chosen node and its descendants, needed TSCN external
and internal resources, internal signal connections, scripts, static `res://`
dependencies, and supported OBJ/MTL relative resources. It preserves collision
and mesh children and rebinds internal parent/connection paths. CRLF source is
read correctly. Whole-world roots, multi-identity child trees and detectable
external node/signal dependencies refuse. Identity fields in this slice are
`entity_id` and `target_id`, including inherited PackedScene/script exports.
It does not label JSON-only side-view room data as exported scene components.

Copied paths are relocated under `addons/<assetId>/`. Copied GDScript receives
deterministic namespaced UID files. Existing base named classes, such as the
first-person `Interactable`, remain exact external source requirements rather
than duplicate globals. `entry.sourceRequirements` locks each required path and
SHA-256; the managed installer verifies every requirement before preparing any
source write. Other class collisions still refuse through normal draft checks.
Dynamic script behavior is only established by the real build/check pipeline;
static extraction is not a claim that arbitrary gameplay dependencies work.

Bounds: 64 MiB source read, 256 component files, 256 exact external source
requirements, 4 MiB total copied component source and 5 MiB ZIP. The manifest
uses a base version only when the world actually declares one. It exports
authored defaults, never live player progress or an invented license grant.
Public redistribution rights still require review.

The installer saves one real `godotProject.applyFiles` revision with scene,
payload, UID, lock and instance map, then starts a real check. Missing execution
capability returns the actual blocked job. No test-only executor is registered
by these component tests, and no source receipt is presented as an application.
