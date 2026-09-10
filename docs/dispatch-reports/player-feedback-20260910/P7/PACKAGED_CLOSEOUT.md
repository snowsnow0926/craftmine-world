# Frozen-package legacy recovery and retirement

Product source remained clean at `b9c0c0d5bdf371280d1a9814773d614e02920e16`.
The independently supplied build-manifest SHA-256 was
`82ff45ab47e683c35bba3a6f76b545cea27a1968b0c9381eae7d5f5f02c34284`.
The tested package is `0.14.4-preview.1`, under the root checkout's
`desktop/build/releases/b9c0c0d5bdf3-1b22d534-54c2-4a0f-80a6-1028eb4b0df6/output/win-unpacked`.
Package inspection verified its client, plugin, Core/host, source archive and
runtime inventories before execution; all new test data and temporary output
were on D. No input simulation, Pointer Lock, visible/focused window, model
request, user profile access, historical cleanup or frozen-product edit occurred.

## Legacy recovery: six stages passed

Raw run: `D:/cm-fb-20260910/test-results/desktop-native-lr-wD8aLi`.
The actual new package Core/executor checked a newly authored training-range
fixture containing only the pinned old bridge variation. A separate test app
compiled the frozen production host/adapter/coordinator. Its native detached
child sent `ready`, then really timed out on `load`, recording the zero-size
framebuffer message. The coordinator persisted an aborted application and
`GODOT_INITIAL_LOAD_FAILED` at `confirm`. This was not a synthetic failure.

The full package EXE then read that same failed world, explicitly retried it,
checked and applied a new candidate, rendered actual 1280 x 720 pixels, saved,
closed, reopened and compared the entire progress document. Both client closes
were zero with empty violations, pageErrors and shutdownFailures arrays.
The source revision advanced from 1 to 2. Of 66 indexed source files, only the
bridge changed from `318fdb30...` to `faf11c86...`; the old revision remained
readable and the old aborted application stayed identical. All 68 original
managed files stayed byte-identical. Capture inspection showed the actual
training range, targets, held weapon, crosshair and HUD; reported physical and
logical viewports were both [1280,720], with 1,634 sampled colors.

The failure fixture and recovery client deliberately use different rendering
modes. This proves actual native failure followed by actual offscreen product
recovery; it does not claim an offscreen child reproduces the native frame stall,
or that installed player worlds were migrated.

## Retirement: same bundled binaries passed

Raw run: `D:/cm-fb-20260910/test-results/p7-native-UsEoqi`.
The frozen production executor and actual verifier were compiled into a bounded
test app, using the verified package's Core, broker, broker identity and engine.
Broker SHA-256: `090d3f3e263a5cd82b5ddeea2f8aba590070b7a9c6489a419f4ebb1a25f303f7`.
Core SHA-256: `64cefac3080dea1f7a1c338008d317dccf7184e8fd91f4b9423fe2b0b8cf3ec0`.

Two successful jobs each completed real import, Web export and actual runtime
check. A third job's deliberate GDScript syntax error failed and retained its
binary copies. Four version preflights also succeeded. At all eight successful
task retirements, observed child/stdio close preceded the actual Core reply;
the binary copies still existed immediately before that reply. Only after
acknowledgment were the two task-owned binary files removed. Original remaining
file hashes and directory lists matched. A fresh executor construction then
left all 82 pre-existing retained files (260,677,476 logical bytes), including
the failed task, unchanged. Electron and Core both closed zero, without force.

Logical bytes retired: **1,453,367,360**. D volume free space was
177,685,987,328 before and 177,182,773,248 afterward: **-503,214,080 bytes**.
These measures are separate: new exports, retained failure output and concurrent
disk work prevent treating logical retirement as a net-volume-space result.

## Retained failed attempts and test-only corrections

All attempts remain separate in `package-evidence/index.json`; reruns are not
added together into a task pass rate.

- `legacy-retry-client-3fw4CV`: real native failure passed, but the full client
  rejected the driver's non-`desktop-native-*` profile directory; exit 1.
- `desktop-native-lr-d14mgf`: native failure and explicit repair reached durable
  ready, but the driver treated the brief pre-promotion "No world runtime is
  running" reply as terminal. Its premature quit encountered WORLD_BUSY and
  needed owned-process force; strict exit failed. The later run retained its
  120-second observation deadline and waited only this exact read-only absence.
- `p7-native-Yz62zl`: the test's strict path string comparison rejected forward
  versus normalized backslashes before spawning any broker. Normalizing the
  external driver's fixed package path corrected the fixture.

The successful legacy external driver SHA-256 was
`115ae57460be23f14affeeB55FAE2AC8A9C2AA33DFC64CC57D1A49E89CBEEEF1`
(hex case is immaterial). Its 303632b8 test-only correction follows the applied
application receipt to obtain the new candidate: Core's initStatus candidateId
enumerates ready candidates and can be null after application. External driver
bytes, original/relocated identities, raw reports, broker stdout, process logs,
and the actual game PNG are archived byte-for-byte in `package-evidence`.
There are 58 indexed files, totaling 3,235,294 bytes; full isolated source,
artifacts, task directories and database files remain at their original D paths.

Four contract tests and static fixture bundling passed. These are supporting
tests, separate from the actual runs above. Untested native follow-ups remain:
unknown/customized old bridge rejection and repeated repair after an already
confirmed application. Exact identity/CAS negative coverage is in Core tests;
this run did not invent more native fault cases or retry unknown process exits.
