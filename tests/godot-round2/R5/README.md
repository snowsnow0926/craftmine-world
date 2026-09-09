# R5 tests: portable archive, restore and backup protection

The behaviour under test is Rust module behaviour (`crates/craftmine-core/src/backups/portable.rs`),
so the assertions live with the code in
`crates/craftmine-core/src/backups/portable_tests.rs`. There is no JavaScript
surface for this module yet: R1 owns the `main.rs` RPC dispatch, so an RPC-level
Node test would only be able to assert on a stub.

## Run everything

```powershell
cd "D:\Craftmine World-worktrees\godot-round2-r5-20260910\vendor\pi-desktop"
$env:CARGO_TARGET_DIR="$env:PI_SCRATCH_DIR\cargo-target-r5"
cargo test -p craftmine-core --lib backups::portable
```

## Regenerate the evidence bundle

```powershell
.\tests\godot-round2\R5\run-portable-evidence.ps1
```

This writes the archive manifest (every entry with its size and SHA-256), the
export/verify/restore receipts, the source-unreadable condition and the
restored state into
`docs/dispatch-reports/godot-round2/R5/evidence/rust-portable-evidence.txt`.

## What each test proves

| Test | Proves |
| --- | --- |
| `portable_archive_restores_into_a_new_directory_without_the_source` | V13 / CP-A18: full restore into a new data directory after the source directory was renamed away; worlds, progress, drafts, source blobs, Godot asset bodies, asset library bodies and Git history all come back |
| `a_damaged_archive_is_refused_and_never_touches_the_target` | a flipped body byte and a truncated stream are refused; the target stays empty |
| `restore_refuses_a_target_that_already_holds_a_world` | a live installation cannot be overwritten |
| `retained_archives_protect_content_from_the_reclaimer` | joint test against A's real `godot_storage_reclaim_plan`: a retained archive pins its builds as `CALLER_PINNED`, and releasing the archive hands them back |
| `an_interrupted_export_keeps_no_retained_protection` | startup recovery abandons a pin whose export never completed |
| `archive_paths_cannot_escape_the_target_directory` | traversal, absolute and drive-letter entry paths are rejected |
| `every_registered_table_is_inside_the_snapshot` | the domain snapshot is discovered from the live schema, and operational receipt tables never travel |

## Constraints honoured

* No browser, no real mouse or keyboard input, no window activation.
* `tests/browser.mjs` and `tests/modules-browser.mjs` are not run.
* Every fixture uses an isolated temporary directory; no user data, shared
  engine cache or historical worktree is touched.
