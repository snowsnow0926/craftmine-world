# R5 报告：真正完整备份、迁移恢复与安全回收

任务标识：`godot-round2-R5`
分支：`codex/godot-round2-r5-20260910`
工作树：`D:\Craftmine World-worktrees\godot-round2-r5-20260910`
基线：本地 master `bcebeb1`；已保留历史合入 `da41621`（H）、`7906c5b`（A）、`de9f4b0`（M）、`b646b2e`（N）
代码提交：`93d44c6`

## 0 结论摘要

**已完成的实质部分**：新增 `craftmine.portable-archive/1`，一个真正自包含的流式归档；在**完全新的数据目录**、且**原数据目录已被改名而不可读**的条件下恢复成功，并逐项校验世界、进度、草稿、源码正文、素材正文与 Git 历史。原始证据见 `evidence/rust-portable-evidence.txt`。

**同一提交内的引用保护**：归档在读取任何正文之前，就在同一事务里写入耐久 `craftmine_backup_pins`，并提供 `backup.protectedRefs` 给 R1/R6 消费。已用 **A 的真实接口** `godot_storage_reclaim_plan` 联测：保留中的归档把构建标为 `CALLER_PINNED`，释放后交还回收。没有使用任何 mtime/年龄阈值。

**未完成（明确保留）**：

1. **RPC 与界面未接线**。`main.rs`、宿主通道、恢复界面分别属于 R1/R2/R7，R5 未修改；本报告给出版本化分发片段（`INTERFACE_R5.md` §2）。因此**没有 RPC 级端到端证据**。
2. **R1 的回收协调器尚未消费 `backup.protectedRefs`**。R5 侧契约与联测已完成，R1 侧接入待落地；A 提出的源码 blob 写入并发缺口需要 R1 在回收实现中按该契约收口。
3. **进程级崩溃矩阵未全跑**。已覆盖坏包、缺正文、错误版本、路径置换、截断、取消、导出中断后重启；**磁盘满、锁文件竞争、各持久边界的进程退出与回包丢失未逐项实测**。
4. **真实引擎、真实产品模型、手感**均未参与，本模块不涉及这三类证据。
5. 归档的 Git 载体使用 `rev-list --objects --all` + `cat-file --batch` 与 `hash-object -w` + `update-ref`，**不是** M 已提供的 `RepositoryStore::bundle`：导入 bundle 需要 `git fetch`/`clone`，而 `content_history/git.rs::ALLOWED_SUBCOMMANDS` 不含二者。改用 bundle 需 R1 扩白名单。

## 1 逐条对照本轮任务

### 1.1 第 1 条：流式归档与共同一致性边界 —— 完成

* 单文件容器：`MAGIC` + 一行 JSON 头 + 每条目「一行 JSON + 原始字节」+ 一行 JSON 尾。正文按 128 KiB 分块流式写入并单遍哈希，**内存占用与归档大小无关**，不再受 32 MiB JSON 上限约束（分项上限：单正文 4 GiB、域快照 1 GiB、单行元数据 8 MiB）。
* 域快照 = **按活库 schema 发现**的全部 `craftmine_*` 表逐行快照（含草稿、进度、依赖、包与库正文、素材元数据、Git 仓库登记）。运维表 `craftmine_backup_jobs`/`craftmine_backup_pins` 不随用户归档外流。
* 不可重建正文，全部从耐久行枚举而非“顺手拷目录”：
  * 封存旧归档：`craftmine_legacy_imports` 清单 + 清单内每个源文件；
  * Godot 源码 blob：`craftmine_godot_revisions` 清单 → `godot-source/<worldKey>/blobs/<sha256>`；
  * Godot 世界素材正文：`craftmine_godot_assets` → `godot-assets/<worldKey>/<sha256>`；
  * 素材库正文：`craftmine_asset_files` → `asset-catalog/blobs/<xx>/<sha256>`；
  * Git：每个受管仓库从其固定引用的可达对象集读取（对象 + 类型），引用表另存。
* 依赖锁：`craftmine.assets-lock/1` 作为 Git blob 随对象一起归档，包依赖关系随域快照归档。
* 可重建缓存明确排除并**具名说明**：`godot-import-cache`、`godot-build-artifacts`、`godot-build-cache`、`content-repo-copies`、`git-config`。
* 共同边界写入头部 `consistency`：域快照哈希、表数、正文根、各类引用计数、`credentialsIncluded:false`、`sessionIncluded:false`，并声明“先单事务快照 + 同事务写入保护钉住，再读取不可变正文，每个正文边读边重算哈希”。

### 1.2 第 2 条：新目录 + 来源不可读恢复 —— 完成

`portable_archive_restores_into_a_new_directory_without_the_source`（`portable_tests.rs`）实际执行顺序：

1. 合成夹具：2 个世界、1 个封存旧归档（含 2 个源文件）、3 个 Godot 源码 blob、1 个 Godot 世界素材正文、1 个素材库正文、1 个 Git 仓库（2 次提交 + main 分支）。
2. 导出到数据目录之外的归档文件 → 校验通过。
3. **把原数据目录改名到另一个临时目录**，断言原路径不再存在（`sourceStillResolves:false`，证据文件）。
4. 打开一个**全新数据目录**的 `TaskJournal`，原地恢复。
5. 断言：世界数 2、世界 A 进度与原快照逐字段相等、旧归档源文件字节相等、源码 blob 字节相等、Godot 素材正文与素材库正文字节相等、Git 的 main 头 OID 与源相同且 `project.godot` 内容相同、恢复后 `currentHash == 归档 domainHash`、原目录未被改动。

原始证据（`evidence/rust-portable-evidence.txt`）：

* 归档 16 条目录项、15 个正文、`contentBytes=15247`，头部逐项列出 `path`/`kind`/`bytes`/`sha256`；
* `backup.verifyPortable` → `valid:true`、`verifiedFiles:15`；
* 源不可读条件 → `sourceStillResolves:false`、`movedStillResolves:true`；
* 恢复回执 → `status:completed`、`domainHash == currentHash`；
* 恢复后状态 → `worlds:2`、`legacyProjectRestored/sourceBlobRestored/godotAssetRestored/assetBlobRestored:true`、`gitHeadMatchesSource:true`、`gitFileMatchesSource:true`。

### 1.3 第 3 条：失败不破坏原世界 —— 部分完成

已实测（每项都有断言）：

| 场景 | 结果 |
| --- | --- |
| 正文单字节篡改 | 校验/恢复均报 `BACKUP_HASH_MISMATCH`，目标保持空 |
| 归档截断 | 报 `BACKUP_ARCHIVE_TRUNCATED` 等，目标保持空 |
| 条目路径置换（`../`、绝对路径、盘符、反斜杠） | `INVALID_ARCHIVE_PATH` |
| 归档内缺正文/尺寸不符 | 导出即 `BACKUP_CONTENT_MISSING`/`BACKUP_CONTENT_CHANGED` |
| 目标已有世界 | `BACKUP_TARGET_NOT_EMPTY`，原世界不变 |
| 导出被中断（作业停在 `streaming`） | 重启扫描把钉住标为 `abandoned`，不产生伪成功保护 |
| 取消/磁盘满 | 写 `<archive>.partial`，失败即删除并标记作业 `failed`、钉住 `abandoned`（代码路径已实现；**磁盘满未用真实满盘实测**） |

未完成：磁盘满、锁文件竞争、各持久边界逐一杀进程与回包丢失的矩阵。

### 1.4 第 4 条：统一引用保护 —— R5 侧完成，R1/R6 接入待落地

* `craftmine_backup_pins`（archive_id, kind, ref, world_id, status, archive_hash, created_at, updated_at），kind 覆盖 `build`、`godot-source-blob`、`godot-asset-body`、`asset-blob`、`git-ref`、`legacy-import`、`repository`。
* 钉住在**域快照同一事务**内写入，状态先 `streaming`，归档落盘并校验通过后改 `retained`；启动 `backup_recover` 只在导出作业确已完成时提升，否则 `abandoned`。
* `backup.protectedRefs` 返回 R1/R6 消费的唯一集合（`builds`/`sourceBlobs`/`assetBlobs`/`godotAssetBodies`/`gitRefs`/`legacyImports`），并显式声明 `ownedByOthers`。R5 不另开删除流程。
* 联测（`retained_archives_protect_content_from_the_reclaimer`）：用 A 的真实 `godot_storage_reclaim_plan` 验证 `CALLER_PINNED`；`backup.releasePortable` 后该构建重新进入 `deletable`。
* 对 A 的两个并发缺口，R5 给出可执行契约（`INTERFACE_R5.md` §3.1）：回收只删「无行引用且无 pin/在途声明」的对象，删除先移入隔离目录，**禁止**以 mtime 作为并发安全依据。**源码 blob 回收实现本身属 R1，尚未落地。**

### 1.5 第 5 条：总回收协调 —— 未完成（属 R1）

R5 只提供保护引用；`godotStorage.reclaimPlan/reclaimCommit` 的协调、Git 回收与素材回收执行分别属 R1/R6。本报告不声明这条完成。

### 1.6 第 6 条：RPC / 恢复界面 / 查询入口 —— 未完成（属 R1/R2/R7）

R5 提供版本化分发片段与返回结构（`INTERFACE_R5.md` §2、§5）。**未修改 `main.rs`、宿主通道或界面**，因此没有 RPC 级证据。

## 2 与计划验收的对应

| 条目 | 状态 | 依据 |
| --- | --- | --- |
| V13 完整备份与全新目录恢复 | 模块层通过 | 新目录 + 源不可读恢复、逐正文哈希、域哈希一致 |
| Godot A13/A14 中与本模块相关部分 | 部分 | 旧世界副本与失败保持旧世界由 H/A 负责；本模块保证备份/恢复不破坏原世界 |
| CP-A18 备份恢复、旧包转换、归档清理 | 部分 | 历史/正文/选定进度可恢复、原库未被破坏；「归档清理」执行属 R1/R6 |
| AL5 新目录恢复完整 | 部分 | 素材正文与 Godot 素材正文均在归档内并恢复成功；素材界面属 R6 |
| VM4 引用保护 | 契约完成 | `backup.protectedRefs` + 与 A 真实接口的联测 |

## 3 验证命令与证据

```powershell
cd "D:\Craftmine World-worktrees\godot-round2-r5-20260910\vendor\pi-desktop"
$env:CARGO_TARGET_DIR="$env:PI_SCRATCH_DIR\cargo-target-r5"
cargo test -p craftmine-core --lib backups::portable
# test result: ok. 7 passed; 0 failed; 1 ignored

cargo test -p craftmine-core
# test result: ok. 201 passed; 0 failed; 3 ignored（未注册 content_history 前基线为 153 passed）
```

* `evidence/rust-portable-tests.txt`：本模块 7 项断言原文。
* `evidence/rust-full-crate-tests.txt`：整 crate 回归原文（201 通过、0 失败）。
* `evidence/rust-portable-evidence.txt`：归档清单（逐项哈希）、导出/校验/恢复回执、源不可读条件、恢复后状态。
* `tests/godot-round2/R5/README.md`：每个测试证明什么、如何重跑；`run-portable-evidence.ps1` 一键重生成证据。

**证据范围**：全部为合成夹具 + 模块级 Rust 测试。未运行真实 Godot 引擎、正式客户端、真实产品模型；未做手感评估。`tests/browser.mjs`、`tests/modules-browser.mjs` 未运行；未发送真实鼠标键盘、未激活窗口、未操作用户浏览器。全部数据在 `tempfile::tempdir()` 中，未触碰用户存档、共享引擎缓存或历史工作树。

## 4 源码身份与登记

* 源码：`93d44c6`（分支 `codex/godot-round2-r5-20260910`），基线 `bcebeb1`。
* 引擎/二进制身份：无（本模块不涉及引擎二进制）。
* 本分支包含的共享登记（最终合并请以 R1 版本为准并去重）：
  * `lib.rs`：`mod content_history;`（`#[allow(dead_code)]`，R1 会补全其余接线）、`content_history::migration::migrate`、`content_history::apply::migrate`；
  * `backups.rs::migrate`：`craftmine_backup_pins` 表与索引。
* 回归核对：注册 `content_history` 后，`apply_tests` 因缺少 `apply::migrate` 一度 6 项失败；补登记后全绿（见 `evidence/rust-full-crate-tests.txt`）。这是登记缺失，不是 H/A/M/N 交付的断言被削弱。

## 5 仍需外部输入的具体项

1. **R1**：`main.rs` 分发 `backup.exportPortable/inspectPortable/verifyPortable/restorePortable/protectedRefs/releasePortable`，启动序列加入 `journal.backup_recover()?`；把 `backup.protectedRefs` 接入 `godotStorage.reclaimPlan.protectedBuilds` 与新的源码 blob/Git 回收条件。
2. **R1**：若要改用 `RepositoryStore::bundle` 作为 Git 载体，需在 `content_history/git.rs::ALLOWED_SUBCOMMANDS` 增加 `fetch`（R5 未改他人白名单）。
3. **R2**：恢复界面接 `backup.restorePortable`，展示 `rebuildRequired`（构建物需由固定工具链重建）。
4. **R7**：查询入口用 `backup.inspectPortable`（只读、代价低），提案入口只传 `operationId` 与宿主提供的目标路径。
5. **R6**：素材正文回收消费 `assetBlobs`/`godotAssetBodies`。
6. **主任务**：`lib.rs` 的 `content_history` 登记与 R1 的版本合并去重；`SCHEMA_VERSION` 与归档版本策略统一。
