# Final portable backup service evidence

Implemented native portable export/full verification/grants, private managed
restore-and-activate, restart pointer/proof checks, exclusive CoreClient
transition and rollback. Root still owns production index lifecycle callbacks
and private router construction. Full product/model acceptance is separate.

Observed development failures, preserved rather than counted as passes:

1. The default sandbox rejected spawning the fixed core (`spawn EPERM`). The
   exact temporary-fixture regression was then approved and executed.
2. The initial long managed restore path produced Git's
   `BACKUP_OBJECT_RESTORE_FAILED: fatal: '$GIT_DIR' too big`. Shortened digest
   directory names allowed the actual restore. Arbitrarily long user profile
   paths still require a core/Git long-path strategy.
3. Windows extended-path spelling caused a false receipt path mismatch; both
   receipt and expected directory now use realpath for comparison.
4. Comparing the post-startup fingerprint to the initial restore receipt was
   wrong. The core owner supplied commit `45d0516` with `backup.restoreProof`;
   the service now checks the immutable restore transaction mark.
5. The test initially attempted to reopen an interrupted task directly.
   `EXPLICIT_RECOVERY_REQUIRED` correctly rejected it. The test now uses
   `task.recoverable` plus `task.resume`, without model replay.

Real native-service/Rust integration passed nine checks with core binary
`D:/cm-godot-final-core-20260910/test-restore-core.exe`, SHA-256
`41d740d0b14cce18f4980b73c2e1485cba7a30fe18089acde76d0b0a9a5dfc81`.
The last pre-final fixture was
`C:/Users/WINDOWS/AppData/Local/Temp/portable-activation-QupPGS`.
The final command/output is retained in `portable-core.log`.

Updated native backup/diagnostics/hidden synthetic upgrade tests passed 11/11
in `tests/dispatch/e/windows-services.test.mjs`.

The staged reuse installer bundle loaded through Node require successfully,
exported both factories and contained no checkout-relative shared imports.
Output: `test-results/reuse-bundle-KwsmSb` inside this task worktree. This fixes
the missing package/draft modules when shipping the plugin. The new portable
restore CJS module is copied alongside CoreClient by the plugin build script.
