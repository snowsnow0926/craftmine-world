# Repository closeout, 2026-09-10

This work commits existing plans, consolidates post-release development,
preserves historical drafts, removes reviewed source-only worktrees and prepares
the explicitly requested GitHub push. Feature development remains paused for
the user's playtest. No installer or frozen release payload was changed.

## Branch layout

| Branch | Scope |
| --- | --- |
| master | Verified 827 source/acceptance baseline, existing history, archived plans and this repository status index |
| codex/integration-next-20260910 | Existing post-release commits plus asset Main routing and task-bin retirement; targeted checks passed, full client and package acceptance pending |
| codex/archive/20260910/g6-core | Remote preservation of the old cycle-six core draft; not a new implementation for master |
| codex/archive/20260910/g6-host | Remote preservation of the old host source and original evidence |
| codex/archive/20260910/g6-sandbox | Remote preservation of the old sandbox source and byte-exact original evidence |
| codex/archive/20260910/l3-l4-preparation | The independent J preparation branch, retained without claiming product integration |

The archive branch names are the intended push destinations; the corresponding
local source branches retain their earlier codex names. No force push, stable
release tag, GitHub release upload or CI dispatch is part of this closeout.

## Commits and integration

Three documentation batches preserve the original planning files: licensing
decision (0ea33e1), seven connected plans (ba5d8f0), and navigation links
(417bbda). Intentional Markdown hard-break spaces were preserved. The decision
record does not change any actual source license or package license declaration.

The next branch retains the twelve chronological post-release commits through
437e760. Normal merges retain the plan history, asset branch 0b802fb and
retirement branch cf2623c. Merge conflicts preserve the existing default/issue
headless helpers and add the finite asset helper. The legacy E2E file's original
bytes remain intact; only the new asset scenario was appended.

Three previously dirty cycle-six worktrees now have five historical checkpoint
commits. All 74 original files remain unchanged in their original directories;
the evidence blobs were checked before committing to avoid line-ending damage.
Two generated test executables remain local and are excluded from source commits.

## Validation boundary

The integrated production source at 7a089d6 passed 53 retirement/executor tests,
43 asset Main/controller/service tests, and 36 offline broker library tests.
The broker compiled successfully. The full desktop TypeScript check passed.
Configuration-related failed attempts remain in the evidence archive.

These are targeted integration checks. No new Electron/Godot client acceptance,
model request, installer execution or package rebuild occurred. The frozen 827
preview remains the user's playtest version; its 121 passing package checks and
18 strict client exits are separate historical evidence.

## Worktree cleanup and recovery

Eight clean worktrees whose exact heads were merged into master were removed
using ordinary git worktree remove; their merged branches were deleted using
git branch -d. Before each removal, exact paths, clean status, absence of ignored
content/reparse points, archived branch identity and matching processes were
checked. No force deletion was used. One already-missing worktree registration
was pruned. Ninety initial registrations including the new integration tree
therefore became 81.

All remaining worktrees retain original release artifacts, raw evidence, shared
dependencies or unresolved historical branch relationships. The six source-only
unmerged historical trees remain available. The user's C:/cm-plan-next-20260910
release tree, C:/Craftmine-Playtest-20260910 launcher and independent playtest
profile are preserved.

The complete pre-cleanup Git bundle is retained locally at
C:/Craftmine-Git-Archive-20260910/before-worktree-cleanup.bundle. Its verified
SHA-256 is 323b607503a4891014a5e42ae21099fd7b399efdfff8501b3b8e8aff071e2c45.
The cleanup record preserves each removed branch, exact commit and old path;
git worktree add --detach OLD_PATH COMMIT can reconstruct its source when needed.
The bundle preserves Git objects and refs, not ignored files; no ignored files
were removed. Historical source references remain recoverable from their commits.

Automatic approval review rejected removal of one newly created dependency
junction with only "blocked by policy". It remains at the integration tree's
vendor/pi-desktop/apps/desktop/node_modules, pointing to the retained dependency
tree. No alternate deletion API or repeated deletion was used.

## Push checks and evidence

Origin was verified as https://github.com/snowsnow0926/craftmine-world.git;
its master was a4944be before this work. Git identity was verified and push
dry-run succeeded. Outgoing tracked Git objects were screened for common key
patterns and GitHub's large-file limit with no findings. This screening is
bounded, not an exhaustive security certification. Ignored runtime data and
local credentials are not staged or pushed. Publication uses explicit branch
refspecs and retains existing history.

See [the closeout evidence index](dispatch-reports/git-closeout-20260910/evidence-index.json)
for exact logs, historical commits, cleanup records and bundle identity. The
final assistant report records the actual push outcome and remote commit checks.
