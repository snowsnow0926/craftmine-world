# Main merge and local space cleanup

Date: 2026-09-13. The user authorized merging the completed player-library work
into `main`, pushing GitHub, and cleaning obsolete worktrees and files. They
subsequently specified that `master` must be merged into `main`.

## Source publication

The repository initially had local and remote `master` at `6c0de348`, with no
`main`. A new `main` started from that exact branch and fast-forwarded through
the 106 accepted commits to `b8900d63f857eeff63c3125a0a534f9abdd403cc`. It was
pushed to `https://github.com/snowsnow0926/craftmine-world.git`. A second explicit
merge of local and remote `master` confirmed that all master history was already
included. Remote `main` was independently read back and matched the local head.
The original `master` branch was retained; no force push or history rewrite ran.
GitHub's default-branch setting was not changed by this branch merge.

This documentation-only closeout is developed in its own
`codex/merge-cleanup-20260913` worktree, then merged and pushed to `main`.
The accepted Windows payload remains pinned to `b8900d63`; a later documentation
commit is not presented as a rebuilt application.

## Preserved material

- Current Windows folder: `D:/Craftmine Releases/PlayerLibrary-preview21-b8900d63`.
  Its relative `START-PLAYER-PREVIEW.cmd` remains usable and was not executed.
  All 8,437 sealed output files matched the original inventory after relocation
  and cleanup. `LOCATION.json` maps the historical worktree path to this location.
- Approved four-world archive:
  `D:/Craftmine Archives/approved-promo-20260913T072209Z`.
  All 8,296 files in its existing SHA-256 manifest were rechecked unchanged.
- The verified Godot/Blender runtime was moved into the primary checkout's
  `desktop/build/runtime-resources`, retaining its `b8900d63` source identity.
- Raw development history:
  `D:/Craftmine Archives/development-history-20260913`.
  There are 32 verified receipts and 31 compressed archives, totaling
  34,098,605,985 bytes. Full regular test-result files, failed diagnostics,
  generated world sources, saved native records and relevant untracked files
  were preserved before their working directories were removed. Symbolic links
  are recorded separately for the Zstandard archives, without following targets.
- Git references were recorded and a complete, verified Git bundle was saved at
  `D:/Craftmine Maintenance/20260913-merge-cleanup/refs-before-cleanup.bundle`.
  Branches with separate or cherry-picked histories remain as Git references;
  six directly merged development branch names were removed with `git branch -d`.

Historical report paths still identify the original run. Resolve their old
worktree basename through the archive receipt of the same name. These are
development-history archives; the approved player worlds and current portable
world examples remain separate. No credentials or raw private diagnostic
archives were uploaded to GitHub.

## Removed material and disk measurement

Removed 24 old registered worktrees and seven unregistered residue directories.
Removed 118 groups of obsolete build material, primarily old installers,
duplicate unpacked/portable payloads, abandoned runtime staging and superseded
preview programs. Original release run/seal/evidence records and top-level notes
were retained. Rebuildable dependency and compiler caches in removed worktrees
were not treated as unique player data.

D-drive free space increased from 89,274,302,464 bytes to approximately
274 billion bytes: about **185 GB net recovered** in decimal units. This is a
before/after drive measurement, including the retained compressed history and
rebuilt primary development environment, not the sum of duplicate logical file
sizes. The small closeout worktree is also removed after its merge.

## Cleanup incident and recovery

Recursive removal encountered old shared dependency links and deleted 169
tracked files under the primary PI workspace packages, along with generated
dependency files. Cleanup was stopped immediately. The primary checkout was
clean before cleanup, and all 169 files were restored from the already-pushed
head without discarding user edits. Dependencies were repaired from the pinned
local package store with no package downloads. The cleanup was changed to detach
all links through nonrecursive filesystem operations before asking Git to remove
a worktree; a controlled junction fixture verified that its target survived.

Post-recovery validation passed:

- Shared, i18n, plugin SDK, plugin devkit and Agent runtime TypeScript builds.
- Desktop typecheck, complete production build and Agent runtime bundle.
- 43 focused publication, template, import-policy and catalog regression tests.
- Git connectivity verification and a clean primary working tree.
- Rebuilt main JavaScript SHA-256 exactly equals the accepted packaged client:
  `eedba9d0ffd8affbdfce1ad1b578e5321507e404eac4d0b307a5ad6f67e6c7c8`.
- The independent accepted-world and Windows-payload hash checks above.

Detailed local audit, archive verification, deletion journal and recovery records
are in `D:/Craftmine Maintenance/20260913-merge-cleanup`. No OS mouse/keyboard,
foreground test window, Pointer Lock, model inference or installer execution was
used during this maintenance.
