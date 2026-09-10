# Third 570 package: shutdown failure recurs, retirement passes

Frozen product: `D:/cm-fb3-20260910`, commit `570fed344ee775aa0cc8d4ef7d096bce96e1cc5f`. Independent build-manifest SHA256: `f802fc7b23b350a0f6c5d4a6ac3cde9272da33ae9f5b26bccfb12efdb040f0c8`. Package inspection checked the source archive, application, plugins, Core, host and runtime before execution. No tracked root3 file or HEAD was changed.

## Uninstrumented acceptance remains failed

The unchanged tracked `tests/player-feedback/P1/legacy-retry-client.mjs` ran against the actual new package in `desktop-native-lr-EyRddm`. **5/6; overall failed.** Real legacy failure persistence, explicit new candidate/check/application, actual image capture, first save/exit, and preservation of old source/aborted application passed. Restart's complete snapshot comparison also passed, but its strict process-close assertion failed: second client exit **2147483651 (0x80000003)**, no signal or forced stop. The first exit was zero. Both emitted empty violations/pageErrors/shutdownFailures. Second stderr again reports `PostQueuedCompletionStatus: (6)` with the original system-encoded invalid-handle text.

This is a second frozen package exhibiting the same native exit failure after the full legacy restart. The earlier beb failure is retained separately. Asset worker fixes in the new package do not explain or clear this result. The raw failure is [here](third-package-evidence/legacy-uninstrumented/report.json); [stderr](third-package-evidence/legacy-uninstrumented/2-stderr.log) remains byte-exact.

## Bounded debugger investigation, not a replacement release result

The parent explicitly authorized one existing synthetic-profile minimum reproduction and, if that did not reproduce, one complete legacy pipeline with an attached native debugger. The helper verifies the runner's exact child PID, executable path/hash, creation ticks, parent PID and owned headless profile marker before DebugActiveProcess. It does not change WER, registry, firewall, input, focus, or player profiles. DebugSetProcessKillOnExit(false) avoids terminating the target merely because the diagnostic helper exits. The initial debugger attachment breakpoint is continued; subsequent exceptions remain NOT_HANDLED after bounded capture attempts. Only exception diagnosis would write a minidump/thread module offsets; the helper has a five-minute event-loop deadline.

- `shutdown-debug-Pmixr0`: diagnostic preparation failed before attachment because Windows PowerShell inherited a module path that could not resolve Get-FileHash. The runner recorded its bounded attachment timeout and exited the client normally (0). This is not a product pass. The helper subsequently uses its own PSHOME/Modules in its own process; no machine configuration was changed.
- `shutdown-debug-9uXe5H`: actual attachment to the original EyRddm self-created profile; automatic runtime reopen, snapshot and strict quit passed. Client/debugger exited zero. Only the expected initial attachment breakpoint occurred.
- `desktop-native-lr-KIeKIb`: the sole complete diagnostic replay, with debugger attached to each of its two actual package clients. **6/6 under instrumentation**, clients and debuggers exited zero, audits empty. The first client also emitted a handled thread-name debug exception; no subsequent breakpoint fault occurred. There is **no fault stack or minidump**, and the helper's exception-capture branch was not exercised. The original uninstrumented 5/6 remains failed.

Attaching a debugger changes scheduling. This observation does not establish the precise native handle owner or prove a fix. No broad lifecycle changes, app.exit, sleeps substituting for completion, ignored nonzero status, or further reruns until green were introduced. The prior [source investigation](FINAL_BEB_PACKAGE.md) explains why will-quit audit receipt precedes native process termination. The independently reported browser/plugin view destroyed-barrier gap remains a separate demonstrated resource-lifetime issue; these results do not prove it caused this IOCP failure.

The helper SHA256 used in the real attachment runs is `59378984e61eaf2f99be4a3a09fec0ac18e0db55b2b541f2ec7053a2bc14df2f`. The archived external driver and helper records contain exact PID/creation/executable binding, original frozen tracked-driver SHA and all adaptation hashes. This diagnostic tooling is evidence under this report, not a new public application API.

## P7 on this package passes independently

`p7-native-LSat57` used the package's Core (`693232db8290bf6affbc4d2f2bd5e4320b7d8db5cb9df26ef9d0264a662a997d`) and broker (`112c299d87faac854f8f486db8c2c6bfb2932d6070c5b884564522fb4d7b825e`), its pinned engine and identity. The fixture bundled the frozen root3 production verifier and used frozen executor modules. The allowed external path adaptation SHA256 is `7b83ccd96dd91fabdcdac24e85c84e74cd621506683534b7e06f94cb5edcce76`.

Two actual import/export/runtime-check successes plus four preflights retired **8 task bins**, only after process/stdio closure and Core acknowledgement. A real syntax failure retained its bin. Fresh executor restart preserved **82 files / 260,677,491 logical bytes** including failure evidence. Core and fixture Electron closed with exit 0, no forced stop. Retired logical bytes: **1,453,367,360**. Observed D free space changed from 162,710,163,456 to 162,201,686,016 bytes (**-508,477,440**); concurrent/new artifacts mean this is not reported as a measured space gain.

## Evidence and boundary

[Index](third-package-evidence/index.json): **66 files / 2,228,903 bytes**, each with original path, length and SHA256. Original full profiles and build outputs remain under D test-results. All owned test/debugger processes ended. No credentials, model requests, user profiles, simulated input, Pointer Lock or foreground test windows were used. The final package's legacy acceptance is blocked by the uninstrumented native exit failure; retirement success and instrumented success do not overwrite that outcome.
