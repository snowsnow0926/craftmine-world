# Final beb package: legacy failure, retirement success, bounded shutdown diagnosis

Product source remained frozen at `beb66d76c00a102c755ec7aeaed59b19cf5c68a9` in `D:/cm-fb2-20260910`. Independent build-manifest SHA256: `44295bd32541ce246465e6a491ef4d32d8f07c66bba2bbb2bc8e0382c5e964fe`. Package inspection validated source, app, plugin, Core, host, and runtime bytes before execution. Core SHA256: `476297048415332458e451aa2646f47b0fb57d98e76c8d5929645c8eb7fedd63`; broker: `bc37e2968aa92a36221299c9dff1499c60b683f89a4e9792b2f2cc1ba8191902`.

## Results are independent, not accumulated across reruns

- Legacy full-client run `desktop-native-lr-OmsTrR`: **5/6; overall failed**. The real detached hidden legacy fixture failed first load and persisted its aborted attempt. Explicit product recovery created revision 2, a new check/candidate/application, rendered the actual 1280x720 game, saved progress, and preserved old source/abort evidence. Restart reached the correct runtime and passed full snapshot equality, but its process then exited **2147483651 (0x80000003)**. Raw stderr contains `PostQueuedCompletionStatus: (6)` and the original system-encoded invalid-handle text. No forced stop occurred. Both exit audit messages had empty violations/pageErrors/shutdownFailures; the second OS exit still fails acceptance.
- Earlier `S1AjU5` and `HmTb2E` are retained test-readiness failures: redundant world.open during automatic reopen, then a premature navigation query before the view existed. Both stopped clients cleanly. They do not count as final legacy success.
- Package retirement run `p7-native-td1Ntt`: **passed**. Two actual import/export/runtime-check successes retired four task bins; four actual version preflights retired four more. Syntax failure retained its bin. Retirement occurred after observed process/stdio closure and actual Core acknowledgement. Fresh executor restart preserved all 82 existing files (260,677,501 logical bytes), including failure evidence. Core and fixture Electron exited zero without forced stop.
- Eight removed task bins totaled **1,453,367,360 logical bytes**. Observed free-space delta was **-808,423,424 bytes** amid concurrent runs and new artifacts. Logical deletion is not reported as measured disk-space gain.

## Test driver identity, not a product change

Readiness source correction is commit `553d0b6b718517556f12324075c31bd8516de8de`: wait for a real observation with the expected world and nonempty build/instance identity; accept only two exact no-runtime message variants as pending. Three bounded schema/error tests passed. Restart does not issue an unnecessary world.open. Frozen product files were not changed.

The external v3 legacy driver SHA256 is `1932a8d5278a10de11c2a0340a3edb25d0787ad5329bf6b5a2ed2c68f4de04d9`; helper SHA256 `20374aa0547a3a5b9adf23ae705bac0aead3165ae97f4038f84457606fa9f3aa`. Fixture production imports were compiled from frozen root2. The P7 external driver SHA256 is `78b9868b73ed82deebce875fff05adc10e9396862eea8805dacb7414d94b1ccd`: fixed paths use this package's Core/broker/identity/engine, not earlier debug binaries. Original and adapted drivers are archived with hashes.

## Bounded shutdown investigation

One completed minimum reproduction reused only the self-created OmsTrR profile: start the same verified package, wait for its actual automatically reopened world, read a snapshot, record status, request normal quit. `shutdown-minimal-5WYJsn` **passed**, exit 0, all three audit arrays empty. Audit arrived at 08:08:02.104Z, IPC disconnected at .107, stderr/stdout closed at .226/.227, and process exit/close arrived at .237. An earlier attempt `c6WYox` stopped on the test's empty-window readiness assertion before world observation; exit 0, retained separately. There were no repeated runs until green and no full legacy reconstruction during diagnosis.

The stderr format and breakpoint status are consistent with libuv's [Windows completion-post macro](https://github.com/libuv/libuv/blob/v1.52.1/src/win/req-inl.h#L66) calling its [fatal-error handler](https://github.com/libuv/libuv/blob/v1.52.1/src/win/error.c#L32), which prints the system error and invokes DebugBreak. This identifies a matching fatal path, **not a symbolized crashing call site or the package's exact bundled libuv revision**. Electron 43.4.0 [NodeBindings::StopPolling and WakeupEmbedThread](https://github.com/electron/electron/blob/v43.4.0/shell/common/node_bindings.cc#L502) include an async wakeup before joining the polling thread; without a native stack it is only one possible caller.

Frozen source review found these limits on the existing audit:

- `vendor/pi-desktop/apps/desktop/electron/main/index.ts:9873` waits for Core and the four collected service shutdown promises before releasing quit. No service timeout was recorded in OmsTrR's lifecycle log.
- `craftmine-headless.ts:69` sends the audit during will-quit; `:189` requests app.quit and `:201` asynchronously sends its request result. Neither message establishes native loop teardown or IPC completion. Strict process-close checking correctly caught the later failure.
- `plugin-view-host.ts:222/283` and `browser-view.ts:217` have void disposal that invokes WebContents.close without a destroyed promise. This is a weaker resource boundary than the Godot view barrier, but the current logs do not connect it to the crashing IOCP handle. Fresh fixture user MCP has no configured model/server workload; no personal configuration was read.

No precise resource owner was established. No speculative production patch, app.exit, sleep-based completion, relaxed nonzero assertion, or claim of an IOCP fix was made. Asset decoder/worker changes elsewhere cannot establish causality for this legacy path. The next frozen full-client acceptance must retain strict native exit checks. If the failure recurs, a same-owned-process native stack/minidump is needed to distinguish IPC, embed polling, and other completion users before choosing a native-lifecycle fix.

## Evidence

[Byte inventory and summary](final-package-evidence/index.json) records 64 copied artifacts, 2,908,598 bytes, with original absolute paths and SHA256. [Original failed legacy report](final-package-evidence/legacy-final/report.json), [raw second stderr](final-package-evidence/legacy-final/2-stderr.log), [retirement report](final-package-evidence/retirement-final/report.json), and [minimum reproduction](final-package-evidence/shutdown-minimal-5WYJsn/report.json) remain distinct. Source profile/DB/build outputs remain in their original D test directories; no player profile, credentials, real input, Pointer Lock, foreground window, or model request was used. Earlier b9 success is documented separately and is not inherited by this package.
