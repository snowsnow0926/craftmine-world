# GU4: actual controller binding and frozen door checks

Base: `2ae18b25`; branch `codex/gu4-controller-binding-20260912`; independent tree
`D:/cm-gu4-binding-0912`. Picker dependency: `f2a228bb4a1853ab399109e728db33ff5922c323`.

The old file-pin-only gap is now addressed for the finite new
`creation-fixed-controller/1` profile. Host capture freezes the profile; Rust
binds its exact source group and validates actual Player/script/camera/shape
facts plus consecutive physics-tick identities at finish. The probe dispatches
walk to the verified Player object. A door that can be directly opened while its
sequence is locked fails this profile even if its marker sequence works.

Legacy adapter/bridge/picker bytes and old stored requirement hashes are retained.
Strong requirements with an old probe or alternate/subclass Player are unsupported
and cannot become ready. Source is not silently replaced. Generic scene diagnostics
remain outside authoritative readiness.

## Verified results

- 60 Node tests: controller facts/tick continuity, frozen requirements, real
  materialized old/new observer groups, PCK protection, target service and scene
  object identity regressions.
- 37 Rust job tests: includes 13 new source/evidence finish cases, real stored
  candidate outcomes, old requirements, persistence and cancellation regressions.
- 2 Rust source cohort tests; complete desktop TypeScript check passed.
- Actual native engine: 13 cases passed their expected verdicts in
  `test-results/controller-binding-native-rWprO7/report.json`.
- Actual Web and PCK: six cases passed their expected verdicts in
  `test-results/creation-door-passage-web-xIz4Hp/report.json`; all current exports
  protected ten exact source resources, including player/camera and both picker
  versions. Legacy export retained its five-file group.

| Real Web case | Result |
|---|---|
| Correct door | Passed |
| Closed door without collision | CLOSED_NOT_BLOCKING |
| Open door retains collision | OPENED_NOT_TRAVERSABLE |
| Direct door interaction bypasses sequence | CLOSED_NOT_BLOCKING; actual doorOpen=true |
| Legacy probe | PROFILE_UNSUPPORTED:PROBE_UNAVAILABLE |
| Canonical files retained, Player changed to subclass | PROFILE_UNSUPPORTED:PLAYER_SCRIPT_MISMATCH |

The committed real-evidence fixture preserves the final Web run's identities and
raw facts. Core tests consume those unchanged; SQLite finish tests separately
label their rebound copies as authored executor evidence. No real model was run.
All Web Pointer Lock/focus counters are zero; all processes use isolated background
fixtures and fixed engine `4.7.2.stable.official.ed1daf0bf`.

GU1 also verified the full new group against a formally imported GLB through LPAC,
actual adapter/bridge observe, stable object references and increasing physics
ticks: `D:/cm-gu2-pick-0912/test-results/glb-pick-audit-wwkH5X/report.json` (37 checks).
The wrapper exposes the picker limitations: base-surface triangles, no active LOD
verification, no pixel-accurate claim.

Integration at `D:/cm-agent-godot-0912` retained the later natural-language
resolver, frozen colors and `declaredLabel`, adding the new controller profile
to the resolved request. Twenty-seven focused integration tests and desktop
typecheck passed; 38 Rust job tests (including the additional declared-label
case) and two source-cohort tests passed. Two added integration assertions also
confirm natural requests require the new profile and all ten materialized
resources exactly match the GLB trial's actual receipt. The focused rerun was
eight tests, all passed. A fresh native run
`test-results/controller-binding-native-n0vBli/report.json` independently passed
all 13 expected cases. An initial native launch omitted the existing cache
environment variable and failed before engine execution; rerunning with the
recorded cache succeeded. The full new Windows package remains to be built and
validated; these results do not update the earlier player package's coverage.

The first full integration build stopped during resource staging because the
three newly authored runtime files had no distribution declarations. The exact
committed bytes for the new adapter, controller sampler, picker V2 and changed
materializer were added to the existing shared-runtime manifest under its
project-authored provenance. No external code or new licence grant is included
in that declaration. Staged-materializer validation now requires the new group
to survive the actual package source filter; the failed staging attempt is
retained as a packaging defect, not a successful build.

## Preserved diagnostic history

Earlier implementations correctly failed when a replaced script cancelled the
walk coroutine, when waiting for render frames skipped physics ticks, and when
the new wrapper initially omitted the explicit parent initializer. The latter
produced tick 0 in `controller-binding-native-Bl2jFA`,
`creation-door-passage-web-5QDh2E`, and GU1's `glb-pick-audit-vXwj7Q`; these are not
final passes. Final code monitors physics signals and explicitly calls
`super._init()`; final native, Web and GLB tests confirm increasing ticks.

The deliberate script-replacement negative triggers one Godot error because its
old awaited coroutine loses its script instance. The native test retains this
exact error as negative evidence and accepts no other engine errors. It is not
reported as a clean gameplay success. Earlier failed output directories remain.

## Remaining scope

This is finite binding and door behavior evidence, not universal arbitrary-script
physical integrity. Another script acting entirely between samples or mutating a
script resource in place is not proven impossible. The profile does not audit
every native engine property. Custom movement, general navigation, reward/persist
scenarios, active LOD pixels, real player quality and a fresh complete ordinary
LPAC → core → automatic adoption run remain separate work. No new token, model
request count, player turn duration limit, input simulation or focus action was
introduced.

Contract: [creation-controller-binding](../vendor/pi-desktop/docs/spec/creation-controller-binding.md).
