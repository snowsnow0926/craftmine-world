# Craftmine domain integration

This is a downstream product specification. See ADR 0300.

## Task journal contract

- `TaskBinding` is host-owned project, session, turn, task and base-build identity.
- Starting an existing task never resets its draft or cancellation status.
- Draft revisions increase by one inside a transaction that also stores the tool receipt.
- A duplicate call with identical input returns its prior receipt. Reusing an ID with different content is rejected.
- A stale revision, foreign binding, invalid document or cancelled task leaves the current draft unchanged.
- Document size is bounded. SQLite uses full synchronous WAL transactions; file content is checked against the recorded hash.
- The application has not yet delegated live world writes to this journal. Compiler, evidence and project lease integration are W1/W2 work; there is no model-accessible bypass that can publish an unverified draft.

## Plugin execution identity

The Rust `plugins.execute` notification includes its existing `sessionId`, `toolCallId`, and `executionId`, plus `turnId` from `ToolsExecuteParams`. Electron main, PluginRuntime, the plugin process, and `PluginToolExecContext` preserve these values. The public fields remain optional for compatibility. Craftmine mutating tools must reject missing identity rather than accepting IDs supplied by the model. Execution IDs identify dispatch attempts; tool-call IDs remain the idempotency identity within the bound task. Cancellation and project binding remain separate requirements.

## Product service and world panel

`craftmine-core --data-dir <absolute path>` owns `tasks.sqlite` and accepts bounded JSON-lines requests on its private stdio pipe. `hello`, `task.start`, `task.inspect`, `task.commit` and `task.cancel` are available to the trusted broker. The built-in `craftmine.world` plugin owns the service lifecycle. Its first agent tool reports actual runtime status and explicitly reports world publishing as unavailable.

The world view bundles trusted local resources into a sandboxed srcdoc iframe using script-hash CSP entries. The iframe exposes neither the plugin bridge nor Node. Blob Workers support the existing authored-code runtime. Message exchange requires the expected source window and a per-frame nonce. File-origin replies use a wildcard target only because the receiving document has an opaque origin; incoming validation remains mandatory.

## Desktop acceptance

The same Rust database now owns a `craftmine_worlds` table: world identity, title, revision, timestamp, compiled document, progress and content hash. The plugin's panel bridge can list worlds, create a compiler-checked empty world, open one and save validated gameplay progress. Saving progress cannot replace a build or extension catalogue. Revision and base-build checks reject stale views; integrity failures report an error without resetting the stored world. No JavaScript ProjectStore writes this desktop database.

The panel saves manually, every ten seconds while loaded, and before switching or creating another world. Restart restores the last selected world through plugin settings and re-reads its authoritative content from Rust. World switching replaces the sandboxed iframe and its nonce. Renderer shutdown is not yet an acknowledged save barrier: the explicit Save action remains necessary before closing after a recent change. Legacy import, candidate publishing, session-to-world binding and the close barrier remain W1/W2 follow-up work.

Preserve project and session navigation, streaming conversations, cancellation, tool details, file and diff panels, model settings, themes and panel resizing. Add world and creation tabs, candidate preview and verification evidence using the same work-panel model. Provide Chinese defaults and an optional immersive play layout.
