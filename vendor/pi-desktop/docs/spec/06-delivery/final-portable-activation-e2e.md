# Portable backup activation acceptance

Automated entry: `node tests/godot-final-install-assets/portable-core.mjs`.
Set `CRAFTMINE_CORE_BIN` to the built core containing `backup.restoreProof` and
`CRAFTMINE_DEPS_ROOT` to the installed agent-runtime package for esbuild.

Given a new isolated profile with a world, managed source body and Git history,
export through the native backup service with a test-only file picker. Inspect
the header and verify all bodies before issuing an opaque grant. Restore that
grant into the controlled sibling profile and prove the committed restore
identity before publishing its pointer. Reconstruct CoreClient using the
original data root: it must use the restored profile and read the original
source after explicit task recovery. Concurrent callers during a transition
must reject. Inject failure starting the next restored profile: the previous
core and pointer must recover, and both original/restored directories must
remain. A forged pointer path must reject.

Production follow-up: run the same operations through the full Electron
navigation and lifecycle callbacks, keeping all old runtime writes stopped
until the selected world is rebound. No mouse/keyboard/focus/Pointer Lock or
live user profile is permitted for automated acceptance.
