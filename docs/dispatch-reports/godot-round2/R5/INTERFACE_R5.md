# R5 接口契约：可迁移完整归档、恢复与备份受保护引用

分支：`codex/godot-round2-r5-20260910`
实现：`vendor/pi-desktop/crates/craftmine-core/src/backups/portable.rs`
格式与算法：`vendor/pi-desktop/docs/spec/godot-portable-archive.md`、`vendor/pi-desktop/docs/adr/dispatch-r5-portable-archive.md`

本文件是给 R1（RPC/登记/回收协调）、R2（恢复界面）、R6（素材正文回收）、R7（查询与提案入口）的消费契约。R5 不修改 `main.rs`、`lib.rs` 之外的共享登记，RPC 与界面由对应负责人落地。

## 1. Rust 方法（已实现并通过测试）

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `TaskJournal::backup_export_portable` | `{operationId, archivePath}` | 导出回执 | 流式写入单文件归档；`archivePath` 必须绝对、且不在数据目录内 |
| `TaskJournal::backup_inspect_portable` | `{archivePath}` | 头部摘要 | 只读，不读正文 |
| `TaskJournal::backup_verify_portable` | `{archivePath}` | 校验报告 | 只读，逐正文重算哈希 |
| `TaskJournal::backup_restore_portable` | `{operationId, archivePath, targetDirectory}` | 恢复回执 | 空安装可原地恢复；否则目标必须是独立空目录 |
| `TaskJournal::backup_protected_refs` | `{worldId}`（`null` 表示全部） | 保护引用集合 | R1/R6 的回收输入 |
| `TaskJournal::backup_release_portable` | `{archiveId}` | `{released:n}` | 归档字节已另存后释放保护 |
| `TaskJournal::backup_recover` | 无 | 放弃的钉住数量 | 启动扫描，见 §4 |

## 2. R1：`main.rs` 分发与启动恢复

在现有 `backup.*` 分发旁追加（R1 独占该文件）：

```rust
"backup.exportPortable" => return journal.backup_export_portable(params),
"backup.inspectPortable" => return journal.backup_inspect_portable(params),
"backup.verifyPortable" => return journal.backup_verify_portable(params),
"backup.restorePortable" => return journal.backup_restore_portable(params),
"backup.protectedRefs" => return journal.backup_protected_refs(params),
"backup.releasePortable" => return journal.backup_release_portable(params),
```

启动恢复序列中追加一行（与 `godot_storage_recover` 同级）：

```rust
journal.backup_recover()?;
```

R5 分支已包含两处必要登记，最终合并时请以 R1 的版本为准并去重：

* `lib.rs`：`mod content_history;`（Git 载体依赖）与
  `content_history::migration::migrate(&db)?`。
* `backups.rs::migrate`：新增 `craftmine_backup_pins` 表与索引。

## 3. R1/R6：统一引用保护

```json
{"method":"backup.protectedRefs","params":{"worldId":null}}
```

```json
{"format":"craftmine.backup-protection/1","worldId":null,"archives":1,
 "builds":["gbd-..."],"sourceBlobs":["<64 hex>"],
 "assetBlobs":["<64 hex>"],"godotAssetBodies":["<64 hex>"],
 "legacyImports":["import"],"repositories":["repo-world-a"],
 "gitRefs":[{"repoId":"repo-world-a","ref":"refs/heads/main","oid":"<oid>"}],
 "ownedByOthers":["assetBodies","gitHistory","buildCopies"]}
```

* R1 把 `builds` 原样传给 `godotStorage.reclaimPlan.protectedBuilds`（已用 A 的真实接口联测，见 `portable_tests.rs::retained_archives_protect_content_from_the_reclaimer`）。
* R1 新增源码 blob 回收时，`sourceBlobs`、`gitRefs` 为跳过条件；R6 的素材正文回收使用 `assetBlobs`、`godotAssetBodies`。
* 只有 `streaming` 与 `retained` 状态计入保护；`abandoned`/`released` 不计入。
* 不允许任何一方再用 mtime、目录年龄或“最近未被引用”作为删除依据。

### 3.1 A 提出的两个并发缺口

1. **源码 blob 写入与回收并发**：归档在读取正文之前，已在同一事务写入 `craftmine_backup_pins`。因此“备份正在读取的 blob”不会在读取过程中被回收。对普通写入方（`godot_project_patch` 先写 blob 再提交行）的缺口属于 R1 的回收实现，建议契约是：回收只删除“无任何行引用 **且** 无任何 pin/在途声明”的对象，并采用“先移动到隔离目录、失败即放弃”的删除方式；仍不得引入 mtime 阈值。
2. **孤儿构建物化竞争**：`unreferencedDirectories` 只报告。删除前需 R1 在同一事务内重算计划（已有 `GODOT_RECLAIM_PLAN_STALE`），并跳过仍被 pin 的构建 id。

## 4. 崩溃与取消语义

* 导出先写 `<archive>.partial`，全部校验通过后改名；进程退出或磁盘满不会留下可被当作备份的文件。
* `craftmine_backup_pins.status='streaming'` 的钉住由 `backup_recover` 处理：导出作业已完成 → `retained`；否则 → `abandoned`。不使用时间阈值。
* 恢复失败时删除 `.portable-staging-*`，目标目录保持原样；原地恢复仅在安装为空时允许。

## 5. R2 / R7 界面与入口

* R2：`backup.exportPortable` 返回的 `archivePath`、`manifest.hash`、`content`、`rebuildableExcluded`、`consistency` 可直接用于“备份完成/包含内容”面板；`backup.restorePortable` 返回的 `restoreReport.rebuildRequired` 需要提示“构建物需由固定工具链重建”。
* R7：查询入口读 `backup.inspectPortable`（不读正文，代价低）与 `backup.protectedRefs`；提案入口只提交 `operationId` 与目标路径，路径由宿主提供，模型不得自选绝对路径。
* 恢复前的只读预检顺序建议：`backup.inspectPortable` → `backup.verifyPortable` → `backup.restorePortable`。

## 6. 错误码

`BACKUP_ARCHIVE_MISSING`、`BACKUP_ARCHIVE_TRUNCATED`、`BACKUP_ARCHIVE_TRAILING_BYTES`、
`BACKUP_ARCHIVE_LINE_TOO_LARGE`、`BACKUP_FORMAT_UNSUPPORTED`、`BACKUP_VERSION_UNSUPPORTED`、
`BACKUP_HASH_MISMATCH`、`BACKUP_FOOTER_MISMATCH`、`BACKUP_DUPLICATE_ENTRY`、
`BACKUP_DOMAIN_HASH_MISMATCH`、`BACKUP_HEADER_INVALID`、`BACKUP_ENTRY_INVALID`、
`INVALID_ARCHIVE_PATH`、`BACKUP_CONTENT_MISSING`、`BACKUP_CONTENT_CHANGED`、
`BACKUP_ENTRY_TOO_LARGE`、`BACKUP_ARCHIVE_TOO_LARGE`、`BACKUP_ENTRY_COUNT_LIMIT`、
`BACKUP_DOMAIN_TOO_LARGE`、`BACKUP_UNSUPPORTED_BLOB`、`BACKUP_DOMAIN_INVALID`、
`BACKUP_DOMAIN_MISSING`、`BACKUP_SCHEMA_MISMATCH`、`BACKUP_COLUMNS_MISMATCH`、
`BACKUP_ROW_WIDTH_MISMATCH`、`BACKUP_FOREIGN_KEY_FAILURE`、`BACKUP_DATABASE_CORRUPT`、
`BACKUP_TARGET_NOT_EMPTY`、`BACKUP_TARGET_OVERLAP`、`BACKUP_ARCHIVE_INSIDE_DATA_DIR`、
`BACKUP_ABSOLUTE_PATH_REQUIRED`、`BACKUP_STAGING_EXISTS`、`BACKUP_ARCHIVE_RENAME_FAILED`、
`BACKUP_OBJECT_RESTORE_FAILED`、`BACKUP_OBJECT_ID_MISMATCH`、`BACKUP_REF_RESTORE_FAILED`、
`BACKUP_REPO_CREATE_FAILED`、`BACKUP_GIT_OBJECT_MISSING`、`BACKUP_GIT_TRUNCATED`、
`GIT_REV_LIST_FAILED`、`GIT_CAT_FILE_FAILED`、`REPLAY_MISMATCH`、`BACKUP_ALREADY_STREAMING`。

## 7. 联测命令

```powershell
cd "D:\Craftmine World-worktrees\godot-round2-r5-20260910\vendor\pi-desktop"
$env:CARGO_TARGET_DIR="$env:PI_SCRATCH_DIR\cargo-target-r5"
cargo test -p craftmine-core --lib backups::portable
```

R1 合入 RPC 后的端到端命令应包含：导出 → 校验 → 关闭进程 → 把数据目录改名 → 新数据目录恢复 → 再次校验，并保留原始输出。
