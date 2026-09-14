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

Before the worker amendment below, only an artifact-stage failure emitted one `[artifact-verification]` line into
existing diagnostics, before the ordinary failed phase line. Updating 4096 files
does not emit 4096 lines or evict the final state. Failure freezes the observation,
so late IO completion after timeout/cancel cannot overwrite recorded evidence.
The shared stop signal destroys the active read stream. An OS lstat already in
flight may settle later, but cannot then begin further IO. Success emits no
artifact-detail line.

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

During artifact verification only, one 100ms `unref` interval observes heartbeat
sample count and maximum overdue interval. It starts at the first artifact
operation and is cleared on completion, failure or cancellation. The final gap
is included even when the deadline callback runs before an overdue heartbeat;
zero samples plus a long gap must not be reported as zero scheduler delay.
No per-tick or per-artifact log is emitted and this timer does not keep the
process alive, extend the deadline or contribute to the verdict.

One additional `[artifact-verification-runtime]` diagnostic-only summary records
the heartbeat and start/end `process.getActiveResourcesInfo()` type counts. It
contains no resource objects, PID, paths, arguments or accounts. At most six
sanitized type names (32 characters each) per snapshot are retained, with omitted
type count; read failure is marked unavailable without its raw error. Successful
verification records this summary too, and releases the interval before later
runtime stages. A failure keeps the existing last-operation line plus this one
summary and the phase failure within the 64-line bound. These observations help
separate responsive-loop filesystem waits from event-loop delay; they do not
identify a root cause or prove the absence of other resource contention.

## Bounded large-block artifact reads (2026-09-14)

The subsequent ordinary `a61d14…` check timed out at 30.015 seconds while still
making progress: artifact 8/10 `web/index.pck`, expected 13,478,360 bytes, read
7,929,856 bytes (121 default 64KiB blocks), 156 heartbeat samples and maximum
lag 524ms. Both current-operation and last-byte ages were 2ms. This evidence
shows poor streaming throughput in that busy main process, not a fully stalled
read. It motivates fewer asynchronous read completions, not a longer deadline.

The read stream now uses an explicit bounded 1MiB highWaterMark. Every byte still
enters the SHA256 digest; root/entry/path lstat, no-link traversal, file type,
size and hash comparisons remain mandatory. No synchronous whole-file read,
sampling or partial hash is introduced. The original 30-second deadline and
outer cancellation race remain unchanged. A scheduling-delay test on the same
real multiblock input observes 52 read calls at 64KiB versus 7 at 1MiB, with
complete matching hashes in both cases; a same-size corrupt final byte fails.
This compares IO rounds, not a promised native speedup or a completed job pass.

The existing host stop controller is passed to createReadStream. `halt` aborts
with the original Error reason, and a stream AbortError is mapped back to that
reason so GODOT_CHECK_TIMEOUT/CANCELLED cannot become generic ABORT_ERR. The
stream is destroyed on exit. Cancellation/deadline checks before and after
non-cancellable lstat prevent opening the next path or file once it returns;
checks at each chunk stop further hashing after cancellation. Real-stream tests
verify destruction/close, partial byte progress and no next artifact.

## Independent artifact Worker (2026-09-14)

The following ordinary check still spent 21.277 seconds verifying artifacts;
runtime-server creation (465ms) and load (2.341s) then left insufficient time
for ready before the existing 30-second deadline. Full stat/hash verification
now runs on a fixed Node Worker entry with its own event loop. It reuses exactly
the above asynchronous checks and 1MiB bounded stream. The host still parses the
descriptor and retains its original deadline race; the worker receives that same
absolute deadline. No deadline, hash, link, size or readiness requirement changes.

Electron-Vite emits `godot-artifact-worker.js` beside the main entry. The private
host passes only an attempt/job/world/build/input-hash binding, the validated
root/artifact descriptor, and the deadline. The worker validates them again. Its
environment and exec arguments are empty; it imports no Electron main code and
does not execute world source. This is not a renderer, plugin or model RPC.

Success requires one matching result with complete byte/file coverage and an
observed code-zero worker exit. Foreign, oversized, duplicate or incomplete
results, excessive progress, worker errors and silent exits fail. Cancellation
or timeout terminates the worker; the worker also independently aborts its stream
at the shared deadline. Host completion waits for exit, including failures after
worker construction. Failure to confirm termination within five seconds records
`GODOT_CHECK_ARTIFACT_WORKER_STOP_TIMEOUT` separately from the initiating failure,
sets `exitConfirmed: false`, and prevents that verifier from starting more workers.
Cleanup time does not extend the check's acceptance deadline. No late success can
turn a timed-out check into a pass.

The worker sends one initial observation, at most one periodic observation per
250ms, and one final result. Its 100ms heartbeat/resource-type tracker remains
local to the artifact phase. The host retains only the latest validated snapshot
and adds its own 100ms unref heartbeat plus lifecycle timings. Three bounded lines
at most are added at teardown: `[artifact-worker]`, latest artifact progress, and
latest artifact runtime summary. They retain phase failures within the existing
64-line log and contain no absolute root, raw exception, environment, PID or
account data. A terminated worker may have only a previous `running` snapshot;
that is explicitly not a final measurement. No response is reported as missing,
not fabricated zero-byte progress. All timers/listeners are disposed on exit or
the explicit unconfirmed-stop path.

`tests/godot-artifact-worker.test.mjs` compiles the actual worker and dependency
chunks, verifies full real files and rejection/exit boundaries, and packages that
same compiled entry into ASAR for an Electron Node-only load check. These tests
open no app window, GPU or model. The next ordinary packaged old-profile check
must establish real performance and gameplay readiness with its own job evidence;
isolated worker timings do not certify the native client or erase prior failures.
