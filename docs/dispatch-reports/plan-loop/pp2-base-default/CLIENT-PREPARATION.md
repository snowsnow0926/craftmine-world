# Actual client default-button acceptance preparation

This follow-up prepares next-cycle acceptance on top of d34420d. No client build,
installation, native run or release was performed for this follow-up. It remains
outside the current frozen release. The earlier native-final report is fixed Godot
configuration evidence, not a result for this new full-client runner.

Production changes are restricted to a submit-button data marker and a headless-only
controller branch delegating to craftmine-target-feedback-acceptance.ts. Input is
exactly action/worldId and, only for select, targetId. Actions are open/read/select/
useDefault/submit/close. Selection must match an actual DOM option. The helper uses
fixed form requestSubmit, fixed library/world navigation, current world identity and
the existing headless guard. No arbitrary script, selector, property value or RPC is
accepted. No mouse, keyboard, focus or Pointer Lock is introduced. Main index stays
untouched.

The standalone runner target-feedback-default-client-native.mjs preserves the original
strict development/package distinction. It establishes a checked adopted500 fixture,
then drives the actual default button. Complete JSON progress, domain backup hash,
source head/applied OIDs and operation journal must remain unchanged by filling.
Actual DOM submission must create one exact original operation. Check evidence must
bind loaded/running default values, world/build/job and requirements hash. Preview
cancellation preserves formal500 and progress. Real fixed gameplay then creates newer
progress; adopting the default must preserve that latest state and other target values.
A fourth process start verifies the value and every saved field; all four exits require
empty violations/pageErrors/shutdownFailures and code0.

Prepared validation:

- Finite helper VM/control fixtures: 4/4, including unknown actions/data, unobserved
  target, disabled/hidden/detached form, missing guard, and world change while awaiting
  navigation. These execute the compiled helper with controlled DOM doubles.
- Existing actual production workbench DOM regression: 10/10, isolated headless browser
  and fixed transport. Raw result: ui-probe-preparation/report.json.
- Targeted helper TypeScript noEmit and native-runner syntax checks pass.
- Shared package identity/environment suite: 7/7; no package launch.
  First invocation lacked its explicitly required ASAR tooling environment and failed
  before fixtures. The corrected invocation sets only the read-only tooling path.

After integration, commit/build/stage the same clean source first. Do not run this
script against an old compiled client or a package without targetFeedbackView.

Development command (PowerShell):

    node tests/plan-loop/target-feedback-default-client-native.mjs --source-root <absolute-clean-source> --runtime-source <same-source> --deps-app <desktop-dependencies>

Packaged command:

    node tests/plan-loop/target-feedback-default-client-native.mjs --source-root <matching-clean-source> --packaged-root <sealed-extracted-payload> --expected-commit <independently-supplied40hex> --expected-build-manifest-sha256 <independently-supplied64hex> --deps-app <ASAR-tooling-only>

The packaged branch revalidates identity at each launch, runs only bundled binaries,
and removes inherited development runtime overrides. Outputs use a fresh ignored
profile under the source tree's test-results; preserve all failures and finished data.
