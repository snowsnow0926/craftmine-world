# R1 对外接口：受管理 Git 内容历史（craftmine-core RPC）

所有方法经 `craftmine-core --data-dir <abs>` 的 stdio JSON-lines 调用：
`{"method":...,"params":{...}}` → `{"id":null,"result":{...}}` 或
`{"error":{"code":"...","message":"...","retryable":false},"id":null}`。
下列示例均为 `evidence/r1-*.responses.jsonl` 中的真实响应（节选字段）。

## 0 能力与来源

```json
{"method":"hello","params":{}}
{"id":null,"result":{"format":"craftmine.core/1","storage":"sqlite","godotProjects":true,
 "godotExecution":false,"godotBuildJobs":true,"godotExecutorGate":true,
 "contentHistory":true,"managedGit":true,...}}

{"method":"content.gitInfo","params":{}}
{"id":null,"result":{"format":"craftmine.git-info/1",
 "path":"C:\\Program Files\\Git\\mingw64\\bin\\git.exe","version":"2.53.0.windows.1",
 "versionMajor":2,"versionMinor":53,"sha256":"<64 hex>","source":"pathFallback",
 "minimum":{"major":2,"minor":38}}}
```
`source` 只能是 `bundled` 或 `pathFallback`；正式交付前不得把 `pathFallback` 说成随包。

## 1 状态与迁移

```json
{"method":"content.status","params":{"worldId":"a"}}
{"id":null,"result":{"format":"craftmine.content-status/1","worldId":"a","registered":true,
 "backend":"git","repoId":"world-a","headOid":"<oid>","appliedOid":null,
 "gitDir":"<data>\\content-history\\repos\\<key>\\repo.git",
 "branches":[{"name":"refs/heads/main","oid":"<oid>","objectType":"commit","symref":null}],
 "migratedRevisions":1,"git":{...}}}
```
世界未登记时 `registered:false`，其余字段省略。

```json
{"method":"content.migrate.plan","params":{"worldId":"a"}}
{"id":null,"result":{"worldId":"a","repoId":"world-a","objectFormat":"sha1","headRevision":0,
 "sourceDigest":"<64 hex>","revisions":[{"revision":0,"taskId":"...","manifestHash":"<64 hex>",
 "fileCount":3,"byteCount":162}],"problems":[]}}

{"method":"content.migrate.apply","params":{"worldId":"a"}}
{"id":null,"result":{"worldId":"a","alreadyMigrated":false,"imported":1,"adopted":0,
 "headOid":"<oid>","mapping":[{"revision":0,"commitOid":"<oid>","treeOid":"<oid>",
 "manifestHash":"<64 hex>","fileCount":3,"byteCount":162}],"problems":[]}}

{"method":"content.migrate.verify","params":{"worldId":"a"}}
{"id":null,"result":{"format":"craftmine.content-migration-verification/1","worldId":"a",
 "problems":[],"verified":true}}
```
`problems` 非空即阻断；`apply` 要求 `plan.problems` 为空
（`CONTENT_MIGRATION_SOURCE_INVALID`）。没有旧修订时 `apply` 报
`CONTENT_MIGRATION_NO_LEGACY_REVISIONS`。迁移后世界后端为 `git`，旧表只读。

## 2 历史、分支、版本、检查点

```json
{"method":"content.history","params":{"worldId":"a","rev":"main","skip":0,"limit":10}}
{"id":null,"result":{"skip":0,"limit":10,"total":2,"nextSkip":null,"records":[
 {"oid":"<oid>","parents":["<oid>"],"authorName":"Craftmine",
  "authorEmail":"craftmine-local@craftmine.local","authoredAt":"2026-09-10T02:22:54+08:00",
  "subject":"Craftmine project revision 1","requestId":"patch-1","taskId":"work-...",
  "legacyRevision":null,"legacyManifestHash":null}]}}
```
`legacyRevision`/`legacyManifestHash` 只对迁移提交有值。`limit` ≤ 200。

```json
{"method":"content.branch.create","params":{"worldId":"a","branchId":"idea-one",
 "fromRev":"<oid>","title":"idea one","requestId":"optional","taskId":"optional"}}
{"id":null,"result":{"worldId":"a","branchId":"idea-one","fromOid":"<oid>",
 "headOid":"<new oid>","treeOid":"<oid>"}}

{"method":"content.branch.list","params":{"worldId":"a"}}
{"id":null,"result":{"worldId":"a","branches":[{"name":"refs/heads/idea-one","oid":"<oid>",
 "objectType":"commit","symref":null},...]}}
```
`content.branch.merge {worldId,base,ours,theirs}` 返回
`{tree,conflicted,messages,conflicts}`；`conflicted:true` 时 `tree` 为 null，
**Git 合并成功不等于玩法成功**。

`content.version.create {worldId,versionId,rev,message}` → `{versionId,oid,tag}`；
`content.version.list {worldId}` → `{versions:[...]}`。
`content.checkpoint.set {worldId,taskId,sequence,rev}` → `{oid,ref}`；
`content.checkpoint.list {worldId,taskId}` → `{checkpoints:[...]}`。

## 3 读取与差异

```json
{"method":"content.readFile","params":{"worldId":"a","rev":"main","path":"world.gd",
 "encoding":"text"}}
{"id":null,"result":{"worldId":"a","rev":"main","path":"world.gd","bytes":32,
 "sha256":"<64 hex>","text":"extends Node3D\nvar damage := 12\n"}}
```
`encoding` 为 `base64` 时返回 `base64` 而不是 `text`（二进制资源）。

- `content.changes {worldId,from,to}` → `{changes:[{status,path}]}`
- `content.diff {worldId,from,to,path}` → `{kind:"text",path,added,removed,patch}` 或
  `{kind:"binary",path,oldBytes,newBytes}`
- `content.verify {worldId,refs?}` → `{refs,problems,verified}`；`refs` 省略时用受保护引用 +
  全部分支
- `content.reclaim.plan {worldId,keep?}` → `{keepRefs,garbageObjects,garbageBytes,
  reachableObjects,referencedElsewhere,sample}`
- `content.reclaim.prune {worldId,keep?}` 同上并真正删除无引用垃圾
- `content.bundle {worldId,target,refs?}` → `{target,refs,bytes,sha256}`（target 必须绝对路径）

## 4 应用引用事务（Git 半边）

`OperationContext` 的三个 `expected*` 键必须存在，可为 `null`。

```json
{"method":"content.apply.prepare","params":{"worldId":"a","kind":"apply","targetOid":"<oid>",
 "detail":"first apply","context":{"operationId":"op-apply","worldId":"a","repoId":"world-a",
 "branchId":"main","expectedHeadOid":"<oid>","expectedAppliedOid":null,
 "expectedProgressRevision":null}}}
{"id":null,"result":{"operationId":"op-apply","worldId":"a","repoId":"world-a",
 "branchId":"main","kind":"apply","state":"prepared","targetOid":"<oid>",...}}
```
- `content.apply.advance {operationId}` → `state:"refAdvanced"`（CAS 推进
  `refs/craftmine/applied/<world>`，重复调用幂等）
- `content.apply.confirm {operationId,appliedOid,detail}` → `state:"committed"`
- `content.apply.rollback {operationId,reason}` → 引用 CAS 回旧值或删除
- `content.apply.recover {worldId}` → `{appliedOid,actions:[{action,operation_id,target_oid}]}`，
  `action` 取 `complete|rollBack|conflict`。**任何情况都不报“应用成功”**。

调用顺序：`prepare → advance → 调用方提交部署/进度/回执 → confirm`；重启走 `recover`。

## 5 工程读写（Git 后端世界）

旧方法保持不变，但在 Git 后端世界上写入 Git：

```json
{"method":"godotProject.patch","params":{"context":{...},"worldId":"a","toolCallId":"patch-1",
 "revision":0,"manifestHash":"<64 hex>",
 "operation":{"operationId":"op-patch","worldId":"a","repoId":"world-a","branchId":"main",
   "expectedHeadOid":"<oid>","expectedAppliedOid":null,"expectedProgressRevision":null},
 "operations":[{"op":"put","path":"world.gd","text":"...","expectedHash":"<64 hex>"}]}}
{"id":null,"result":{"revision":1,"manifestHash":"<64 hex>","baseBuild":"base-a",
 "fileCount":3,"currentTaskId":"work-...","lastWriter":{...},
 "commitOid":"<oid>","assetLockHash":"<64 hex>"}}
```
错误：`CONTENT_OPERATION_CONTEXT_REQUIRED`（Git 后端世界缺 `operation`）、
`CONTENT_WRITE_BRANCH_NOT_MAIN`、`CONTENT_EXPECTED_HEAD_MISMATCH`、
`GODOT_PROJECT_REVISION_CONFLICT`、`PROJECT_FILE_CONFLICT`、`NO_CHANGE`、
`CONTENT_BACKEND_SWITCHED`（legacy 世界在迁移后被旧路径写入时，仅 legacy 分支调用）。
`godotProject.index/read` 返回 `commitOid` 语义的头索引；历史修订浏览请用
`content.history` + `content.readFile`。

## 6 构建与进度

- `godotBuild.start` 在 Git 后端世界从 commit 物化，构建身份含
  `contentOid` 与 `assetLockHash`（同一 revision 不同 commit = 不同构建）。
- 候选在 commit 变动后 `godotApplication.prepare` 报 `GODOT_CANDIDATE_STALE`。
- `godotRuntime.saveProgress` 只接受存在 `applied` 应用记录的构建，否则
  `GODOT_BUILD_NOT_APPLIED`；`world.build.id` 自述不构成证据。

## 7 表与登记点

新增/使用表：`craftmine_godot_project_commits`（世界 revision → commit）、
`craftmine_content_repositories`、`craftmine_content_revision_map`、
`craftmine_content_migrations`、`craftmine_content_operations`、
`craftmine_content_operation_receipts`。
`lib.rs::open` 顺序：`godot_projects → godot_builds → godot_jobs → godot_applications
→ godot_storage → godot_worlds → content_history::migration → content_history::apply`。
Git 对象与引用在 `<data>/content-history/repos/<key>/repo.git`，不在 SQLite 中。

## 8 给 R4/R5/R6 的要点

- **R6**：共享类型从 `crate::content_history::contract` 导入，禁止另建相似结构；运行
  `content_history::contract_vectors_tests` 的同一 JSON。
- **R5**：完整备份需包含上表与 `<data>/content-history/repos/**`；恢复后用
  `content.verify`、`content.migrate.verify` 复核；保护引用通过 `content.reclaim.plan`
  的 `keep` 传入。
- **R4**：作品版本用 `content.version.create`；导出用 `content.bundle`；
  新世界复制用 `godotWorld.copy`（Git 后端世界仍走旧路径，会显式失败，见报告 §5.8）。
- **R7**：补丁必须携带宿主填写的 `OperationContext`，模型不得自造 `expectedHeadOid`。
