# A domain interfaces

Status: ready for integration, 2026-09-09. Private Rust stdio methods are not public renderer RPCs. The trusted broker binds every identity; do not forward model-supplied identity fields.

## Task context and accounting

`task.context({context:{projectId,sessionId,turnId}})` returns:

```json
{"binding":{"projectId":"p","sessionId":"s","turnId":"t","taskId":"work-hash","baseBuild":"v-hash"},"generation":1,"status":"running","recovery":"none","world":{"id":"world-a","revision":0,"buildId":"v-hash","hash":"sha256"},"draft":{"revision":0,"hash":"sha256"},"modifiedResources":[],"requirements":[],"receipts":[],"jobs":[],"lease":{"owned":true},"budget":{"ownerTaskId":"work-hash","requestCount":0,"toolCallCount":0,"compactionCount":0,"actualTokens":0,"reservedTokens":0,"unknownRequestCount":0,"chargedTokens":0,"remainingTokens":1000000,"limits":{"maxRequests":80,"maxTokens":1000000,"maxCompactions":8,"deadlineAt":null}}}
```

This example is a contract fixture. The method does not claim that finished tasks are running or that released leases are owned. Requirements contain at most four `{id,kind,text,truncated}` entries, newest first, with each projection limited to 1,000 Unicode characters. `task.recordContext({context,requestId,text,kind:'request'|'correction'})` is host-only, rejects mismatched retries, stores at most 16,000 UTF-8 bytes, and returns `{id,recorded:true}`. The actual host transcript remains the full original request. A new ordinary turn has no inherited requirements; explicit interrupted-task recovery retains them.

- `budget.inspect({binding,generation})` returns the budget projection above.
- `budget.reserve({binding,generation,requestId,purpose,estimatedInputTokens,maxOutputTokens,limits?})`: purpose is creation/summary/review/retry. Estimate includes all input components supplied by B plus output reserve. Limits fields are optional on the first reservation and then immutable. `deadlineAt` is Unix **milliseconds**, not ISO text. Defaults: 80 requests, 1,000,000 tokens, eight compactions, no deadline.
- `budget.settle({binding,generation,requestId,status,usage?,errorCode?})`: status known/unknown/cancelled. Known usage is `{inputTokens,outputTokens,totalTokens?}`. Total is authoritative when supplied; otherwise input + output. Do not separately add reasoning or cache counters. Unknown and cancelled requests retain the estimate. Duplicate identical settlement succeeds; contradictory known settlement fails. An unknown/cancelled result can be refined once to actual known usage, with the previous result retained in settlement history. Existing reservations may settle after cancellation but cannot create new requests.
- `budget.boundary({binding,generation,eventId,kind:'compaction'|'tool'})`: durable idempotent event counters. An attempted compaction consumes its counter even if the summary later fails.

All writes return `{requestId,status,budget}`. Reads and settlement require exact binding/generation; reservations require a live task. The review purpose additionally permits a finished current draft with matching passed verification and unchanged world base, because PI can end its main stream before the required review finishes. Other purposes require a live lease. Failed reservations do not consume counters. No compaction resets the ledger.

## Recovery

Broker startup invokes `task_recover()` after verification/review/application job recovery. Running workspace leases become interrupted, leases are released, reserved requests become unknown, code remains in SQLite, and no model request replays.

- `task.recoverable({projectId,worldId?})` lists at most 64 interrupted records.
- `task.resume({taskId,generation,context})` requires the same project/session and a fresh host turn ID. It atomically opens the new task, retains the draft, increments generation, retains the original budget owner and requirements, and closes the old identity. It returns `{workspace,generation,budget,modelReplay:false}`.
- `task.discard({taskId,projectId,generation})` retires the interrupted session head; original draft/history remains inspectable. It does not overwrite the formal world.

Generic `workspace.open` refuses interrupted heads with `EXPLICIT_RECOVERY_REQUIRED`. A changed unapplied base fails with `DRAFT_BASE_CONFLICT`; already applied drafts advance through the existing application receipt rule. Every resume transition uses the same immediate transaction as workspace opening.

## Integration notes

Register explicit business channels, never a generic core-call proxy. Read actual host user text, open its workspace, record context once by message ID, then read task context for B. A context snapshot cannot authorize a later write after a new turn replaced its identity. Existing public error messages remain compatible; new callers should treat the leading uppercase error marker as the stable code. Structured error envelope support follows in this package.

`workspace.current({projectId,sessionId})` returns `WorkspaceSnapshot|null`, including finished/interrupted tasks. `application.list({worldId,limit?})` returns `{items:[{id,status,worldId,verificationId,reviewId,buildId,current,createdAt}]}`; limit defaults to 12 and is capped at 50. Neither needs an invented current turn ID.

## Immutable library

Import `createLibraryService` from `plugins/craftmine-world/library-service.mjs` and construct it with `{call:(method,params)=>core.call(method,params)}`. The adapter reuses the existing package validator, creation materializer, compiler and asset/extension validators; it does not create another writable library.

- `search({query?,kind?,tags?,scope?:{projectId,worldId?},offset?,limit?})` delegates `library.search`, returning `{items,total,offset,limit,next}`. Each item includes `ref`, kind/name/description/tags/scope, source world/build, application/check/review IDs, runtime, dependencies, created time and separate proposed/verified/applied provenance facts. Limit 1–50; maximum 4,096 immutable versions. Local explicit library search/reuse can cross worlds and projectless session IDs.
- `read({ref:{id,version,hash},start?,limit?})` returns metadata, packageHash and bounded `source:{text,start,next,totalChars}`. Text is the old-format module JSON; no binary asset body is returned to the model. Default 12,000, maximum 16,000 characters. Private Rust `library.read({ref})` returns the full `{ref,bundle,packageHash,metadata}` for the trusted adapter.
- `capture({operationId,applicationId,worldId,kind,resourceId,id?,version?,tags?,scope,description?})` extracts from the real applied artifact. Kind is object/gameplay/creation. Default ID derives deterministically from operationId; default version is 1. The caller explicitly selects higher immutable versions. Scope must match the actual application owner; G must inject it. Result `{ref,packageHash,metadata}`. Rust joins stored application/check evidence, validates source payload fields/positions/target mappings, and rejects forged or mismatched provenance. Repeated operationId is stable.
- `prepareInstall(context,{ref,revision,position?})` returns `{operations,idMap,dependencies,conflicts,packageHash,revision}` without writes. Invalid/missing/conflicting dependencies throw a stable error, rather than return an installable partial plan.
- `install(context,toolCallId,{ref,revision,position?})` commits the actual compiled draft through `workspace.commit`; returns `{receipt,ref,packageHash,idMap,dependencies,applied:false}`. Lost-reply replay returns `{receipt,replayed:true}`. New calls get independent IDs. Preparation is not formal application; normal check/review/application remains mandatory.

`craftmine.library-bundle/1` is a storage envelope `{format,module,assets,extensions}` around the unchanged module/1–4 package. Fixed asset and extension bodies are included and checked against their source artifact; missing/conflicting versions fail before the draft commits. Existing system configuration is preserved; differing system config fails rather than silently replacing health/gun settings. Object/behavior aliases are rebound through the existing binding ABI. Authored shared item IDs intentionally remain shared; the adapter does not rewrite arbitrary source strings or extension code.

Package storage is bounded at 64 MiB. Existing 2,000,000-byte draft limit remains, including installed dependencies; a large asset package currently fails `DOCUMENT_TOO_LARGE` instead of bypassing the draft limit. Installing asset-heavy packages above this cap needs a future immutable external-reference transaction. Creation groups retain the existing 16-object/eight-script limit.

## Typed memories

`createMemoryService({call})` exports `search`, `propose`, `retire`:

- `search({scope:{projectId,worldId?,moduleId?},query?,kind?,includeInactive?,runtimeVersion?,sourceHashes?,offset?,limit?})` returns `{items,total,offset,next}`. World ID is authoritative private scope across projectless sessions; a different world does not inherit it. Limit 1–50, 2,048 records per scope. Runtime/source changes mark previously validated affected records `needs_revalidation` persistently.
- `propose({context,operationId,record})` accepts the existing memory/1 record (format optional), forces initial proposed status, and binds its world to the actual task. Kinds remain project-rule/verified-experience/task-history/workflow; user corrections are project rules with user source refs. Only exact journaled user text can validate a user rule. Only a literal frozen successful request assertion for the current draft can validate an experience. Invented references remain proposed; model-supplied validated status is rejected. Source-dependent verified experiences store the actual current draft hash. New unverified proposals cannot supersede a validated rule.
- `retire({scope,id,reason})` retains prior record/history. New IDs and supersedes form immutable replacement history; same-ID overwrites fail.

The JS adapter preserves the legacy memory validator; Rust checks provenance independently. Host-bounded world scope is required when injecting memory into B. Pass only current validated records to request context; proposed/retired/stale entries are displayable records, not trusted instructions.

## Backup content and atomic recovery

E owns trusted file selection and file IO. Rust accepts no filesystem paths for these calls:

- `backup.export({operationId})` returns `{id,status:'completed',kind:'export',archive,manifest:{hash,bytes,schemaVersion},credentialsIncluded:false}`.
- Archive is a JSON object `{format:'craftmine.domain-backup/1',schemaVersion:1,createdAt,tables,hash}`. It contains the full local domain store: worlds/latest progress, drafts, fixed library/assets/extensions, memory/history, source evidence and budget records. Credential stores, Chromium data, arbitrary files and raw legacy import archives are excluded. Existing local legacy manifests remain and dangling world links are detached when a world is removed by restore.
- `backup.inspect({archive})` validates format, exact table/column allowlist, JSON hash, SQLite constraints/FKs, world/draft/package/evidence content hashes in an isolated in-memory SQLite database. It returns `{valid,hash,counts,knownLocalExport,bytes}`. A checksum alone is not acceptance.
- `backup.status({})` returns `{currentHash,archiveLimitBytes,schemaVersion}`. `backup.status({id})` reads a receipt.
- `backup.restore({operationId,archive,expectedCurrentHash})` is a full local domain replacement. It rejects active leases/jobs, validates before starting the write transaction, compares the current fingerprint, and atomically restores all tables. Return `{id,kind:'restore',status:'completed',archiveHash,previousHash,currentHash,modelReplay:false,importedProvenance}`. Exact previous domain state is retained in the restore receipt's internal archive. Repeated requests recover the original receipt.
- `backup.cancel({operationId})` revokes a not-yet-started restore. Once the synchronous atomic transaction has started it completes or rolls back; cancellation does not interrupt between writes. Completed jobs cannot be cancelled.

Archives are bounded to 32 MiB serialized JSON, 100,000 rows per table. Receipt retention is bounded to 64 jobs/128 MiB; exceeding capacity fails clearly. A receipt-retention management UI is not included in A. Portable unknown archives preserve package contents but lose trusted applied provenance and validated memory status; revalidation is required. Locally recognized export hashes preserve historical trusted evidence. Restore closes pending jobs/leases and never replays the model.

## Errors and integration patch

New RPC failures include `{code,message,retryable}` while preserving the legacy `message`. Unknown fields are rejected on new boundaries. Conflict examples: STALE_DRAFT, IMMUTABLE_VERSION_CONFLICT, CAPTURE_CONTENT_MISMATCH, LIBRARY_HASH_MISMATCH, FIXED_DEPENDENCY_CONFLICT, SYSTEM_CONFIG_CONFLICT, MODEL_CANNOT_VALIDATE_MEMORY, EXPLICIT_RECOVERY_REQUIRED, BACKUP_HASH_MISMATCH, BACKUP_CURRENT_STATE_CONFLICT, BACKUP_RESTORE_WORLD_BUSY.

`integration.patch` only suggests re-exporting the two service factories through the existing domain bundle. G owns actual broker channel/tool registrations, host identities, tool IDs, capabilities, source packaging and lifecycle. No patch overlay was used to obtain the A test results. G already owns the separate draft asset/extension compiler integration; the A Rust verification gate accepts exact draft extensions while retaining all previously loaded versions.

The Rust service now holds an OS-backed exclusive writer lock for its data directory before any startup recovery. A second broker fails without changing live leases. The five actual process suites include this boundary. No new dependency is required.
