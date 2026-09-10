# Finite live target feedback observation

The shared first-person adapter adds one optional read-only observation field:

```json
{"targetFeedback":{"format":"craftmine.target-feedback-observation/1","targets":[{"targetId":"target_a","hitFlashMilliseconds":500}]}}
```

It is inside the existing `observe-envelope.payload`; the bridge retains its
world/build/instance/base/version/sample identity. No generic property query,
script execution, path selection or write operation was added. Only live nodes
in the current world's subtree, in `base_targets`, with the exact loaded
`scripts/core/target_dummy.gd` script are included. The observer reads two fixed
properties. The limit is 256 targets, and IDs must be unique portable strings.
Finite whole milliseconds must be in 1–1000. Invalid data returns the same
format, an empty `targets` list and one fixed `error` code, never partial data.

The JS envelope validator validates the optional shape but continues accepting
older envelopes without it. A valid unavailable/error shape is not evidence of
a parameter value. `assertTargetFeedbackObservation` in
`tests/player-product/target-feedback-observation.mjs` rejects missing/error
data, wrong runtime identity and wrong values. Root's actual-client test can
call it before and after its real adoption/restart flow with expected 500 ms.

## Actual evidence and the remaining product failure

- Unit tests: 12/12 (3 new finite-observation/candidate checks plus 9 existing
  observation and bounded-operation checks).
- `target-feedback-observation-x075sq` (final source; earlier `Jcisyt` retained): real managed training-range source
  patched to 500 ms, loaded twice in fresh Godot headless processes. Shared
  observer checks passed, but **parameter acceptance failed**: runtime was
  120 ms both times. `BalanceProfile.apply_to` unconditionally overwrites target
  instance durations during `BaseWorld._ready`. The test remains strict and
  exits nonzero for this official scene. It must not be counted as PP2 success.
- `target-feedback-observation-27Gkdc`: the explicit
  `--isolate-balance-profile-fixture` source variant sets the test scene's
  `balance_profile` to null. It proves the observer sees actual 500 ms after
  first load and a new process reload, unchanged other payload and progress,
  exclusion of unrelated-world/unknown-script nodes, and eight invalid-runtime
  cases per phase. No shipped base script was changed. This variant isolates
  the observer and does not prove the shipped training template is fixed.
- Earlier raw failure `KtkgIy` exposed the 500/120 mismatch. `BwFpYo` also
  showed that the fixture must bind the bridge's world identity before testing
  that subsequent observations do not mutate progress. That fixture setup was
  corrected; validation was not loosened.

Native harness: `tests/player-product/target-feedback-observation-native.mjs`.
It never drives input or invokes a model. Negative cases deliberately alter
invalid live fixture values; they are not success evidence for the authored
500 ms value. Successful observation comes from source-loaded nodes before
these injections. Complete Electron adoption and saved-profile restart remain
root integration work. The default native harness must pass without the
isolated-profile flag before claiming the training-range parameter works.

## Candidate response shapes

`godot.candidateList` returns `{items, nextOffset}`. Each item has
`candidateId`, `worldId`, `buildId`, `sourceRevision`, `content`
(`repoId`, `branchId`, `contentOid`), manifests, `baseId`, `baseBuild`,
`checkJobId`, `checkOutputHash`, `status`, build counts and timestamps.

`godot.candidateRead` returns `{candidate, check, job, checkStatus, buildId}`;
`job` here is **the job output**, not the row containing `jobId`. `check` is
that output's check result. Obtain the candidate from the completed parameter
operation's `status.job.candidateId`, then verify `candidate.checkJobId` equals
`status.job.jobId` and world/build identity agrees. Never choose the first
candidate-list item. The helper `candidateFromTargetFeedbackStatus` implements
these checks without applying anything.

## Distribution refresh required

Root staging must refresh `desktop/delivery/base-assets/shared-runtime.json`
entries `adapters/first-person.gd`, `observation.mjs`, and `observation.d.mts`
with the merged Git bytes/hashes, then build from that same committed source.
No root cache or pin manifest was modified by this isolated task. An old export
will honestly lack this observation; reading current source is not a substitute.
