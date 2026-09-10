# VM2 explicit package mode prepared

Base: 6a0b88b. Independent tree `C:/cm-plan-vm2-package-20260910`.
Only test support and its specification changed; no production files changed.

The existing nine actual Main/React comparison, source rendering, world-change
refusal, real parameter check/application, formal-view invalidation, read-only
full-progress/currentHash/task checks and strict shutdown assertions are retained.

Package mode requires explicit packaged root, expected commit and build-manifest
SHA256. The source root remains explicit, clean and equal to the expected commit.
The shared strict package inspector runs before fixture core startup and each
client startup. Package mode uses only the bundled EXE, core, host, CoreClient and
Godot resources; the dependency directory provides ASAR inspection tooling only.
There is no development-binary fallback. The explicitly authorized completed core
archive is still inventoried, copied alone, and checked unchanged after the run.
Reports explicitly identify packaged versus development execution and actual hashes.

Validation: syntax check passed; 12 tests passed in `tests-rerun.log`, including
real ASAR/filesystem tamper fixtures. The first combined invocation omitted the
required explicit ASAR-tool directory and failed; `tests.log` preserves it. It
did not launch an engine or client. The rerun supplied
`CRAFTMINE_TEST_DESKTOP_DIRECTORY=C:/cm-plan-next-20260910/vendor/pi-desktop/apps/desktop`.

No native client or Godot was launched for this change. Await the new frozen
package before claiming its VM2 acceptance. The earlier 774a345 9/9 run remains
development-client evidence only. Command and required arguments are documented
in `vendor/pi-desktop/docs/spec/godot-version-diff-desktop-acceptance.md`.
