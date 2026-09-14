# Bound verifier failure diagnostics

The executor keeps the real verifier's terminal error in an additional
`runtime.verifier-error` assertion on an already failed check. It requires the
`craftmine.godot-runtime-check/1` base-startup format/scope, `passed: false`, and
exact job/world/build/input-hash agreement with the native claim. Successful or
foreign evidence does not create this assertion. Existing assertions and all
check/job verdicts are unchanged.

The failure assertion uses the existing native `id`, `passed`, and `detail` fields;
the strict Rust job-result schema does not admit the entire runtime object.
Detail retains at most 512 Unicode characters of the actual error, normalizes
invalid surrogates, strips controls and marks truncation explicitly. It is diagnostic text, never a
path, tool instruction, application authority or substitute check result.
The ordinary native finish persists and hashes the output; build-read projects
the assertion with its original source identities, evidence pointer and
`trust: untrusted-data`. An exact error code such as
`MIGRATION_CREATION_STATE_INVALID` therefore survives projection instead of
appearing only as secondary unconfirmed-snapshot/zero-frame symptoms.

Previously finished job outputs remain immutable. Errors already discarded
from those outputs cannot be reconstructed by build-read. Historical executor
ledger reasons and separate verifier reports are not silently promoted into
hash-bound native evidence. Frame files remain private; no prior result is rewritten.

The optional `check.diagnosticLog` now retains a selected JSON text log of native
observations (`craftmine.godot-runtime-diagnostic/1`, `diagnosticOnly: true`). The
executor requires the same base-startup format/scope and exact job/world/build/
input-hash binding. It includes terminal error, ready status/instance ID, actual
offscreen/focusable/visible flags, runtime/console/renderer errors and page probes.
This log is untrusted diagnostic data, never an assertion, candidate authority or
gameplay acceptance. Successful and failed checks retain their original verdicts.
Build-read returns the log through the existing immutable output and output hash.

Before each artifact verification, runtime-server creation, window preparation,
navigation and ready handshake, the verifier records a phase start; completion
and failure carry total and phase elapsed milliseconds. A final runtime-check
phase covers subsequent checks. Phase completion means that step returned; it
does not imply that the check passed. A zero-frame timeout before window creation
is distinguishable from a created offscreen window waiting for ready. The existing
30-second check deadline, readiness, isolation, source and scoring checks remain
unchanged. Teardown time is not relabeled as startup time.

Core accepts only an optional string of at most 65,536 UTF-8 bytes. The executor
keeps at most 16 runtime and 16 console messages, 64 diagnostic lines, and 1,024
UTF-16 code units per text value; it marks truncation and drops the newest tail
to fit the total bound. Phase observations precede ordinary probe lines to retain
the failed phase under heavy console output. First causes have priority. Common
credential forms, local absolute paths and URL paths/query strings are redacted;
source-relative `res://` locations remain useful. This is a selected log projection,
not a dump of renderer objects, descriptors, environment or credentials.

Automated verification: `tests/godot-runtime-diagnostic-log.test.mjs`, executor
protocol tests and Core `diagnostic_log_tests`. Packaged E2E: run an ordinary
check/resume in an isolated profile, retain its exact `outputHash`, and compare
the diagnostic-only log with passive CDP observations. A failed check must retain
its original result; a successful resume must receive its own job and evidence.
Do not edit old outputs or treat mock stage tests as a real packaged check pass.

## Artifact await diagnostics (2026-09-14)

A real failed check stopped in artifact-verification after 30.141 seconds, before
the runtime server existed. To identify the pending filesystem operation,
`godot-artifact-verification.ts` retains one in-memory observation while running
the original asynchronous lstat, no-link traversal, file type, size and streaming
SHA256 checks. No check is removed, no synchronous IO substitutes them, and the
existing verifier cancellation/deadline race and 30-second default stay intact.

The observation distinguishes root-lstat, entry-lstat, path-lstat, size-lstat,
size-compare, stream-open, stream-read, hash-update, hash-digest and hash-compare.
It includes the relative artifact/path, one-based artifact index, total/verified
file counts, expected bytes, bytes read for this file and all files, total and
current-operation elapsed time, and time since last byte progress (or tracking
start when no bytes have arrived). Hash operations are synchronous markers
within the unchanged streaming algorithm; they are not claimed to be awaits.

Only an artifact-stage failure emits one `[artifact-verification]` line into
existing diagnostics, before the ordinary failed phase line. Updating 4096 files
does not emit 4096 lines or evict the final state. Failure freezes the observation,
so late IO completion after timeout/cancel cannot overwrite recorded evidence.
This does not change or claim to cancel underlying OS IO that the existing race
has already stopped waiting for. Success emits no artifact-detail line.

Only relative labels (`.` for root) are retained; labels longer than 96 Unicode
code points are abbreviated with an ellipsis. Absolute IO filenames and raw OS
error strings are never copied into this line. Error codes preserve timeout,
cancellation, missing/invalid files and mismatch; size-compare and hash-compare
distinguish two failures sharing the existing mismatch code. This remains
diagnostic-only, not a new acceptance assertion or a fix for the stall.

`tests/godot-artifact-verification.test.mjs` covers real async files, missing,
wrong size/hash, directory links, separately suspended lstat calls, unopened and
partially read streams, cancellation, frozen late progress and bounded logs.
No native client or model run is implied by these isolated tests.
