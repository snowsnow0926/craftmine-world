# Recognize complete current creation cohorts before legacy migration

Status: accepted for implementation, 2026-09-12.

The sealed `2a584796` client installed and checked two Kenney building modules,
but its next ordinary player prompt stopped with `CREATION_MIGRATION_NEEDED`
before any model invocation. The migration target list named only the legacy
`shared/adapters/creation-sandbox.gd`, so even unmodified materialized controller
v1 and collision v2 were unknown migration inputs.

We reproduced both failures directly against real `materializeBase` output at
baseline `933d188752f679e4db32a7d41520981bec754294`. The frozen before reports are
in `docs/evidence/creation-cohort-migration-20260912/` alongside passing reports
from the same source materialization after the fix.

The decision is to expose the complete profile classifier from the existing
observer pin module and use it at the migration gate. Valid current profiles
return no migration after the formal source and selector checks. A legacy
adapter with modern helpers, or any partial/tampered modern cohort, cannot fall
through to the old upgrader. This preserves the complete-group authority used
for actual observation rather than creating another adapter hash allowlist.
The reused scene observer cohort contains 8 files for v1 and 12 for v2; this
migration decision does not additionally certify v1's 10-file physical controller
evidence, which remains under the existing source/PCK/probe checks.

An unadopted draft is not a migration input for this no-op. Requiring draft bytes
to equal the formal world would prevent a user from repairing an earlier failed
ordinary source edit. Existing write-time migration CAS and draft guards remain
unchanged. No automatic v2 downgrade or migration advance is produced.

Validation: 24 materialization/cohort/legacy migration tests and 42 capture/check/
direct-edit safety tests passed; complete desktop `tsc -p tsconfig.json --noEmit`
passed. The new test's single protected-members test exercises missing, tampered
and duplicate states for every required file in both profiles. No engine, model,
user input or existing player profile was used by this fix's verification.

The original closed player profile remains the source of the integration failure
report; this patch does not reinterpret that failure as a successful player turn.
The parent will rebuild the sealed client and continue the original wish/session.
