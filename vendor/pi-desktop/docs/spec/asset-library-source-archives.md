# Source archives in the existing asset catalog

The current model installation and application-status extension is specified in
[Author-owned source installation](author-source-installation.md). Indexing,
reading and proposing remain separate from explicit full-auto installation.

The GU6 Kenney trial exposed a retrieval gap: ordinary source-package import
works, but catalog `asset.import` refused `application/zip` and directory scans
omitted ZIP files. An imported world object is not automatically a catalog item.

The catalog now accepts ZIP bodies as opaque immutable files with media kind
`package` and MIME `application/zip`. Authorized scans return ZIP candidates;
the normal explicit host import records exact bytes, source metadata and tags.
Existing model-facing `asset.search`, `asset.read` and `asset.versions` can then
retrieve them. Existing limits, source grants, identity hashes, conflict and
replay rules remain in force. No registry, world usage or automatic import is added.

Indexing does not inspect, unpack, install or execute the archive. The structural
probe returns `probeOk=false`, `ARCHIVE_REQUIRES_PACKAGE_CHECK`, and
`archiveValidated=false`. Desktop preview returns a failed preview with the same
reason and no picture/playable claim. Both use existing result shapes; this is
not an asset corruption verdict. The four catalog state flags remain separate.
The import form maps the ZIP MIME to `package`; its preview copy directs the
user to the world's Godot creations panel and hides a retry that cannot add
the missing checker.

The actual source-package installer still validates the CP0/CP1 archive,
dependencies and source transaction before the normal check/preview/application
flow. Catalog ZIP content hashes identify the outer file list; they are not the
inner resource manifest hash and cannot be passed interchangeably to package
registration or check. Agent retrieval alone does not authorize installation.

Validation uses the two pinned Kenney ZIPs with a fresh real catalog, explicit
host imports, actual model-facing read bindings and a core restart. No model or
Godot execution occurs in this catalog test. Ordinary source-package import and
cold application have separate evidence; no combined end-to-end claim is made.

Recorded trial: `test-results/gu6-library-rhuxsl/report.json`, core binary SHA-256
`a33db70c1ac69f27f8f638c7b8e9ca4bf1d697f8c28e48e29c15d8b9e7b925fa`.
Two ZIP imports are searchable after restart, same-operation replay preserves
identity, changed bytes at the same version fail, and both records remain
unpreviewed/unchecked/unapplied. The source-metadata license status is left
unverified; precise license bytes remain inside the audited packages.
Validation: 21 catalog/desktop-preview tests, 20 import-UI/model tests, 37 Rust
catalog tests and desktop TypeScript check passed. A separate agent reviewed
the catalog/preview boundary without finding a blocker. Full packaged catalog
UI validation and installation from a retrieved catalog ref remain future work.
