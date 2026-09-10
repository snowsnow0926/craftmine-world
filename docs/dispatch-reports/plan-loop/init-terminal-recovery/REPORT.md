# Terminal initialization recovery correction

Base: `c4af0d28492980697c3ca89bf595ae1c8fa6bffc`.
Worktree: `C:/cm-init-terminal-0910`.
Branch: `codex/plan-init-terminal-20260910`.

## Actual package evidence

The frozen package passed its initial long-profile rejection and first orderly
shutdown. After restart, status reads automatically opened initialization again.
The original session required explicit recovery; its transient
`EXPLICIT_RECOVERY_REQUIRED` then replaced durable `GODOT_TASK_PATH_TOO_LONG`.
The package scenario failed its unchanged exact-code assertion. Both client
exits were zero and their three shutdown audit arrays were empty; orderly exits
do not make the failed scenario pass.

Raw report:
`C:/cm-accept-0910/test-results/desktop-native-task-paths-Wpz8MV/report.json`.
World: `world-a9f3428fdb12`.

The independent VM2 package scenario passed all nine steps and runner exit 0:
`C:/cm-accept-0910/test-results/desktop-native-vm2-AYXnuI/report.json`.
Its authorized historical `6Uvnzp` core-only fixture remained unchanged. It does
not cover terminal initialization and cannot clear the release blocker.

## Changes and validation

Only the creation factory and initializer production modules change. A shared
unfinished-state allowlist gates creation, replay, polling and the initializer
itself. Explicit retry retains recovery and normal build/check behavior. Trusted
durable path failure and confirmed playable state precede stale memory errors.

`godotWorld.initialize` returns a raw record without `playable`; the allowlist
handles that actual core contract while requiring a recognized unfinished state.

- 11 new lifecycle regressions plus 15 existing creation tests: 26 passed.
- Two key new tests loaded the exact original c4 Git source in an isolated
  evidence directory: both failed, reproducing the generic recovery overwrite.
- Strict TypeScript checking of the two changed production modules passed,
  using the existing dependency tree without installing or building a client.
- Fixtures connect the actual factory and initializer and exercise source files,
  tasks, recovery ordering and build callbacks. Domain responses are controlled;
  no real engine/core execution is claimed for these regressions.
- Raw outputs are archived beside this report under `evidence/`.

No package, frozen acceptance source, user profile, model configuration or input
device was modified. Root must integrate, rebuild and rerun the strict package
long-profile/restart test before clearing the release blocker.
