# Approved Pomeranian reuse

The local built-in asset catalog adds `cw.model.approved-pomeranian@1` (model)
and `cw.module.approved-pomeranian@1` (playable source component). Both bind the
accepted 3,753,144-byte GLB SHA-256
`1ab9f354598df75504b061fb06e1e5e386bd59c878afcec3bad8388832dadd0b`.
The original twenty approved delivery packages remain byte-for-byte unchanged.

The companion supports flat-ground following, petting through the existing
managed interaction ray, waiting (`following=false`), and persistent name,
appearance, position, heading, and interaction count. It uses the existing
component state contract and exact managed source requirements. Each installation
receives a distinct native instance identity. The optional cream variant clones
materials on the selected instance; white remains the exact accepted visual.
The model has no skeletal animation, navigation, combat, or driving behavior.
Its glTF face is +Z. The component rotates the visual 180 degrees to align the
nose with the follower's -Z heading; the original model bytes remain unchanged.

`entry.sourceRequirementProfiles` optionally declares one to eight exact runtime
alternatives, each with an ID and one to 32 `{path,sha256}` requirements. Common
`sourceRequirements` remain mandatory; one entire alternative must match current
source. Invalid declarations fail `PACKAGE_BASE_PROFILES_INVALID`, unmatched
profiles fail `PACKAGE_BASE_PROFILE_MISMATCH` before source installation. The new
companion accepts the legacy component runtime, current collision controller, or
that controller with the exact engine-monitor bridge. Old packages are unchanged.

Codex desktop and CLI expose the existing registered `asset_library`,
`godot_source_library`, and `package_library` tools through their normal permission
gates. CLI now wires the same source catalog, package installer, and host-owned
installation-turn lifecycle as desktop. No generic RPC or filesystem tool is
added. Instructions require short keyword/alias search, exact AssetRef reads,
capability/compatibility inspection and reuse before regeneration unless the
player requests redesign. The catalog and ZIP refs are distinct identities.

Source-library proposals remain frozen, world-bound suggestions requiring the
existing player installation action. `package.request` with method
`sourceProposals` now includes installed proposals after restart; its optional
`installation` contains source receipt, instance IDs and `{jobId,status}`.
`requiresPlayerAction=false` means source installation has already occurred;
`applied=false` remains until separate native adoption evidence exists. Consumers
poll `package.sourceJob` using the retained job ID instead of installing twice.
Exact duplicate installation uses the same operation ID and is idempotent.
The synchronous originating-turn activity fence runs before and after creating a
proposal. Cancellation during persistence removes only that newly created, still
uninstalled matching record. A pre-existing retry record is never removed.

Source components remain below 4 MiB and ZIPs below 5 MiB. No extraction limit
is increased. Wrapper code is MIT; generated model redistribution rights are
explicitly unverified. The local catalog seed does not publish remotely or carry
developer paths/accounts. The retained preview and Blender Python source are
development provenance; runtime model previews use the normal asset preview flow.

The source-library group proposal checks the existing 6 MiB compressed and
uncompressed aggregate limit before persisting. Two accepted Pomeranian archives
exceed that group limit, so callers receive
`SOURCE_LIBRARY_GROUP_TOO_LARGE_INSTALL_SEPARATELY` and install them sequentially.
The independent second instance does not require replacing the first or rebuilding
the model. `tests/codex-library-native.mjs` exercises the actual staged CLI host
with Rust, including catalog search, exact ref, size refusal, source installation,
idempotent retry and foreign-world refusal without a model or engine launch.

Validation: `tests/approved-pomeranian-package.test.mjs`, existing catalog/source
proposal tests, `tests/builtin-source-library-native.mjs`, focused native
installer preflight and `tests/godot-components/approved-pomeranian.mjs`.
The native fixture verifies two real GLB instances, follow/wait/pet, isolated
material editing and fresh-node serialized restoration. It is a component fixture,
not player or live Codex acceptance; those remain integration scenarios.

The live two-instance check found an inherited collision-guard bug: separated
cylinder peers were incorrectly classified as unsupported shapes. The accepted
component handles recognized cylinder/box peers before testing overlap; actual
overlaps and unsupported shapes remain rejected. The fixture explicitly invokes
`validate_restored_state` on two separated pets, then on a deliberate overlap,
then after separation. Merely restoring serialized dictionaries was insufficient
to prove the complete runtime restore contract.

## Version 3 bounds amendment

V3 adds explicit receiving-world position bounds while preserving published
v1/v2 bytes. See [the contract](companion-world-bounds.md).
