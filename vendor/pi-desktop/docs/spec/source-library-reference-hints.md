# Source library identity and prerequisite hints

Source-library search/read responses distinguish the immutable catalog ZIP
identity from inner package resource identities. `archiveRef` and `installRef`
contain the same exact catalog AssetRef. `readRequest` can be passed unchanged
to the source-library read tool. The common `referenceRoles` explains why
`rootRef.sha256` and `resources[].ref.contentHash` must never replace the catalog
`ref.contentHash`. None of these response fields grants installation authority.

For component results, `targetCompatibility` is a read-only, advisory comparison
against one pinned Godot source revision/manifest. The source index is paged
with the same pins; mixed revisions, invalid index data or missing services
produce `unknown`, never a positive compatibility claim. The existing
`assessRequirements` rule checks every fixed required path and all declared
alternative profiles. Responses retain path-level missing/changed/matched
results and profile IDs. A known mismatch is `adaptation-required`.

`source-prerequisites-matched` means declared base/engine and file prerequisites
match that source snapshot. It does not check base version, package dependency
resolution, installation conflicts, placement, gameplay or adoption. Normal
installation performs all existing checks again. Original catalog/body hashes,
source requirements, exact profile matching and expected-source mutation guards
are not relaxed. Original failed model requests remain visible.

Search preserves the original result order, total, offsets and pagination.
Only returned component archives are inspected. No alternative version is
invented, selected or installed. Empty results and whole-world-only results do
not read a component source snapshot. Whole-world results continue to require
creating a separate world. If preflight cannot read the source, search retains
the catalog result and exact read request with unknown compatibility, avoiding
unnecessary archive reads. Archive read failures likewise remain explicit
unknown results with safe error codes; cancellation still propagates.
