# Batch 07 desktop integration interface

## Parent-owned wiring

1. In Main, import `createCraftmineOperationJournal` from `craftmine-operation-journal.ts`. Instantiate one object for the actual Craftmine profile, e.g. `createCraftmineOperationJournal(join(dataDir, "craftmine-pending-operations"))`. Pass it as `operations` to `createCraftminePanelGateway`. Do not accept this directory or owner from any renderer.
2. Register private Rust RPC `verification.retry => journal.verification_retry(params)`. No model tool or manifest capability should expose it directly.
3. Register B's dedicated private `budget.configure => journal.budget_configure(params)` and allow that exact private HostRequests method to reach the core. Do not add it to generic model budget proxies.
4. Allow `draft.` in the actual Craftmine PluginRuntime business-channel dispatch alongside existing workbench/task/library/memory/backup channels. `task.budget` is handled by the Main gateway, never by a model tool.
5. Rebuild the plugin and desktop. `view.mjs` now polls only pending-operation reads for non-task workbench pages; the task page keeps its existing full refresh. This does not reset source/search forms or execute stored writes.

## UI channels and ownership

All public payloads include the actual selected `worldId`. Main rejects renderer `context`, `host`, `sessionId`, `turnId`, `projectId`, `binding` or `origin` and derives real ownership from its viewing session and selection.

- `workbench.operations {worldId}` -> `{items:[{operationId,channel,payload,state,result?,errorCode?,createdAt}]}`; current owner only.
- `workbench.prepare {worldId,channel,payload}` -> pending record. Main allocates the operation ID and atomically saves original allowlisted parameters.
- `workbench.execute {worldId,operationId}` -> saved authoritative business result, or executes the original saved intent. Never supply replacement parameters here.
- `workbench.acknowledge {worldId,operationId}` -> `{acknowledged:true}`; only completed entries may be removed.
- `draft.recheck {worldId,operationId,taskId,generation,revision,draftHash}` -> `{verificationId,status,revision,draftHash,applied:false}`. Main injects current task context and actual model origin. Workbench loads the full bounded original requirement from Rust, then queues/checks the same saved draft. No begin/end turn.
- `task.budget {worldId,operationId,taskId,generation,maxTokens}` -> B's `{operationId,budget,previousMaxTokens}`. Main injects `projectId/sessionId/worldId`; no begin/end turn. `null` means unlimited cumulative tokens; custom integers must be 1..9007199254740991. B validates current identity/generation and preserves existing charges.

Legacy direct library/memory/backup writes also use the journal when it is injected, retaining existing operation IDs. New UI always uses prepare/execute. No automatic execution or acknowledgment occurs on renderer reload. Completed entries require explicit player acknowledgment; a subsequent new action can then receive a new ID.

## Storage and error behavior

`pending-operations.json` has format `craftmine.pending-operations/1`; it stores owner, immutable payload/hash, state and bounded allowlisted result. Writes use an exclusive temporary file, flush, and atomic rename. A startup `running` entry becomes `uncertain`. Raw errors are not saved. A failed save prevents the action. Concurrent execution shares one promise within Main. Real domain receipts remain the authority after a lost response or process restart.

Successful library installation followed by failed check submission returns `verificationStatus: retry-required`; it must remain a completed saved draft. Retry reuses an existing current queued/running verification or invokes Rust `verification.retry`. A passed check still needs existing review/player application; no result is automatically applied.

## Integration validation

With the real integrated Rust binary:

```powershell
node desktop/build-world-plugin.mjs
$env:CRAFTMINE_CORE_BIN = '<absolute integrated craftmine-core.exe>'
node --test tests/batch07-desktop/journal.test.mjs tests/batch07-desktop/gateway.test.mjs tests/batch07-desktop/domain.test.mjs
node tests/batch07-desktop/ui-headless.mjs
node tests/batch07-desktop/layout-headless.mjs
pnpm -C vendor/pi-desktop/apps/desktop typecheck
```

The native desktop gate must additionally verify the full-width world surface and window controls, returning to the existing conversation, world/session changes, profile operations, and B's real budget.configure on an interrupted current task. No real input or visible-window automation is authorized.
