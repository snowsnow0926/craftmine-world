# Source library identity and prerequisite hints

Source-library search/read responses distinguish the immutable catalog ZIP
identity from inner package resource identities. `archiveRef` and `installRef`
contain the same exact catalog AssetRef. `readRequest` can be passed unchanged
to the source-library read tool. The common `referenceRoles` explains why
`rootRef.sha256` and `resources[].ref.contentHash` must never replace the catalog
`ref.contentHash`. None of these response fields grants installation authority.

Required per-instance configuration is assessed separately; see
[Source-library instance configuration](source-library-instance-configuration.md).
An otherwise matched prerequisite result with unresolved bounds is
`configuration-required`, with the original result in `sourcePrerequisitesStatus`.

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
unknown source compatibility but still inspects returned archives for intrinsic
installation declaration failures. Archive read failures likewise remain explicit
unknown results with safe error codes; cancellation still propagates.

## Automatic instance declarations

Search's `targetCompatibility.automaticInstallation` and read's top-level
`automaticInstallation` distinguish declared automatic scene nodes from bundled
helper scripts. A scene installer needs exactly one declared entity per resource.
A contradictory declaration produces `installation-declaration-blocked` without
promoting unknown source prerequisites; their independent status remains in
`sourcePrerequisitesStatus`. The hints preserve `PACKAGE_SINGLE_ENTITY_DECLARATION_REQUIRED`,
explain that parameter guessing cannot repair immutable package metadata, and
offer an exact asset search followed by ordinary read/install/source editing.
They do not invent an entity-selection parameter or relax the real installer.

Combat v1 remains byte-for-byte available with its original three-entity,
one-scene declaration. Corrected v2 declares only its actual automatic monster
and adds deterministic UID companions for all three GDScripts. Its machine-readable
`installationGuide` names the one required manual player-vitals node: without
unique vitals, monsters deliberately do not pursue or attack. The weapon script
is optional manual setup after the player requests it. Three bundled scripts
do not mean three automatic nodes, a complete sword/AK system or instant gameplay.
Use actual installed paths with project index/read, then normal source CAS and
check/adopt for authored setup. Version 1 is never replaced in place.

## Retained proposal recovery

Proposal listings add a read-only `installationAvailability` projection for
records without an installation result. The original proposal's archiveRef and
archiveSha256 must both match freshly verified archive bytes. Only a confirmed
single-entity declaration failure blocks its direct-install affordance. Missing
archives, changed hashes and read errors remain unknown. Identical frozen archive
references are read once per listing. No proposal JSON, original status, source
pin or history ordering is rewritten, and recorded jobs bypass this projection.

The renderer accepts a blocker only when its verified member identities match
the original proposal. It displays concise recovery text and keeps technical
causes in details. Manual installation is unavailable for that known bad version;
unknown versions retain the existing path and all installer guards. The player
can inspect other versions in the existing sidebar library. No version is picked,
prompt submitted, or current author task retargeted automatically. Old-world
read/install replies cannot populate the next world's cards.

The ordinary library's `directInspect` uses the same verified declaration check.
For a confirmed single-entity mismatch it returns its existing `eligible: false`
response with the original error code, avoiding another guaranteed failed direct
start. The renderer maps that code to the same concise version-selection message
and leaves technical details available. Read/hash failures keep their existing
error behavior and are not reclassified as a known bad declaration; valid or
otherwise unknown declarations continue through the existing eligibility checks.
The source installer itself and explicit version selection are unchanged.
