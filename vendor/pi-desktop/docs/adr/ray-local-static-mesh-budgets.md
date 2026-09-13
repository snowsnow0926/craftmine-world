# Ray-local uncertainty for oversized static meshes

Date: 2026-09-13

## Problem

After ordinary catalog insertion of the approved Pomeranian, its large static
ArrayMesh exhausted the per-mesh picker budget before ray intersection. The
observer consequently cleared even unrelated stock ground targets, preventing
the existing Place here workflow. This was reproduced in the real PI client;
the direct installation and formal adoption themselves succeeded.

## Decision

Keep the existing allocation and triangle limits. Inspect at most the already
bounded sixteen native surface metadata/material entries. Geometry deformation,
custom bounds, custom resources, and potentially displaced materials retain
their global fail-closed behavior. A large otherwise static mesh becomes a
bounded uncertainty: native transformed bounds decide whether it can precede
the actual ray hit. An intersecting nearer oversized mesh still refuses a
target; an off-ray or farther mesh does not disable unrelated selection. Never
read oversized vertex/index arrays or treat its bounding box as a geometry hit.

The changed picker keeps its existing source path. Retain the exact released
implementation in `shared/repairs/scene_mesh_picker_v2-global-budget.gd`. Rust
source validation and Electron observer pins admit only the exact released and
current LF/CRLF hashes. New materializations use the fixed implementation.
Already-built complete controller/collision cohorts receive a reviewed observer
upgrade handle. The ordinary **Update world observer and check** action uses
source compare-and-swap, retained migration receipt, native check and formal
adoption. It changes only the pinned picker; authored files and conflicting
draft edits are protected. Unknown, mixed or partial observer cohorts remain
unsupported.

## Verification

The native geometry regression checks off-ray, foreground, behind-hit and
custom-bound cases, including a later shader surface after an oversized first
surface. Metadata checks cannot stop early merely because a limit was exceeded.
Migration tests cover complete old/current cohorts, exact byte recognition,
single-file CAS, retained authored content, replay and a conflicting draft.
Rust validation tests admit both released line endings and reject tampering.
The full player roundtrip separately verifies ordinary catalog insertion,
supported stock editing, native checks and sharing.
