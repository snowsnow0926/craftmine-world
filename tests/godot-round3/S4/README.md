# S4 — durable portable backups and new-directory recovery

Scope: `crates/craftmine-core/src/backups.rs`, `backups/**` (portable archive,
restore operations, protection pins) and the durable operation records they own.

## What the tests prove

| test binary / module | proves |
| --- | --- |
| `backups::domain_tests` | the domain snapshot carries every registered table (including the Godot/Git revision index) and fails with `BACKUP_SCHEMA_DRIFT` when a future module registers a table the allowlist does not know |
| `backups::portable::tests` | export/verify/inspect/restore round trip, bad and truncated archives, target overlap, entry-path containment, retention and release of protection pins |
| `backups::portable::durability_tests` | a real separate process is ended abruptly inside the restore at `after-claim`, `after-stage`, `after-content`, `after-git`, `before-commit` (receipt written, commit not yet) and `after-commit`; recovery undoes exactly the journaled work or promotes the commit from the mark written inside the restore transaction; a second operation never rolls back a committed restore; a lookalike staging directory is refused and survives; a cancel request converges; a restored installation keeps authoring new revisions |
| `backups::portable::tests::a_repository_larger_than_the_buffered_stdout_cap_exports_and_verifies` (ignored) | export and verify of a repository whose `cat-file --batch` stream is larger than the old 64 MiB buffering cap, with a printed marginal peak memory |

## Running

```powershell
pwsh -File tests/godot-round3/S4/run-s4-evidence.ps1
```

The script runs in an isolated `CARGO_TARGET_DIR` under `$env:PI_SCRATCH_DIR`
and writes raw output to `docs/dispatch-reports/godot-round3/S4/evidence/`.

Targeted commands, if you only want one module:

```powershell
cd vendor/pi-desktop
cargo test -p craftmine-core --lib backups::domain_tests
cargo test -p craftmine-core --lib backups::portable
cargo test -p craftmine-core --lib backups::portable::durability_tests
cargo test -p craftmine-core --lib backups::portable::tests::portable_export_of_a_large_object_store_stays_bounded -- --ignored --nocapture --test-threads=1
```

## Constraints honoured

* No input simulation: no `tests/browser.mjs`, no `tests/modules-browser.mjs`, no
  Playwright `click`/`fill`/`mouse`/`keyboard`, no window activation or focus.
* The crash tests manage only processes they started, by handle; no process is
  ended by name or bare PID.
* Every temporary directory is created by the test and removed by its
  `tempfile::TempDir` guard; no cleanup targets a user directory or a path that
  was not proven to belong to the operation.
