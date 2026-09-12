# Fixed catalog ZIP source installation

`package_library` mode `propose-source-install` is read-only. It resolves the
host-bound task world through `task.context` and reads one exact catalog version
without opening a workspace or acquiring a draft lease. A single ZIP file is
required. The returned suggestion has no operation identity or write authority.

The existing Godot creations panel searches every fixed catalog version, reads
the selected version back, and requires an explicit install action. It preserves
the chosen version even when a newer version exists. The Main gateway supplies
the world/session/project owner and rechecks it across metadata and file awaits.
`package.request/importCatalogSource` accepts only worldId, operationId and ref;
Main resolves the managed blob, verifies catalog/file identities and invokes the
existing source installer. Private paths, archive bodies and provenance are not
returned to the page or model.

Private dispatch accepts an operation for its fixed original world. A subsequent
view change does not redirect or falsely undo that transaction; confirmation is
refused for the new owner while the original receipt remains recoverable. The
existing durable installer intent binds optional host provenance before source
planning. Same operation with a different ref or owner fails even when the ZIP
bytes match; legacy requests retain their original identity.

An explicit retry after grant expiry revalidates metadata, blob bytes and owner
before renewing authorization and recovering the same durable operation. It
cannot reuse the expired grant or silently replace an uncertain operation. The
UI releases only a newly generated first attempt after an exact known preflight
refusal. Once an outcome is uncertain, subsequent metadata errors do not prove
that an earlier operation never wrote source.

Source check, candidate preview, formal application and progress persistence
remain separate stages. Catalog hash, complete ZIP SHA-256 and inner resource
manifest hash are separate identities. The product uses the existing asset
catalog, source installer, task lifecycle and atomic source transaction.

Validation distinguishes model-route tests, real gateway/DOM tests with a fake
executor, real filesystem intent tests with fixture core calls, and full sealed
client/core/LPAC application. A prepared full-client runner is not evidence that
the latter stage passed. See the GU6 scenario in the delivery E2E plan.
