# Task M content-history verification

Reproduction notes for the VM0/VM1 content-history delivery
(`crates/craftmine-core/src/content_history/{mod,contract,git,repo,migration}.rs`).
All commands are run from the `vendor/pi-desktop` directory of the worktree
(`D:\Craftmine World-worktrees\godot-remaining-m-20260910\vendor\pi-desktop`).

## Exact commands

```powershell
# Content-history tests only (VM0/VM1 modules plus the VM2 Git-transaction
# tests in the same filter)
cargo test -p craftmine-core --offline content_history

# Ignored probe: prints the frozen canonical lock text and hashes
cargo test -p craftmine-core --lib content_history::contract_tests::print_frozen_vectors -- --ignored --nocapture

# Whole crate (sanity check that nothing else regressed)
cargo test -p craftmine-core --offline
```

Recorded result at the time of writing (Windows 10.0.19045, rustc/cargo 1.96.1,
git 2.53.0.windows.1 via `PATH` fallback, baseline `e462147`):

```text
test result: ok. 41 passed; 0 failed; 1 ignored; 0 measured; 112 filtered out
```

The five modules documented by this delivery (contract, git, repo, migration)
account for 35 passed plus the 1 ignored vector probe. The remaining 6 tests in
the same filter belong to the VM2 Git-transaction module, which is not described
by the VM0/VM1 spec.

## What each test file proves

| File | Tests | Proves |
| --- | --- | --- |
| `contract_tests.rs` | 10 (1 ignored) | The canonical `craftmine.assets-lock/1` text and its golden hash; the frozen first bytes; the empty-lock hash; Git OIDs are 4..=64 lowercase hex and never assumed to be 40; SHA-256 is a separate namespace; `latest`/`head` versions are rejected; conflicting duplicate asset versions are rejected while exact duplicates collapse; unresolved and cyclic dependencies are rejected; traversal, absolute, backslash, device-name and case-colliding paths are rejected; committed lock bytes must be canonical; source/progress/operation references stay separate and `expected*` keys must be present even when null. The ignored `print_frozen_vectors` test is the vector generator. |
| `git_tests.rs` | 10 | Program provenance is recorded (bundled candidate vs `PATH` fallback, version and file SHA-256); the user/system Git configuration is never read and every config origin is the managed file or a command-line override; managed hooks dir and host-derived identity (`<stableId>@craftmine.local`, no player email); dangerous subcommands are refused before spawning; hostile repository config keys are rejected; reference-name validation; SHA-1 and SHA-256 repositories end to end; compare-and-swap rejects stale reference values; a timeout kills the child and the repository stays usable. |
| `repo_tests.rs` | 11 | Commits, branches, history paging and asset locks are authoritative in Git; concurrent branch writes lose to CAS and two plan branches stay independent; build copies contain no `.git` and unsupported entries (symlinks) are reported; authoring exclusions, traversal and case collisions are refused before any commit; text diffs and binary diffs are separated; clean merges return a tree while real conflicts return no tree and report paths; bundles verify, reclaim reports garbage vs `referencedElsewhere`, and prune deletes only true garbage; SHA-256 repositories record their object format end to end; the logical repo id never becomes a filesystem component; a 200-file bulk commit uses one Git invocation and leaves no staging files. |
| `migration_tests.rs` | 5 | Preflight is read-only and writes nothing; a missing blob is reported and blocks the import; every legacy revision becomes one commit with parent chaining and the backend switches to `git`; a partial import resumes into the same history (adopting a matching commit after byte re-verification, otherwise continuing the chain) instead of forking; post-switch verification reports legacy damage and does not repair it. |

## Frozen vectors

`tests/godot-remaining/M/contract/asset-lock-vectors.json` is generated from the
ignored probe output. It contains the canonical fixture text (1688 bytes, hash
`b95794a2afd498e782e6ec64ec84f1a595d9b56ac723ee4c997a15bbcaad9f0b`), the empty
lock (58 bytes, hash
`70396c0e7b3582530fb2765684ae9a8bbc6579c93066539e5ed83ce0db5a4809`) and 25
error vectors. `sha256(lockText)` must equal the declared hash for both
vectors. Changing a golden value is a contract change agreed with the
asset-catalog owner, not a bug fix.

## Evidence transcripts

Transcripts for this task belong in:

```text
docs/dispatch-reports/godot-remaining/M/evidence/
```

Existing files there:

- `rust-content-history-tests.txt` — the `content_history` test run
- `rust-full-crate-tests.txt` — the whole-crate test run
- `git-provenance.txt` — the Git binary path, version and SHA-256 actually used

New evidence for this delivery (vector regeneration, spec/ADR/E2E checks) should
be written to the same directory with a descriptive name. Do not overwrite an
existing transcript; add a new dated file instead.

## Input policy

No browser, mouse, keyboard, focus, visible-window or Pointer Lock test is part
of this verification. Only pure-logic tests and independent headless/offscreen
processes in an independent data directory are allowed.
