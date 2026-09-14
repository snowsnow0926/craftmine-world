# Fresh complete export identity across application updates

Use an isolated profile and independent offscreen process. No real mouse/keyboard,
Pointer Lock or foreground windows. A deterministic fixture test is not a real
model or engine acceptance result; label both separately.

1. Create an ordinary check on a fixed source/assets/base, retaining its exported
   bytes and failed runtime verdict. Record job/build IDs, output hash, artifact
   hashes and source revision/manifest/content identity. Stop the owned process
   normally. Preserve the original failed evidence.
2. Resume that job under the identical toolchain using the existing ordinary
   continuation. Require exact retained bytes and a fresh check descriptor;
   no export should run. Repeating the same host tool-call receipt remains
   idempotent. A foreign task/changed request cannot reuse its nonce.
3. Issue a distinct explicit complete build on the same source, first under the
   same toolchain and then after a genuine packaged broker/toolchain update.
   Each new call gets a new build/artifact root, retaining identical source,
   assets, content commit and formal base. If Godot emits different PCK bytes,
   they are stored only in the new root. The older artifacts, manifest and native
   output remain unchanged. Old continuation under the changed toolchain must
   still report GODOT_CONTINUATION_TOOLCHAIN_CHANGED; never relax that guard.
4. Run the real new native runtime check, inspect its candidate and adopt through
   the normal application flow. Save and cold reopen the new formal build. Verify
   source/asset identity and player progress; query the older failed job/history
   and compare exact old bytes again. No source edit to change an ID is allowed.
5. Keep historical receipts/builds queryable after restart, with no ID migration
   or file deletion. Inject a mismatched result for the same new build and require
   the existing artifact conflict protection. Verify storage counts account for
   every fresh copy and existing explicit cleanup respects old references.

Relevant Rust coverage: `fresh_export_variants_preserve_old_bytes_and_history_and_can_be_checked_and_applied`,
build receipt/task identity tests, retained-export continuation tests, candidate
application and storage tests. The public model tool catalog must remain byte
identical so a long existing Codex conversation can resume normally.
