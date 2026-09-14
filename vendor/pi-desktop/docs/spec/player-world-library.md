# Player world template library

The existing world picker can create a new independent `creation-sandbox` world
from an immutable local catalog reference. Its `world.create` request adds
`starterId: library` and `libraryRef: {assetId, version, contentHash}`. The asset
ID uses `player.world.*`; the version is a positive integer, at most 100000.
The original published examples and their authored default state remain intact.

Normal new-world source initialization must preserve each hash-verified authored
`.glb.import` policy together with its declared `.glb` model. Materializing the
file on disk is insufficient: it must be present in the native source index and
readable with its exact bytes. Otherwise a copied world's installation
declaration names a missing managed file and later component publication fails.
Only paired GLB policies are admitted, matching Core's current source policy;
image/audio originals do not imply support for their `.import` sidecars.
Non-cache sidecars unsupported by Core are rejected explicitly during archive
validation and with `MANAGED_BASE_IMPORT_POLICY_UNSUPPORTED` during initialization.
`.godot`/`.import` cache-directory contents remain excluded. An orphan policy fails explicitly
with `MANAGED_BASE_IMPORT_MODEL_REQUIRED`. Sorted initialization patches place
the model before its policy; Core validates the policy against the same-batch or
already committed model. No previously failed/copied world is silently repaired.

The player must explicitly choose `initialState: saved-progress`. The client
first captures and saves the actual formal runtime while paused, then describes its native source identity.
The template uses this saved state as the new world's starting point. It does
not claim a reset, authored defaults, zero victories, or unexplored territory.
Current draft changes are excluded. A changed selected world, formal source, or
durable snapshot rejects publication before catalog commit.

### Stable publication capture and release

The authenticated main-window panel accepts `worldTemplate.capture` and
`worldTemplate.releaseCapture` with exactly `{worldId, operationId}`. These are
main-process lifecycle actions, not Core methods or model tools. Capture uses the
existing host checkpoint, including waiting for an earlier save and confirming
pause before reading progress. Its private release closure belongs to the exact
runtime instance and pause-intent revision. It restores only
the manual pause introduced by this publication; a pre-existing pause, joined
checkpoint, later pause, candidate, replaced world or closing host cannot be
released by it. Overlay pauses remain governed by the existing pause controller.
An ordinary autosave invalidates the cached checkpoint result without changing
pause ownership. Releasing a publication must therefore not require that cache
to remain populated; the original manual intent and runtime identity govern it.

The panel retains the capture under its operation ID. A different capture in the
same world cannot overlap it. Release waits for pending capture and archive work;
an old or duplicate release cannot affect a newer operation. The renderer never
supplies pause state, native identity, snapshot or release token. The submission
finally path requests this scoped release after success, failure or preparation
cancellation, including after unmount. Successful publication therefore does not
leave a manual pause behind: closing the ordinary asset sheet removes its overlay
blocker and gameplay resumes unless another pause owner remains.

An uncertain/committing publication retry preserves the original operation and
source identity. A terminal failure followed by live snapshot drift cannot reuse
that operation with new arguments; the player explicitly cancels the retained
save and starts a newly captured publication. The error text explains this path.
Original failed journals and source/snapshot compare-and-swap checks are retained.

The private `worldTemplate` host service supports `describe`, `save`, `status`,
`cancel`, `list`, `read`, `prepare`, `importArchive`, and `exportArchive`. The
renderer never supplies an archive path, staging path, runtime progress, preview
bytes, or Core method. Native pickers grant external files through the trusted
main process. Export requires a new destination, refuses overwrite, and leaves
the source intact. Source/preview paths never enter the renderer response.

`describe` returns `expectedSource: {worldId, buildId, contentOid, revision,
snapshotHash}`. Save additionally accepts an operation ID, display name (120
UTF-8 bytes), description (1200 bytes), at most 30 tags (40 bytes each), asset ID,
version, and the explicit state choice. Trusted main may inject an actual view
capture with matching world/build IDs; its archive scope is `source-world-view`,
not an isolated-object render. Read returns metadata, compatibility, exact ref,
and an optional PNG data URL. List retains catalog paging without inline PNGs.

Rust `asset_catalog` stores immutable ZIP versions with `kind: world`,
`mediaKind: package`, and `application/zip`. There is no second world database.
Save status is `capturing`, `committing`, `saved`, `failed`, `cancelled`, or
`unknown`; missing operation receipts are not failures or successes. Identical
retry returns the same receipt. Reusing an operation with another request is
refused. Cancellation before commit prevents import; once the native commit
starts, its durable outcome wins and the UI must resolve status rather than
claiming cancellation. Pending operation journals contain only this workflow's
bounded metadata and source archive, never transcript or credentials.

The archive includes a manifest, exact formal source closure, explicit initial
snapshot, and optional PNG. It refuses links, duplicate/case-aliased ZIP paths,
undeclared files, privacy-denied source paths, missing or changed hashes,
unsupported bases, and oversized content (64 MiB archive/total, 4 MiB per source
file, 4096 entries, 1 MiB initial state, 2 MiB PNG). Imported source is untrusted
content and is never executed by the plugin or Electron process.

Declared GLB models may include their matching `.glb.import` settings sidecar,
the import configuration currently supported by native Core. Its model must
also be declared in the archive; settings bytes and hashes are preserved.
Ordinary image/audio source files remain supported, but their `.import` sidecars
are refused rather than accepted and silently discarded during initialization.
Arbitrary/orphan sidecars and private `.godot`/`.import` caches remain refused.
Omitting GLB import settings would change the adopted source closure and can
change model import behavior.

Materialization only changes the declared `project.godot` runtime world ID,
world-scoped creation receipts, the `craftmine.instances.json` registry's world
binding, and host progress envelopes. Instance maps must have the supported
schema and bind to the source or published world before remapping; foreign,
missing or malformed bindings are rejected before project writes. Source-local object
and component identities, scripts, and binary assets retain their bytes. Each
create operation produces a different world ID, and ordinary native source
initialization, build checks, candidate first load, and durable save/reopen still
apply. Archive integrity does not establish compatibility or playability.

`godot_source_library` can read whole-world template metadata but rejects both
single and grouped component proposals with `WORLD_TEMPLATE_REQUIRES_NEW_WORLD`.
It instructs the player to create an independent world through the picker.

## Validation

`tests/player-world-library-native.mjs` restores a user-authorized test archive
into a private domain and checks actual formal export, catalog persistence,
save/retry, import/export corruption boundaries, two independent native worlds,
exact selected initial state, unchanged source-local identity, source/world
guards, and Core restart. It runs no model or game input. Full client validation
must additionally confirm first build/load and runtime save/reopen; this native
test deliberately reports `buildsRun: 0` rather than attesting them.
