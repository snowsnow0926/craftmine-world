# Observed development failures

These are excerpts from actual tool output during implementation, not fresh reproductions against the final commit. No real provider or private data was involved.

1. First request wrapper typecheck: pending stopReason could not be emitted as a done event (`Type '"pending"' is not assignable`). Fixed by explicitly rejecting incomplete provider results.
2. First fixture typecheck: Promise.withResolvers was outside the configured TypeScript lib; replaced with a normal Promise resolver. Fixture ModelConfig lacked baseUrl, then RuntimeProviderConfig lacked supportsReasoning/supportedThinkingLevels; added the required fixture fields. Final typecheck passed.
3. Initial one-line integration patch failed `git apply --check` at desktop/build-world-plugin.mjs:14. Replaced the context-free hunk with three unchanged surrounding lines; final check passed without an overlay.
4. One PowerShell read command used a POSIX-style brace path and produced a parser error before reading or writing any files. Retried with explicit file paths.
5. Dependency install warned that plugin-devkit/dist/cli.js.EXE did not yet exist for bin linking. Install completed successfully; B typecheck/runtime tests passed without that optional CLI build. No dependency upgrades or lockfile changes were made.

The first three-compaction fixture used three user turns. It was strengthened in 7a5bc7d to a single PI Agent prompt that executes new_context three times, generates three PI summaries and ends successfully. This is still a provider/domain fixture, not real-model native acceptance.
