# Frozen b9 pre-model acceptance failures

Source/package: `b9c0c0d5bdf371280d1a9814773d614e02920e16`.
Both actual attempts below completed strict owned shutdown with zero process
exit and empty input, page-error and shutdown-failure arrays. Actual upstream
model requests remain **zero**. The authorized credential file was not reached.

1. `D:/cm-fb-20260910/test-results/desktop-native-p8-DxkWqW/report.json`:
   the headless notification preceded Main window readiness. The first options
   query returned `Window is not ready`; the original driver correctly stopped
   rather than hiding an unknown failure. Early shutdown then caused the boot
   log's `host-core disposed`; this is not a separate proven backend defect.
2. `D:/cm-fb-20260910/test-results/desktop-native-p8-cObrPF/report.json`:
   the explicitly recorded ignored runner adds bounded actual Main/backend
   readiness and preserves all package checks. Both actual first-person and
   top-down worlds completed materialization, source registration, broker build,
   check and load. Main helper then rejected `P8_READY_BASE_REQUIRED` because its
   fixture incorrectly assumed the raw private plugin world list carried the
   navigation-only `state` field. This is an acceptance-helper integration defect,
   not a model or generated-content failure.

The second runner SHA is
`0d4e556dfde15575a0966fd55ccfc6aaba71ba82a0d33039fcac3fc6a3ebaa8d`;
its exact provenance is `test-results/p8-runner-startup-fix/runner-proof.json`
under the integration root. No sealed package bytes were changed.

Correction: check raw `runtimeKind/baseId`, then the actual matching Godot
observation world/base/build/instance before provider creation. Offline tests use
the real raw-list shape and reject absent or mismatched observations. Current
preflight is 12/12 and strict helper TypeScript passes. Existing provider create,
session configure/get and prompt response shapes were checked against host-core
RPC dispatch and Main; candidate list/read/preview/close/apply shapes against
actual core/coordinator code. These checks do not claim the new helper has run
inside a rebuilt package yet.
