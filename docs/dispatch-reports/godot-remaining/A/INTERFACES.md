# A 对外接口清单（craftmine-core RPC）

面向 C/D/E/H/L/I 的完整请求/响应与错误示例。所有方法经 `craftmine-core --data-dir <abs>`
的 stdio JSON-lines 调用，`{"method":...,"params":{...}}`，响应为
`{"id":null,"result":{...}}` 或 `{"error":{"code":"...","message":"...","retryable":false},"id":null}`。
错误码即 `code`，测试断言的是该字符串。

## 1. 执行器与作业（C/B 消费）

### `godotExecutor.status` → 无参数

```json
{"method":"godotExecutor.status","params":{}}
{"id":null,"result":{"format":"craftmine.godot-execution-status/1","engineVersion":"4.7.2-stable",
 "build":false,"check":false,"buildBlockedReason":"GODOT_EXECUTION_UNAVAILABLE",
 "checkBlockedReason":"GODOT_EXECUTION_UNAVAILABLE","executors":[]}}
```
有执行器时 `executors` 每项为
`{"executorId","engineVersion","isolation","evidenceHash","capabilities":{"import","build","check"},"registeredAt"}`。
重启后清空；能力按所需 kind 在全部执行器中选择，能力不足返回
`GODOT_EXECUTOR_CAPABILITY_MISSING`。

### `godotExecutor.register`

```json
{"method":"godotExecutor.register","params":{"executorId":"executor-a","attestation":{
 "format":"craftmine.godot-executor/1","isolation":"appcontainer",
 "evidenceHash":"<64 hex>","engineVersion":"4.7.2-stable",
 "capabilities":{"import":true,"build":true,"check":true}}}}
```
返回 `{"executorId","registered":true,"executionAvailable":true,"attestationHash","isolation","engineVersion","registeredAt","promotedJobs"}`。
错误：`INVALID_EXECUTOR_ATTESTATION`。

### `godotExecutor.revoke`

```json
{"method":"godotExecutor.revoke","params":{"executorId":"executor-a"}}
{"id":null,"result":{"executorId":"executor-a","revoked":true,"interrupted":1,"executionAvailable":false}}
```
只中断该执行器 `claimed/running` 的作业，原因记为 `GODOT_EXECUTOR_REVOKED`。

### `godotJob.checkDescriptor`（仅私有检查服务）

```json
{"method":"godotJob.checkDescriptor","params":{"jobId":"gjob-<64hex>","token":"<claim token>",
 "artifacts":[{"path":"web/index.html","sha256":"<64 hex>","bytes":1234}]}}
{"id":null,"result":{"format":"craftmine.godot-check-descriptor/1","phase":"check",
 "jobId":"gjob-...","inputHash":"<64 hex>","worldId":"g1","buildId":"gbd-<64hex>","baseId":"first-person",
 "root":"<artifacts root>","entry":"web/index.html","threads":true,
 "artifacts":[...],"snapshot":null}}
```
错误：`GODOT_JOB_OWNER_MISMATCH`、`GODOT_JOB_INACTIVE`、`GODOT_RUNTIME_CHECK_REQUIRED`、
`GODOT_EXECUTOR_UNAVAILABLE`、`GODOT_EXECUTOR_CAPABILITY_MISSING`、`GODOT_ARTIFACT_MISSING`、
`GODOT_ARTIFACT_CONFLICT`（大小写重复）、`GODOT_ARTIFACT_TOO_LARGE`、`CORRUPT_GODOT_ARTIFACT`、
`GODOT_WEB_ENTRY_MISSING`、`GODOT_PROGRESS_BASE_MISMATCH`。**不写库、不登记产物、不产生候选。**

### 作业生命周期

- `godotJob.claim {jobId,token,executorId}` → 作业描述（含 `projectRoot`、`cacheRoot`、
  `artifactsRoot`、`files.{source,asset,host}`、`inputHash`）。
- `godotJob.progress {jobId,token,stage,percent}`、`godotJob.heartbeat {jobId,token}`。
- `godotJob.finish {jobId,token,output}` → 终态作业 + `candidateId`（check 且通过时）。
- `godotBuild.read {worldId,jobId,context?}` → 作业 + `sourceStale` + `artifacts`。
- `godotBuild.cancel {worldId,jobId,context?,reason?}` → 取消并幂等回放：

```json
{"method":"godotBuild.cancel","params":{"worldId":"g1","jobId":"gjob-...","reason":"GODOT_USER_STOP"}}
{"id":null,"result":{"jobId":"gjob-...","status":"cancelled","interruptReason":"GODOT_USER_STOP",
 "replayed":false, ...}}
```
`reason` 缺省 `GODOT_CANCELLED_BY_USER`，必须大写字母/数字/下划线，否则 `INVALID_INTERRUPT_REASON`；
已取消再调返回 `replayed:true`；已终态返回 `GODOT_JOB_INACTIVE`。
终态作业字段新增 `interruptReason` 与 `originJobId`。

### `godotJob.continue`（历史草稿接续）

```json
{"method":"godotJob.continue","params":{"context":{"projectId":"project-a","sessionId":"session-a",
 "turnId":"turn-2"},"worldId":"g1","toolCallId":"continue-one","originJobId":"gjob-..."}}
{"id":null,"result":{"jobId":"gjob-...","originJobId":"gjob-...","buildId":"gbd-<64hex>",
 "status":"queued","executionAvailable":true,"blockedReason":null,"replayed":false, ...}}
```
`originJobId` 必须属于同一世界且处于 `interrupted`/`cancelled`/`failed`。
错误：`GODOT_JOB_NOT_CONTINUABLE`、`GODOT_CONTINUATION_STALE`（源已前进）、
`WORLD_BUILD_CONFLICT`（正式世界不再同源）、`REPLAY_MISMATCH`、`GODOT_JOB_NOT_FOUND`、
`PROJECT_WORLD_BINDING_MISMATCH`、`TASK_INACTIVE`/`TURN_ENDED`/`WORLD_LEASE_LOST`。

### `godotJob.usage`

```json
{"method":"godotJob.usage","params":{"worldId":"g1","context":{"projectId":"project-a",
 "sessionId":"session-a","turnId":"turn-1"}}}
{"id":null,"result":{"format":"craftmine.godot-usage/1","worldId":"g1",
 "items":[{"jobId":"gjob-...","taskId":"...","originJobId":null,"kind":"check","outcome":"passed",
  "wallClockMillis":42,"sourceBytes":128,"assetBytes":0,"hostBytes":4096,"artifactBytes":13,
  "artifactCount":1,"buildFiles":7,"recordedAt":1788973028648}],
 "totals":{"executions":1,"wallClockMillis":42,"sourceBytes":128,"assetBytes":0,"hostBytes":4096,
  "artifactBytes":13,"artifactCount":1},
 "limits":{"buildFileCount":4096,"buildFileBytes":4194304,"buildTotalBytes":67108864,
  "artifactCount":4096,"artifactFileBytes":268435456,"artifactTotalBytes":536870912,
  "leaseMillis":120000,"queueTimeoutMillis":600000,
  "unknown":["modelTokens","modelRequests","compactions","contextTokens","serviceQuota"]},
 "unknown":["modelTokens","modelRequests","compactions","contextTokens","serviceQuota"]}}
```
`unknown` 是明确未知，不是 0；不要把它显示成已耗尽或零消耗。

## 2. 首个 Godot 世界（E/D/F 消费）

### `godotWorld.initialize`

```json
{"method":"godotWorld.initialize","params":{"worldId":"g1","title":"新世界","baseId":"first-person",
 "baseBuild":"base-a","snapshot":{"format":"craftmine.godot-progress/1","worldId":"g1",
 "baseId":"first-person","baseVersion":"0.1.0","stateVersion":1,
 "body":{"worldId":"g1","player":{"position":[0,0,0]},"inventory":{}}}}}
{"id":null,"result":{"replayed":false,"world":{"id":"g1","title":"新世界","revision":0,
 "runtimeKind":"godot","baseId":"first-person","world":{"build":{"id":"base-a",
 "scene":{"format":"craftmine.godot-scene/1","baseId":"first-person"},
 "godot":{"baseBuild":"base-a","initializing":true}},"snapshot":{...},"extensions":[]}}},
 "init":{"format":"craftmine.godot-world-init/1","initId":"gwinit-<64hex>","worldId":"g1",
 "title":"新世界","baseId":"first-person","baseBuild":"base-a","status":"pending","reason":null,
 "applicationId":null,"initialSnapshotHash":"<64 hex>","createdAt":1788973028648}}}
```
- `snapshot` 必须是该世界的 Godot 进度，`baseId` 必须与 `baseId` 一致，否则
  `GODOT_PROGRESS_BASE_MISMATCH`；非 Godot 进度报 `INVALID_GODOT_PROGRESS`。
- `baseId` 只能是 `first-person`/`top-down`/`side-view`，否则 `INVALID_GODOT_BASE`。
- 同请求重复调用返回 `replayed:true`；世界已存在或参数不同报 `WORLD_EXISTS`。
- 此时世界**不可游玩**；`godotRuntime.describe` 返回
  `{"error":{"code":"GODOT_WORLD_NOT_INITIALIZED",...}}`。

### `godotWorld.initStatus`

```json
{"method":"godotWorld.initStatus","params":{"worldId":"g1"}}
{"id":null,"result":{"format":"craftmine.godot-world-init/1","initId":"gwinit-...","worldId":"g1",
 "title":"新世界","baseId":"first-person","baseBuild":"base-a","status":"blocked",
 "reason":"GODOT_EXECUTION_UNAVAILABLE","playable":false,"applicationId":null,"candidateId":null,
 "projectRevision":0,"worldRevision":0,"formalBuildId":"base-a","initialSnapshotHash":"<64 hex>",
 "createdAt":1788973028648}}
```
`status` 取值与来源：`pending`（尚未建工程）、`drafting`（有工程头）、`blocked`（最近作业被
能力阻塞，`reason` 为阻塞码）、`building`、`checked`（有 ready 候选）、`failed`（最近作业
`failed`/`interrupted`/`cancelled`，`reason` 为该作业 `interruptReason`）、`confirmed`
（存在 `applied` 应用）。`playable` 仅当 `confirmed` 且正式构建 id 合法。未知世界报
`GODOT_WORLD_NOT_INITIALIZING`。

## 3. 世界副本与备份（H/E 消费）

### `godotWorld.copy`

```json
{"method":"godotWorld.copy","params":{"sourceWorldId":"g1","targetWorldId":"g2",
 "title":"副本","progress":"initial","snapshot":{...},"context":{...}}}
{"id":null,"result":{"format":"craftmine.godot-world-copy/1","copyId":"gcopy-<64hex>",
 "sourceWorldId":"g1","targetWorldId":"g2","buildId":"gbd-<64hex>","sourceRevision":0,
 "manifestHash":"<64 hex>","assetManifestHash":"<64 hex>","progressMode":"initial","world":{...}}}
```
`progress:"formal"` 继承进度（`worldId`/`body.worldId` 改写为目标世界），`"initial"` 用传入
快照。共享同一不可变构建，复制工程头、源码 blob、资源正文。错误：`WORLD_EXISTS`、
`GODOT_WORLD_NOT_COPIABLE`（无正式构建）、`GODOT_BUILD_NOT_APPLIED`、
`GODOT_PROGRESS_BASE_MISMATCH`、`GODOT_PROGRESS_REQUIRED`、`INVALID_PROGRESS`。
副本运行：`godotRuntime.describe {worldId:"g2"}` 返回 `phase:"formal"` 且
`copiedFromWorldId:"g1"`，artifact 根指向源世界存储。

### `godotWorld.backupSnapshot` / `verifySnapshot`

```json
{"method":"godotWorld.backupSnapshot","params":{"worldId":"g1"}}
{"id":null,"result":{"format":"craftmine.godot-backup/1","worldId":"g1","worldRevision":1,
 "contentHash":"<64 hex>","document":{...},"project":{"revision":0,"manifestHash":"<64 hex>",
 "manifest":{...},"files":[{"path","sha256","bytes"}]},"assetManifestHash":"<64 hex>",
 "assets":[{"path","sha256","bytes","mediaType"}],
 "build":{"buildId":"gbd-...","files":[{"path","kind","sha256","bytes"}]},
 "application":{"applicationId","inputHash","outputHash"},
 "init":{...},"snapshotHash":"<64 hex>"}}
```
生成时逐一回读并哈希工程 blob、资源正文、构建文件；任一损坏报 `CORRUPT_GODOT_BUILD` /
`CORRUPT_GODOT_ASSET` / `CORRUPT_PROJECT_FILE`，超过 8 MiB 报 `GODOT_BACKUP_TOO_LARGE`。

```json
{"method":"godotWorld.verifySnapshot","params":{"worldId":"g1","context":{...},"snapshot":{...}}}
{"id":null,"result":{"format":"craftmine.godot-backup-verification/1","worldId":"g1","matches":true,
 "snapshotHash":"<64 hex>","worldRevision":1}}
```
描述符被改动、或现场与描述符不一致，均报 `GODOT_BACKUP_MISMATCH`；不写任何数据。

## 4. 存储计量与回收（L/H/M/N 消费）

### `godotStorage.status`

```json
{"method":"godotStorage.status","params":{"worldId":"g1","context":{...}}}
{"id":null,"result":{"format":"craftmine.godot-storage/1","worldId":"g1",
 "categories":{"sourceHistory":{"revisions":1,"files":3,"bytes":128},
  "assetBlobs":{"assets":1,"files":1,"bytes":9},
  "buildHistory":{"builds":1,"files":7,"bytes":4224},
  "artifacts":{"files":1,"bytes":13},"cache":{"files":0,"bytes":0}},
 "quota":{"limitBytes":536870912,"usedBytes":4361,"remainingBytes":536866551},
 "reclaimable":{"builds":0,"bytes":0},"unreferencedDirectories":[],
 "ownedByOthers":["assetBodies","gitHistory","backups"]}}
```

### `godotStorage.reclaimPlan`

```json
{"method":"godotStorage.reclaimPlan","params":{"worldId":"g1","context":{...},
 "protectedBuilds":["gbd-<64hex>"],"keepRecentBuilds":2}}
{"id":null,"result":{"format":"craftmine.godot-reclaim-plan/1","worldId":"g1",
 "planId":"gpln-<64hex>","planHash":"<64 hex>",
 "deletable":[{"buildId":"gbd-...","files":7,"bytes":4224}],
 "protected":[{"buildId":"gbd-...","reason":"FORMAL_WORLD"}],
 "freedBytes":4224,"unreferencedDirectories":[],
 "limits":{"keepRecentBuilds":2,"ownedByOthers":["assetBodies","gitHistory","backups"]}}}
```
`reason` 取值：`FORMAL_WORLD`、`CANDIDATE`、`APPLICATION`、`ACTIVE_OR_PASSED_JOB`、
`WORLD_COPY`、`CALLER_PINNED`、`RECENT`。`protectedBuilds` 必须是合法构建 id，否则
`INVALID_GODOT_BUILD`；`keepRecentBuilds` > 64 报 `INVALID_RECLAIM_KEEP`。

### `godotStorage.reclaimCommit`

```json
{"method":"godotStorage.reclaimCommit","params":{"worldId":"g1","context":{...},
 "planId":"gpln-<64hex>","planHash":"<64 hex>"}}
{"id":null,"result":{"planId":"gpln-...","planHash":"<64 hex>","status":"completed",
 "reclaimId":"grcl-<64hex>","removedBuilds":1,"freedBytes":4224,"pendingDirectories":0}}
```
计划在事务内重算，引用变化即 `GODOT_RECLAIM_PLAN_STALE`；无内容可删返回 `status:"empty"`。
目录删除失败返回 `status:"pendingCleanup"`，由启动清扫补完（`pendingDirectories` > 0）。

## 5. 数据库迁移登记点

`lib.rs::open` 顺序：`godot_projects` → `godot_builds` → `godot_jobs` →
`godot_applications` → `godot_storage` → `godot_worlds`。新增表：
`craftmine_godot_reclaims`、`craftmine_godot_world_init`、`craftmine_godot_world_copies`；
新增列：`craftmine_godot_jobs.interrupt_reason`、`.origin_job_id`；
`craftmine_godot_job_usage`；`craftmine_godot_build_files` 在旧库上重建以允许 `kind='host'`。
`main.rs` 启动顺序新增 `journal.godot_storage_recover()`。

## 6. 与 H 的边界

`backups.rs` 的 `TABLES` 仍不含任何 `craftmine_godot_*` 表，整域备份/恢复会丢 Godot
数据。H 接入时请以 `godotWorld.backupSnapshot` 为一致性来源，并保留
`craftmine_godot_world_copies` 的来源关系；回收的受保护引用由 H（备份）、M（Git）、N
（素材正文）通过 `protectedBuilds` 传入。
