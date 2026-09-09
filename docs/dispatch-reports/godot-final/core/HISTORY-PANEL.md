# Godot history panel integration

Create one main-process `createGodotHistoryPanelService({domain,selection})` using the same trusted `plugins.requestCraftmineHost` domain and `godotSelection` as the existing initializer. Route the following six **main-window navigation** channels to its `invoke`. The service verifies the selected world and exact allowed fields before invoking the domain. Do not open a generic core route.

| Channel | Payload |
| --- | --- |
| `godot.historyLoad` | `worldId, branchId?='main', skip?=0, offset?=0` |
| `godot.historyCreateBranch` | `worldId, branchId, fromOid` |
| `godot.historyReadSource` | `worldId, branchId, revision, manifestHash, path` |
| `godot.historySaveSource` | `worldId, branchId, revision, manifestHash, path, expectedHash, text` |
| `godot.historyCheck` | `worldId, branchId, revision, manifestHash` |
| `godot.historyJob` | `worldId, jobId` |

The private `content.branch.create` forwarding route is required with required fields `worldId,branchId,fromRev` and optional `requestId,taskId,title`; these metadata fields come from this native service, not the renderer. Existing project index/read/build routes must allow branchId. `turn.begin` is a private host operation, not a raw Rust method. Every source operation opens and ends its own host task. `godotBuild.start` uses the existing authorized route's executor enqueue and returns the real durable job; the completed panel dispatch task does not cancel it.

`GodotHistoryPanel` is mounted by `CraftmineNavigation` in a sheet. It shows actual history and formal applied OID separately, creates a branch from an exact listed version, switches source context, reads/edits small text files with expected hashes, and checks the exact displayed revision. Large text files are read-only to avoid saving a truncated preview; binary resources expose metadata. History and file pagination are bounded. Stale writes/checks retain core rejection. It does not change applied refs, supply snapshots, or call application APIs. “打开检查记录与候选预览” closes the sheet and opens the existing `{kind:'checks'}` surface for preview and confirmation.

The main-window/native-view owner should ensure this sheet is visible above or while native views are hidden, consistent with other main-window sheets. The component never focuses, captures a pointer or requests input.

## Validation

`tests/godot-history-panel.mjs` passed **10 checks** through real React, this service, the integration's actual private router, a real Rust process and Git. It proved new branch creation, distinct source edits, main/applied protection, stale check rejection, branch-switch reads and complete Rust restart restoration. An independent headless browser made only page-script DOM operations, with focus and pointer lock disabled and audited. HTTP replaced only Electron navigation transport. No executor was registered, and the test required the real `blocked / GODOT_EXECUTION_UNAVAILABLE` outcome rather than inventing a passing check. It does not replace the root's full Electron/executor/model acceptance.

Raw evidence: `history-panel-05.log`, `history-panel-report.json`, `history-panel-calls.json`, `history-panel.png`. Attempts 01–04 retain harness setup failures and the real missing private branch route, corrected by the integration owner before attempt 05. `history-service-types-final.log` records strict standalone TypeScript success; the earlier type-root resolution failure is retained. All evidence bytes are protected from Git newline conversion and listed in `evidence-index.json`.
