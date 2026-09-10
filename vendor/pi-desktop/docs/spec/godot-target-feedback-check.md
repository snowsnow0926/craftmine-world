# Finite target-feedback runtime requirements

The private runtime-check descriptor may carry `checkRequirements` and
`checkRequirementsHash` together. The only supported contract is
`craftmine.godot-check-requirements/1` with one `targetFeedback` containing an
ASCII stable target ID and integer `hitFlashMilliseconds` from 1 through 1000.
Unknown fields, unsupported bases, partial pairs and invalid hashes are rejected
before creating a check window. The SHA-256 input is the UTF-8 string
`craftmine.godot-check-requirements/1\n<ID>\n<integer>\n`.

The actual verifier requests `observe-envelope` from its own live runtime after
loading/restoring state, and again after resuming and capturing three real
frames. Both observations must bind the job's world/build and the verifier's
instance, first-person base version 0.1.0, and the fixed bounded target-feedback
shape. Duplicate/missing IDs, error observations and non-finite values fail.
Actual values are preserved without rounding; tolerance is at most 1e-6 ms.
No parameter write, source-value fallback or state substitution is permitted.
These two samples cover the bounded check window, not all future script behavior.

`requirementsEvidence` records the requirements hash, job/world/build/instance
and ordered `loaded` and `running` observations. The additional assertion
`runtime.target-feedback` participates in the overall check result. A failure
may contain only the observations actually obtained. It cannot manufacture a
passing pair. Existing descriptors without requirements retain their existing
assertions and behavior.

The Rust descriptor binding and executor/core finish gate are separate required
parts of the production trust chain. Unit tests here exercise the real verifier
class with transport/Electron substitutes, and do not prove that complete chain
or real rendering. Native fixture evidence must be reported separately.

Validation: `node --test tests/player-product/target-feedback-verifier.test.mjs`
with `CRAFTMINE_NATIVE_DEPENDENCY_ROOT` pointing at an installed dependency tree.
