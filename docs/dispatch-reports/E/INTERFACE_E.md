# E Windows interface — v1

Source implementation: `378e863ab96da5a74f3f7119f21c83936807531d`. Shared Electron entrypoint and Rust RPC router are G-owned; these modules require injection and do not expose paths to renderer/model.

## Credential status

`SecretStore::status()` returns `protected | fallback | unavailable`; `backend()` returns `windows_dpapi | file_fallback | unavailable`. Windows never silently selects fallback after protection failure. Main should proxy the zero-parameter `secrets.status` RPC shown in integration.patch. This reports actual store health, not legacy per-provider metadata. G has acknowledged this integration.

## Trusted backup bridge

`electron/main/craftmine-backup-service.ts` exports `createCraftmineBackupService({domainCall,pickFile,now?})`, returning `{request(channel,input),dispose()}`. `pickFile({kind:'save-backup'|'open-backup'|'save-diagnostics',suggestedName?})` must run only in trusted main and return an absolute selected filename or null. Never accept a filename/archive from renderer or model. `domainCall` is the real A Rust RPC adapter, not another writer.

| Channel | Input | Result |
| --- | --- | --- |
| backup.inspect | `{worldId?}` | `{status:'ready'|'cancelled',grantId?,archiveHash?,expectedCurrentHash?,counts?,bytes?,scope:'profile',credentialsIncluded:false}` |
| backup.export | `{worldId?,operationId}` | `{status:'completed'|'cancelled',operationId,archiveHash?,bytes?,scope:'profile',credentialsIncluded:false}` |
| backup.restore | `{worldId?,operationId,grantId,expectedCurrentHash}` | `{id,operationId,status,currentHash,modelReplay:false,scope:'profile'}` |
| backup.status | `{operationId?}` | Local pending/failed export state or A receipt/currentHash |
| backup.cancel | `{operationId}` | A/local cancellation receipt; completed atomic restore cannot be undone |

World ID is UI association; archive scope is the whole domain profile. Four private grants maximum, ten-minute expiry, selected file hash rechecked before restore. 32 MiB JSON limit; no extra envelope. Sixty-four remembered operation IDs; same completed operation returns its receipt, same pending operation shares its promise. Uncertain restore can recover A's durable receipt. Public errors contain stable codes only, not native filenames. Dispose revokes grants and pending operations. Root must authorize the active panel and its world before dispatch and dispose on owner shutdown.

A calls: `backup.export({operationId})`, `inspect({archive})`, `status({id?})`, `restore({operationId,archive,expectedCurrentHash})`, `cancel({operationId})`. Exact archive format at E verification is `craftmine.domain-backup/1`, schemaVersion 1. E tests use A-shaped fixtures; integrated A transaction acceptance belongs to G.

## Diagnostics

`craftmine-diagnostics-service.ts` exports `createCraftmineDiagnosticsService({pickFile,snapshot,now?})`. Methods: `request('diagnostics.status',{})`, `request('diagnostics.export',{operationId})`, `observe('startup'|'frame'|'modelJob',durationMs)`.

Status format `craftmine.diagnostics/1` has allowlisted build hashes/version, platform/arch/release/Node/Electron, task status/request and compaction counts/stable error code, credential status, mainProcessRssBytes and per-kind sample count/p50/p95. Only actual observed samples appear; zero samples do not mean zero elapsed time. Snapshot may carry extra trusted values but they are not copied. Export uses the same trusted chooser and returns `{status,operationId,bytes,hash,scope:'sanitized'}`. No raw logs/chat/world source/provider configuration/credential values/absolute personal paths are exported. G must wire actual timing measurements; E fixture durations do not establish product performance.

## Build and upgrade

`powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File desktop/build-client.ps1 -Installer` creates directory+NSIS and validates all artifacts. Without `-Installer`, creates folder. Clean source and unchanged HEAD/working tree throughout build are required. `desktop/build/build-manifest.json`, `package-evidence.json` and `CraftmineWorld-source.zip` establish provenance. Dependencies and version remain pinned; byte-identical NSIS output is not promised.

Offline upgrade guard's snapshot is different from A's portable domain archive. It copies PI SQLite/session text and Craftmine plugin data while holding exclusive reads, excludes the credential store (`credentialStoreIncluded:false`), retains originals, and writes file hashes. It is private local recovery material, not shareable diagnostics. NSIS stops on backup failure before installing files, does not start the app, and retains user data on uninstall. No automatic filesystem restore or second domain transaction is added.
