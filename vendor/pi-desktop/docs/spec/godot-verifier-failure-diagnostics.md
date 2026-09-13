# Bound verifier failure diagnostics

The executor keeps the real verifier's terminal error in an additional
`runtime.verifier-error` assertion on an already failed check. It requires the
`craftmine.godot-runtime-check/1` base-startup format/scope, `passed: false`, and
exact job/world/build/input-hash agreement with the native claim. Successful or
foreign evidence does not create this assertion. Existing assertions and all
check/job verdicts are unchanged.

Only the existing native assertion `id`, `passed`, and `detail` fields are used;
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
hash-bound native evidence. Full runtime diagnostics and frame files remain in
their original private checker reports; this change does not add them to the
native output schema or retrospectively change failed checks.
