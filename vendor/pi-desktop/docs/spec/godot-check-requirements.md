# Finite Godot runtime check requirements

Status: implemented core and executor transport. Actual observations belong to
the isolated native verifier. This extends the existing build/check workflow.

## Input and identity

The private `godotBuild.start` request may include:

```json
{"checkRequirements":{"format":"craftmine.godot-check-requirements/1","targetFeedback":{"targetId":"target_a","hitFlashMilliseconds":500}}}
```

Only a `first-person` source project with `mode: "check"` accepts this finite
requirement. Exactly one target is supported. Unknown keys are rejected; the
target ID matches `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`, and milliseconds is an
integer from 1 through 1000. The field is optional for older jobs. There is no
arbitrary expression, path, script, command, or caller-defined comparison.

Core computes `checkRequirementsHash` as SHA-256 of these exact UTF-8 bytes,
with LF separators and a final LF:

```text
craftmine.godot-check-requirements/1
target_a
500
```

The decimal integer has no sign, whitespace, or leading zeroes. This is not
JSON canonicalization. The existing start request hash binds the entire
request, including requirements. Changing an expectation while replaying a
tool call conflicts. Build identity continues to identify immutable source;
requirements belong to the job and its check input, not a different source.

The nullable `check_requirements` and `check_requirements_hash` job columns are
written in the same SQLite transaction as the job and start receipt. Read,
claim, start receipt, and private check descriptor expose the pair only when
present. Each read validates shape, scope, and hash. Continuation copies the
pair to its new job; it cannot become an unqualified check after cancellation,
failure, or restart. Domain and portable backups retain these columns; older
archives receive only the explicitly allowed NULL defaults.

## Descriptor and runtime result

`godotJob.checkDescriptor` resolves requirements from the claimed job, verifies
the staged artifact bytes, and freezes them in the existing hashed check
descriptor. The executor refuses an unavailable, missing, or mismatched core
descriptor for a job with requirements. The historical descriptor fallback
is used only for jobs without requirements.

After loading the exact candidate and after the ordinary running/frame check,
the verifier samples the existing `observe-envelope` target feedback contract.
It verifies world, build, live instance, target identity, and the supported
base contract before recording actual values. The target feedback contract is
currently `fp.target.feedback/1`, first-person base version `0.1.0`.

The verifier returns the required assertion and evidence; the executor forwards
them in `output.check` of the existing `godotJob.finish` call:

```json
{
  "assertions":[{"id":"runtime.target-feedback","passed":true}],
  "requirementsEvidence":{
    "format":"craftmine.godot-check-requirements-evidence/1",
    "requirementsHash":"<core hash>",
    "jobId":"<claimed job>","worldId":"<world>","buildId":"<build>",
    "instanceId":"<observed live instance>",
    "observations":[
      {"phase":"loaded","targetId":"target_a","hitFlashMilliseconds":500},
      {"phase":"running","targetId":"target_a","hitFlashMilliseconds":500}
    ]
  }
}
```

Success requires exactly these two phases in order, exactly one passing
`runtime.target-feedback` assertion, a portable instance ID matching the same
128-character identifier rule, and a proof bound to the immutable descriptor's
job/world/build/requirements and finish artifact list. Actual milliseconds must
be finite and differ from the expected integer by at most `1e-6`, a fixed
conversion tolerance. Preserve the original observed number; do not round or
substitute expectations. Unknown evidence keys, partial samples, duplicates,
and mixed identities cannot pass. Failure may retain only actual samples.

## Durable rejection and replay

Core appends `core.target-feedback`, recording its independent binding verdict.
An absent, false, duplicated, or mismatched runtime proof normalizes the whole
check and job to failed. The existing check transaction creates a **rejected**
candidate, which application prepare refuses. It never updates formal progress.
Normalization occurs before terminal output comparison, so retrying the same
original finish request after losing its reply returns the same failed receipt.
Invalid outer wire data, artifact bytes, or worker tokens retain their existing
errors. Valid additive progress evidence can remain alongside a failed
requirement; it cannot authorize a rejected candidate. Its own shape and
preservation proof remain checked. Jobs without requirements keep their behavior.

## Limits and evidence

The registered isolated executor remains trusted to report runtime observations.
Core binding detects omitted or mixed proof; it does not replace executor
isolation and artifact verification. Two bounded samples detect initialization
and sampled running overrides, not every future timer or arbitrary malicious
script behavior.

Core SQLite tests use authored executor evidence and actual artifact files.
Executor protocol tests use an explicit broker/core stand-in. Neither is native
engine acceptance or a model run. Native and full client acceptance must
separately demonstrate 500 passing and a source declaring 500 but live scene
overriding it to 700 failing the whole check, with no appliable candidate.
