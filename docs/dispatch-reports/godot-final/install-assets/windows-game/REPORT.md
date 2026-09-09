# Windows user-game export slice — 2026-09-10

Implemented fixed `exportWindows` in the existing LPAC/Job broker, an exact
Windows preset, verified extraction from the locked TPZ, artifact restrictions,
and an independent real-core/native-game acceptance script. No application
index, executor service, delivery pin or shared recovery code was changed.

Final authored acceptance: **4/4, passed=true**, temporary root
`C:/Users/WINDOWS/AppData/Local/Temp/windows-user-game-82xrpr`.
`native-final.json` is the complete unmodified report. The same report records
58 source files, revision 1, all source hashes, process identity, network
positive controls/refusal, cleanup, artifacts and both full runtime snapshots.
`broker-export-task.log`, `standalone-write.log` and `standalone-read.log` are
unmodified logs. Export log contains expected LPAC operating-system/socket
diagnostics; success does not mean zero diagnostic text. Native game logs have
no Godot errors.

Compiled broker SHA-256:
`ae2f834cccd2bdd3ce56dfb6ea58a9299d7ab339a2d3d8e8584db9c326dbb830`.
Core SHA-256:
`41d740d0b14cce18f4980b73c2e1485cba7a30fe18089acde76d0b0a9a5dfc81`.
This branch's recovery module predates the parent's latest recovery fixes.
The integrated product must compile/re-pin its own final broker; do not copy
this acceptance broker as the final product executable.

Negative Rust tests: modified template path and executable-resource setting
are refused; changed EXE and extra DLL are refused. Both pass. Fixed task
arguments test passes. Node syntax and Git whitespace checks pass.

Failures are retained, not rewritten: default child spawn EPERM; release EXE
refusal of unsupported `--path`; native-vs-JSON Variant dictionary inequality.
The diagnostic run showed no differing JSON field. Comparison now round-trips
the complete native capture through the actual JSON save representation and
still compares every field; final two-process Node deep equality omits none.

The EXE/PCK are a real exported authored training range, including real equip,
SaveStore and WorldState behavior. They are not a model-created project,
formal applied build, product export UI test or visible CP4 play acceptance.
User export service/UI and general managed-base standalone bootstrap remain.
The fixed authored EXE runs headlessly outside the editor/client with isolated
APPDATA; that is data isolation, not a sandbox for arbitrary native game code.
Godot notices accompany the test output, but no new base/module redistribution
permission is asserted. Plato confirms runtime staging already extracts the
Windows templates; final integration must verify their identity and rebuild
the broker pin.
