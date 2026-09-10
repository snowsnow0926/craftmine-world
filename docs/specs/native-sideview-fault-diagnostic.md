# Independent native side-view fault diagnostic

This branch is diagnostic-only and must not be merged into a release: the
engine task's existing `diagnose` flag enables CREATE_SUSPENDED plus
DEBUG_ONLY_THIS_PROCESS. The existing creation-time Job, LPAC capability set,
private desktop, fixed engine pins and pre-resume verification remain intact.
The native network preflight is unchanged. Only the exact created process is
observed; there is no process discovery or attachment API.

The loop records the actual exception code/address/parameters and thread ID.
Only its first loader breakpoint is consumed. Subsequent breakpoint/access
violations are passed as DBG_EXCEPTION_NOT_HANDLED after at most two local
minidump/stack capture attempts. Event processing has 120-second and 8192-event
bounds. Thread/process handles delivered by debug events are borrowed until
ContinueDebugEvent closes them; only image file handles are explicitly closed.
See [Microsoft's event ownership contract](https://learn.microsoft.com/en-us/windows/win32/api/debugapi/nf-debugapi-continuedebugevent).

The fixed driver copies the exact manifest-verified side-view source from the
failed b6 test world, runs one import and one export, and rechecks every source
byte afterward. It neither applies a result to a world nor retries for green.
A failure stays failed; lack of a fault while debugging does not prove repair.
All output and optional symbols are on D; there is no upload, real input,
Pointer Lock, focus change, personal profile read or global WER setting.
