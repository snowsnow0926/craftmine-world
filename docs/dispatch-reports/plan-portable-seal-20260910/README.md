# Portable sealing tool evidence

Base: 9f752f5. Independent worktree: D:/cm-plan-portable-20260910.

Implemented desktop/seal-portable.mjs. No old release application was compressed,
changed, rebuilt, or executed. The existing pinned 7-Zip was read-only reused.

Final tests: 14 passed, 0 failed, 0 skipped (portable-seal plus release-run).
These exercised real Git fixtures, actual junction/hard-link rejection, source
and evidence changes, retained failure reports, and two actual ZIP/extraction
runs over a tiny authored payload. The original sealed fixture output remained
byte-identical. They are not full product or clean-Windows acceptance.

Existing tool used:
- D:/cm-godot-final-20260910/desktop/build/archive-tool-26.03/tools/7z.exe
- exe SHA-256: 6ee3c0ed0b27663c1b948ae85a7c0bb073aed1498983182f3f0df1f6a8c30b2f
- 7z.dll SHA-256: 65e4c1f855f9ef6e8f0f5df8e3f27d9eb5f07311408639da0a1ca0b8f4871b0d

Tests receive those three values via CRAFTMINE_TEST_ARCHIVE_TOOL,
CRAFTMINE_TEST_ARCHIVE_SHA256, CRAFTMINE_TEST_ARCHIVE_LIBRARY_SHA256, then:
node --test tests/godot-final-install-assets/portable-seal.test.mjs tests/godot-final-install-assets/release-run.test.mjs

The initial 11/12 run found a real special-mode listing validator bug: a trailing
word boundary did not match permission strings ending with '-'. It was changed
to an explicit whitespace/end boundary; the retained first log is not counted
as passing evidence. Final raw output is tests-final.log.

Production command after a new clean release has its own seal and package evidence:
node desktop/seal-portable.mjs --run <absolute-current-release/run.json>

No model/provider calls, credential reads, downloads, visible windows, focus,
OS input, signing, or user-state modifications were performed. Final full
portable release creation and application acceptance remain root-owned later work.
