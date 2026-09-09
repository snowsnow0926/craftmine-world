# Batch07 native acceptance

Run from the repository root after building the desktop, plugin, runtime and Rust
core. Development binaries are copied into `desktop/build/batch07-bin/`; the
runner records hashes. Set `CRAFTMINE_LIVE_CONFIG` to the explicitly authorized
local model configuration. No credential is printed or accepted in CLI arguments.

```
node tests/dispatch/batch07/native/gameplay.mjs
node --test tests/dispatch/batch07/native/safety.test.mjs
```

The main scenario imports the existing fixed D fixture, edits a real native draft,
obtains real model review and uses the actual player form. Model warning assertions
stay visible and false; the fixed acceptance scenario explicitly selects the
separate acknowledgement button when required. Actual Rust capture/install into
a **new PI session and new world** precedes real formal game/Worker actions, save,
full restart, memory, native backup and another full restart.

`CRAFTMINE_BATCH07_GAME_ONLY=1` runs only imported fixture gameplay, persistence,
memory and backup with **zero model requests**. It is never creation/library/model
proof. `CRAFTMINE_PACKAGED_ROOT` uses the actual packaged executable and validates
its ASAR safety markers and source manifest hashes before launching.

Each run creates an owned, marked `test-results/desktop-native-batch07-*` profile.
For one retained failed-review attempt, `CRAFTMINE_BATCH07_RETRY_PROFILE` can point
only inside that worktree's owned directory. `CRAFTMINE_BATCH07_ACK_EXISTING=1`
uses an already completed warning review without another model call. A captured
creation interrupted before installation can continue in a fresh bound session.
Every prior report is preserved. No raw SQLite write is used for acceptance.

`integration.patch` connects the fixed helper in the root-owned Electron main;
`core-integration.patch` connects explicit acknowledgement in the root-owned Rust
RPC router. Both are overlays used for development and must be integrated before
final packaging. Guard-only source modifications are described in the native
acceptance specification; ordinary formal preview messages remain rejected.

`CRAFTMINE_BATCH07_BUDGET_ONLY=1` with an owned retry profile reopens the
retained source session, submits the actual finite-limit and unlimited forms,
and proves nonzero known/unknown usage and owner are preserved without model
requests. The full library scenario performs the same UI check after install.
