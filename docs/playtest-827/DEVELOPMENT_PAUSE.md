# Development pause for user playtesting

The user requested closeout and a pause before their own playtest. Do not resume
the previous indefinite development loop without a new user instruction.
No new feature was merged or packaged during this closeout.

## Delivered local preview

- Frozen source: 8276b4540289c0d397c382dff2123edfe1861d42, display version 0.14.3.
- Six package suites: 121 passing steps and 18 strict clean client exits.
- Closeout rehashed every packaged file: 1,565 files, 974,369,789 bytes, all
  matching the sealed inventory. Installer, blockmap, portable ZIP and source
  ZIP match the existing delivery SHA256SUMS. This is byte verification, not
  a repeat of the functional suites or installation acceptance.
- User handoff: C:/Craftmine-Playtest-20260910. Its local launcher selects the
  previously nonexistent C:/cm-playtest-827 profile and the unchanged sealed
  executable. The launcher was inspected statically; no application or visible
  test window was launched. User controls the interactive launch.
- Main checkout D:/Craftmine World remains a79cd7522d18ee1b75ddf854f8ef25c0507423e9.
  Its ten original modified/untracked user documents retain exact baseline bytes.
- Integration checkout C:/cm-plan-next-20260910 contained cdb304b before this
  documentation-only closeout. Parameter defaults and selected issue export
  have development-client evidence, but are not in the frozen 827 release.

## Saved pending work

1. Asset Main routing, commit 0b802fb3cb9d79efec6d7ff9888deb02a9092f56 in clean
   C:/cm-init-stage-0910, is not merged. Agent evidence: 35 logic/Core-route
   checks, 10 actual navigation DOM checks, scoped TypeScript. Independent
   read-only review found no new blocker in five reads plus annotate. Actual
   Electron integration and full typecheck are not done. asset.preview and
   asset.cancel remain outside the wired Main methods; this is not a complete
   import/preview library. Review the production routes before integrating.
2. Future task bin retirement: fa82b825733dc1c9ceff086606ecd90fe799196c followed by
   cf2623c5be525f1c7db3f1d8ccaa487be6ed385b, clean C:/cm-issues-package-20260910.
   The second commit fixes the independently reproduced exit-before-stdio-close
   gate. Agent reports 53 small/protocol checks passed. Root has not completed
   Rust review, compiled this broker, independently rereviewed the close fix or
   run a real engine with this change. Neither commit is merged. Existing
   release/runtime pins remain unchanged. writeFile+rename is not fsync or a
   power-loss durability claim. Failures and old tasks stay outside retirement.
3. The current ignored build-controls-development.ps1 reuses native binaries
   only when native source equals 827. It must not be used unchanged after
   merging the Rust retirement patch. Compile the broker from the new source,
   pin its real identity, restage runtime resources and rebuild from clean HEAD.
4. After review/integration, run finite actual asset client acceptance and new
   task retirement acceptance in new private profiles, then build and accept
   a new same-source release. Preserve 827 and all old failed evidence.

The three collaborating agents have finished their bounded work and stopped.
No recurring automation was created by this turn. No model request, credential
copy, installer execution, remote publication or input automation occurred.
Formal model acceptance remains NOT_RUN; the earlier provider data/billing
authorization question was not answered by the storage-cleanup approval.

## Approved historical cleanup

The explicit user approval covered only the proposal's 64 fixed engine EXE
copies in the mBOBsn and UqYcKp finished test profiles. They were removed using
individual native PowerShell LiteralPath operations. Independent verification
proved all other 7,051 files and all 3,157 directories unchanged, with zero
anomalies. See ../dispatch-reports/plan-loop/approved-engine-cleanup/CHECKPOINT.json.
Raw full retained-file verification stays under test-results; its byte hash is
pinned in the checkpoint. The PP3 SLXOaa profile, its ZIP, every release and
all other historical profiles remain outside that deletion authorization.

## Resumption notes

The E2E spec has legacy invalid UTF-8. Preserve its existing bytes during merge;
do not decode and rewrite the whole file. Existing ignored byte-append conflict
helper is test-results/resolve-e2e-append.cjs. All newly allowed headless actions
remain finite semantic/form operations; preserve existing issue/default helpers.
No mouse, keyboard, click/fill simulation, Pointer Lock, focus or user browser
automation. Do not run tests/browser.mjs or tests/modules-browser.mjs.

The user's playtest feedback is the next input. Preserve its tested source
identity and original wording before deciding further development priorities.
