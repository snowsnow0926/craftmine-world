# Cycle 3 failed attempts

These are retained failures, not successful acceptance evidence.

- `source-tools-dependencies.log`: esbuild was absent from the primary checkout. Dependencies were installed offline in this cycle's worktree.
- `source-tools-page.log`: the test used an out-of-range fixed Unicode offset. The corrected test locates the first Chinese character and reads `花草 🌱`.
- `source-tools-recovery.log`: the test omitted the existing explicit recovery transition after core restart. The corrected test first asserts `EXPLICIT_RECOVERY_REQUIRED`, then uses the actual trusted-host task.resume protocol before reading the retained source.
- `private-desktop-attempt.log`: named window-station creation returned OS error 5.
- `private-desktop-unnamed-attempt.log`: exclusive creation of a system-named station returned OS error 183 (already exists).
- `private-desktop-session-station.log`: opening the noninteractive session station and creating a private task desktop succeeded; relabeling the newly created work directory returned OS error 5. No child started.
- `private-desktop-medium-work.log`: final design reads (does not modify) the work integrity label, verified Medium. The native child still exited before main with `0xC0000142`.
- `loader-diagnostic.log`: the same restricted fixed child under bounded DEBUG_ONLY_THIS_PROCESS logged its image, ntdll, kernel32 and KernelBase, then the same exit. Last-loaded DLL is not proof of the failing DLL or root cause. No application output or boundary assertions ran.

All cycle-3 sandbox attempts deleted their temporary AppContainer profiles (HRESULT 0). Opened station/private desktop handles were closed and helper associations restored. No existing station/default-desktop ACL or user input was changed. The initial proposal to require Low IL on the work directory was corrected using Microsoft's AppContainer documentation: explicitly package-authorized resources at Medium or lower are eligible for access. The real positive file-write test remains required and has not executed.

A build logging command also used an incorrect relative destination before the recorded successful build. That failed capture is not counted as a successful build. An ordinary sandboxed Node test launch returned spawn EPERM before test execution; the precisely scoped independent process test was then approved and run.
