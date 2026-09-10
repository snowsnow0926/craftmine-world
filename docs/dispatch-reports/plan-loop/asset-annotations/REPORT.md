# AL2 favorites and tag editing slice

Branch/worktree: `codex/plan-init-stage-20260910`, `C:/cm-init-stage-0910`.
This commit follows the separately committed `7d7f05e` stage correction. Neither
change modifies the frozen 827 release or its acceptance tree.

## Implemented

The actual selected-asset detail has favorite/unfavorite and tag forms. New
edits use new operation identities, addressing the former fixed
`asset-annotate:<assetId>` conflict on a second different edit. Per-asset pending
requests retain their frozen id and payload for lost-response retry, including
switching away and back within the panel. Selection generations and scoped edit
errors prevent late responses replacing another asset's detail.

The existing Rust metadata API is reused without changes. No body, license,
content hash, version or world-write input is sent. Tag count and UTF-8 byte
bounds match `asset_catalog/index.rs`; empty tags clear the metadata.

## Verification and boundary

28 controller/model regressions passed (10 new, 18 existing). Strict TypeScript
checking of the panel, editor and controller passed with existing dependencies;
there was no installation, Rust compilation or new build target.

The actual React/Core headless scenario passed 8 steps: detail controls, two
favorite edits with different ids, Chinese tags, committed-but-lost reply with
exact replay, late reply after switching, byte-limit rejection without a write,
empty tags with immutable data comparison, and metadata across a core restart.
The browser recorded zero focus/pointer-lock requests and zero page errors.
Raw reports include the exact existing core executable hash. The fixture's
unknown license remains unknown. No model, Electron or Godot was started.

Final exact-source run: `test-results/asset-annotations-0bNTNK/report.json`,
runner exit 0. Its four recorded UI module hashes were rechecked against the
commit's production files before archiving. The core hash is
`072556858144cf7c9ce8e3030103a889300cf3add4af2bb0066916ab7811dc7b`.
The recorded source base is `7d7f05e`; module hashes identify the new uncommitted
UI used for this pre-commit test. A slow post-save list refresh also has a
dedicated regression: acknowledged writes release their slot before controls
are re-enabled, so a subsequent edit is not mistaken for the old operation.

Original headless runs are retained under this worktree's
`test-results/asset-annotations-*`; final raw evidence is archived beside this
report. The screenshot is a standalone panel harness, not a claim about the
full client layout. Root will perform integrated client acceptance later.

This is the favorites/tags slice only, not completion of AL2. Pending editor
requests are scoped to the current controller lifetime; no cross-restart client
journal or multi-client metadata compare-and-swap is introduced.
