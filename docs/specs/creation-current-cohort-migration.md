# Current creation cohorts and the legacy migration gate

The ordinary creation turn calls Main's `createCreationSourceMigration` before
starting its model request. A formal source using a complete shipped
`creation-fixed-controller/1` or `creation-player-collision/1` cohort is already
current; this service returns `null` without changing or downgrading it.

Authority comes from `currentSceneObserverProfile` and `loadSceneObserverPins`
in `creation-observer-pins.ts`, the same complete cohort definition used by live
scene observation and the collision guard. Each required path must occur once
and match the trusted installed resource's LF or CRLF SHA-256. The v2 cohort
also requires its pinned native player controller and camera rig. Merely matching
the top-level adapter does not establish authority. Version-specific shared
members distinguish incomplete/mixed modern cohorts from legacy migration inputs;
ordinary player/camera paths alone do not make a legacy world modern.

This is specifically the existing **scene observer cohort** gate: v1 requires
8 files, v2 requires 12. It does not newly establish v1's separate 10-file
physical controller evidence. Physical controller verification remains with the
existing source/PCK/probe layers; a migration no-op is not runtime evidence.

Before returning the modern no-op, the service keeps its active capture and
formal world/build/base/source-revision checks, reads `project.godot` from the
formal `contentOid`, verifies bytes/hash and exact unique runtime/adapter selectors,
then rechecks the active capture. Mixed, missing, duplicate or altered protected
cohorts fail with `CREATION_MIGRATION_NEEDED`. A new adapter stripped of its modern
helpers is also unknown to the legacy migration path and fails closed.

No-op does not read or compare the current unadopted draft. A valid formal world
may have an unfinished ordinary draft that the next turn must repair. That draft
continues through normal source pin, patch, check and adoption validation. No-op
does not create migration records, issue a patch, or record a migration advance.
Authored world/contract/source files remain byte-identical.

Legacy current-source no-op and reviewed historical migrations retain their
existing behavior. Actual migration writes still require safe selectors, exact
formal/draft file comparison, content CAS, task binding, durable receipt recovery
and final source verification. This change adds no new migration destination,
cohort upgrade, model permission or runtime capture authority.

Regression entry points:

- `tests/godot-agent/creation-cohort-migration.test.mjs`: actual materialized v1/v2,
  CRLF, authored source and unadopted draft preservation, every protected member's
  absence/tamper/duplication, mixed/partial groups, changed trusted pin, selectors,
  formal identity, content mismatch and active capture transitions.
- Existing controller cohort and both legacy migration suites; creation target,
  check requirements and direct-edit safety suites.

These are real materialized source bytes with injected domain/capture services.
They do not claim a sealed-client turn, model response, engine job or player
experience passed; those require the parent integration's new sealed build.
