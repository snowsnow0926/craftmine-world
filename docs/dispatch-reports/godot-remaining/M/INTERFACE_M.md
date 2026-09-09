# 任务 M 接口说明：玩家创作 Git 内容历史（VM0–VM2）

状态：已实现并自测通过；**主任务/A 尚未接线**（`lib.rs`/`main.rs` 属 A，本文件给可合并片段）。
基线：`e462147852e36bdfcaf897d3f915c5809fb88670`（本地 master）。
分支：`codex/godot-remaining-m-20260910`。
工作树：`D:\Craftmine World-worktrees\godot-remaining-m-20260910`。
模块：`vendor/pi-desktop/crates/craftmine-core/src/content_history/{mod,contract,git,repo,migration,apply}.rs`。
证据：`docs/dispatch-reports/godot-remaining/M/evidence/`。

本文件是 M 与 N/A/C/D/H/K 的对接契约。实施以本文件与代码提交为准；共享引用格式以本文件第 1 节为唯一定义。

## 0 边界与唯一写入方

| 范围 | 归属 |
| --- | --- |
| `src/content_history/**`、共享引用契约、受管理 Git 适配 | M（唯一写入方） |
| `src/asset_catalog/**`、素材正文/索引/预览 | N |
| `lib.rs`/`main.rs`/`worlds.rs`/共享迁移登记、`godot_projects.rs` 旧入口守卫 | A |
| `backups.rs` 备份范围、作品组合与安装升级 | H |
| 真实 Godot 构建/执行/检查、实例提升 | C/D |
| 受保护引用、回收条件统筹 | A 统筹，M 提供并执行合格 Git 回收 |

Git 是源码内容、父子关系、分支和版本标签的权威；SQLite 只记录部署、任务、操作日志与进度。**不得再建第二套内容历史**：切换后的世界，旧 `godotProject.create/patch` 必须拒绝写入（第 4 节守卫）。

## 1 共享引用契约（VM0/AL0，与 N 共同冻结；M 维护唯一定义）

定义处：`src/content_history/contract.rs`。N 从 `crate::content_history::contract` 导入，不另建相似结构。

| 类型 | 必需字段（camelCase） | 规则 |
| --- | --- | --- |
| `AssetRef` | `assetId, version, contentHash` | `version` 不得为 `latest`/`head`；`contentHash` 为 64 位小写 SHA-256 |
| `FileRef` | `path, sha256, bytes, mediaType` | 路径为受校验相对路径；`sha256` 独立于 Git OID |
| `ContentRef` | `repoId, commitOid, assetLockHash` | 源码提交 + 素材锁共同确定一份创作内容 |
| `BuildRef` | `content, baseId, baseVersion, engineVersion, target, buildId` | 任一变化必须重新检查 |
| `ProgressRef` | `worldId, progressId, revision, build, stateSchemaVersion, contentHash` | 指向已确认进度，不随分支合并改变 |
| `OperationContext` | `operationId, worldId, repoId, branchId, expectedHeadOid, expectedAppliedOid, expectedProgressRevision` | 三个 `expected*` 键**必须存在**（可为 `null`），宿主填写，模型不可伪造 |
| `AssetLock` | `format, assets[]` | `format == "craftmine.assets-lock/1"` |
| `AssetLockEntry` | `asset, installPath, files[], dependencies[], overrides[]` | 依赖必须闭合；禁止环 |
| `AssetOverrideRef` | `scope, path, contentHash` | 同一 scope 内路径不得大小写冲突 |

### 1.1 规范化规则（冻结）

- 文件名 `craftmine.assets.lock.json`（`ASSET_LOCK_FILE`），格式 `craftmine.assets-lock/1`。
- 规范化文本 = **2 空格缩进 pretty JSON + LF 换行 + 恰好一个结尾换行**；`assetLockHash` = 该字节串的 SHA-256。
- 排序：`assets` 按 `(assetId, version)` 字节序再按 `installPath`；`files` 按 `path`；`dependencies` 按 `(assetId, version)`；`overrides` 按 `(scope, path)`。
- 相同 `(assetId, version)` 且内容不同 → `ASSET_LOCK_VERSION_CONFLICT`；完全重复折叠为一条。
- 未解析依赖 → `ASSET_LOCK_DEPENDENCY_UNRESOLVED`；依赖环 → `ASSET_LOCK_DEPENDENCY_CYCLE`。
- `AssetLock::parse_canonical` 拒绝非规范字节（`ASSET_LOCK_NOT_CANONICAL`）：提交进 Git 的锁文件必须是规范形式。
- 路径：相对、`/` 分隔、≤240 字节、≤16 段、每段 ≤80 字节；拒绝 `..`、绝对路径、盘符、反斜杠、控制字符、Windows 设备名、`.git` 段、大小写冲突（`PATH_COLLISION`）。
- Unicode NFC 由**生产方**负责；哈希永远覆盖存储字节（不做隐式归一化）。
- Git OID：4–64 位小写十六进制（`validate_oid`），**不假设 40 字符**；仓库对象格式记录在 `repo.json`。SHA-256 与 Git OID 是不同命名空间。

### 1.2 冻结测试向量（M/N 共用）

- 生成命令：`cd vendor/pi-desktop; cargo test -p craftmine-core --lib content_history::contract_tests::print_frozen_vectors -- --ignored --nocapture`
- 向量文件：`tests/godot-remaining/M/contract/asset-lock-vectors.json`（含规范文本、golden 哈希、13 类错误向量）。
- 空锁：`EMPTY_LOCK_HASH = 70396c0e7b3582530fb2765684ae9a8bbc6579c93066539e5ed83ce0db5a4809`。
- 夹具锁：`GOLDEN_LOCK_HASH = b95794a2afd498e782e6ec64ec84f1a595d9b56ac723ee4c997a15bbcaad9f0b`。

### 1.3 待 N 确认（冻结清单）

1. 依赖闭包语义：`dependencies` 是否只存直接依赖、由锁文件扁平展开（M 当前实现为“条目集合必须闭合”，即所有依赖都必须是 `assets[]` 中的条目）。若 N 需要区分直接/传递依赖，请提出字段扩展，M 同步更新本文件与向量。
2. `installPath` 是否允许同一资源多安装位置（M 允许，按 `(assetId,version,installPath)` 排序去重）。
3. `mediaType` 取值表（M 只校验非空、≤120 字符、无控制字符）。
4. `overrides` 的 `scope` 命名规范（M 只校验标识符字符集）。
5. 新增错误向量：N 的依赖环/路径/哈希用例请附期望错误码，M 合并进同一向量文件后重新冻结 golden。

## 2 VM0 受管理 Git 适配（给 K 的来源/许可材料）

`src/content_history/git.rs` 是 crate 内**唯一** spawn git 的地方。

- 程序定位：按候选路径顺序找随包 Git；找不到才回退 PATH，并如实记录 `GitSource::{Bundled,PathFallback}`。返回 `GitProgramInfo{path,version,versionMajor,versionMinor,sha256,source}`。
- 版本门槛：`MINIMUM_GIT = (2,38)`；过低报 `GIT_VERSION_TOO_OLD`。
- 实测本机：`git version 2.53.0.windows.1`，`C:\Program Files\Git\mingw64\bin\git.exe`，SHA-256 `d09a1324132aa9da4b4c2b14242dcac893539a735fab288136b101156434a55a`（见 `evidence/git-provenance.txt`）。**这是 PATH 回退，不是随包二进制**；VM0 要求的随包固定版本仍需 K 提供并登记许可。
- 隔离（每次调用强制）：参数数组、无 shell、结构化 stdin；`GIT_CONFIG_NOSYSTEM=1`、`GIT_CONFIG_GLOBAL=<受管理目录>/gitconfig`、`HOME`/`XDG_CONFIG_HOME`/`USERPROFILE` 指向受管理目录；子进程 cwd 固定为受管理中性目录（**避免发现上层产品仓库的 `.git/config`**，已实测到并修复）；`GIT_TERMINAL_PROMPT=0`、失败型 `GIT_ASKPASS`、`GCM_INTERACTIVE=never`；`core.hooksPath=<空目录>`、`core.fsmonitor=false`、`core.autocrlf=false`、`core.symlinks=false`、`core.longpaths=true`、`core.quotepath=false`、`core.pager=cat`、`credential.helper=`、`protocol.allow=never`、`fetch.recurseSubmodules=no`、`submodule.recurse=false`、`gc.auto=0`。
- 子命令白名单（其余 `GIT_SUBCOMMAND_REFUSED`）：init/hash-object/cat-file/ls-tree/mktree/update-index/write-tree/read-tree/commit-tree/update-ref/symbolic-ref/for-each-ref/rev-parse/rev-list/log/show/diff-tree/diff/merge-tree/merge-file/merge-base/mktag/prune/fsck/bundle/config/count-objects/verify-pack/tag/check-ref-format。`clone/fetch/push/submodule/filter-branch/daemon` 等一律拒绝。
- 仓库配置扫描：`assert_managed_config` 拒绝 `core.hooksPath/filter.*/core.fsmonitor/diff.external/difftool.*/mergetool.*/merge.*/credential.*/include.path/includeif.*/alias.*/protocol.*/url.*/http.*/remote.*/submodule.*/uploadpack.*/receivepack.*/gc.*/pager.*/safe.*/core.editor/core.askpass/core.attributesfile/core.sshcommand/core.gitproxy`（节名与键名两种写法都识别）。
- 提交身份：宿主提供显示名 + 稳定标识，邮箱为 `<stableId>@craftmine.local`，**不要求玩家填写邮箱**，不读全局身份。
- 超时：默认 120s，超时杀进程并报 `GIT_TIMEOUT`（测试覆盖）。

## 3 VM1 仓库布局与操作（`src/content_history/repo.rs`）

```
<root>/repos/<repoKey>/repo.git      受管理 bare 仓库
<root>/repos/<repoKey>/repo.json     身份与对象格式（craftmine.content-repository/1）
<root>/repos/<repoKey>/copies/<key>  构建副本（绝不含 .git）
```

- `repoKey` = SHA-256(逻辑 repoId) 前 16 字节；逻辑 ID 永不作为文件系统组件（大小写别名与路径穿越都已测试）。
- 提交：先写 blob/tree/commit，再 `update-ref --stdin` 以 CAS 推进 `refs/heads/<branch>`；并发失败报 `GIT_REF_CAS_FAILED`，落败对象不可达但无害。批量提交用一次 `hash-object -w --stdin-paths`（200 文件 < 30s，测试覆盖）。
- 分支：`main` 为正式分支；用户方案用稳定内部 ID（`validate_identifier`），显示名不进 ref。
- 受保护引用：`refs/craftmine/{migration,checkpoint,draft,version,applied}/**`。
- 构建副本 `materialize`：按已提交对象逐文件写出，**不 checkout、不跑 filter/hook、不含 .git**；符号链接/子模块条目报 `CONTENT_COPY_UNSUPPORTED_ENTRY`，不静默跳过。
- 历史：`history(rev, skip, limit)` 返回 `records/skip/limit/total/nextSkip`；每条含 `oid,parents,author*,authoredAt,subject,requestId,taskId,legacyRevision,legacyManifestHash`。分组用 `group_by_request`（按 `Craftmine-Request` trailer，无 trailer 的提交各自成组，不伪造）。
- 差异：`changes(from,to)`（`--name-status -z --no-renames`）、`file_diff`（文本补丁或 `Binary{oldBytes,newBytes}`，二进制绝不按文本展示）。
- 三方合并：`merge(base,ours,theirs)` 走 `merge-tree --write-tree --name-only --messages --merge-base`；冲突时**不返回 tree**，返回 `conflicts[]`。**Git 合并成功 ≠ 玩法成功**，必须重新交 C/I 检查。
- 版本/回收：`create_version`（annotated tag 对象，元数据随包存活）、`bundle`（`git bundle create` + `verify`）、`reclaim_plan`（区分“无任何引用可达的垃圾”与“仅 keep 集外引用保护的引用中对象”）、`prune`（仅删真垃圾）。`verify` 只返回真实损坏行（missing/corrupt/unable/...），不把进度输出当损坏、也不掩盖损坏。
- 创作路径排除：`.godot/`、`.git/`、`credentials/`、`secrets/`、`user-data/`、`save/`、`saves/`、`logs/`、`.env` → `CONTENT_PATH_EXCLUDED`。

## 4 旧历史迁移与后端切换（`src/content_history/migration.rs`）

- `plan(db, directory, world)`：**只读预检**，逐条读旧 manifest 与 blob（校验大小 + SHA-256），任何缺失/损坏都进 `problems`，不修复、不用当前素材顶替。
- `apply(db, directory, store, world)`：逐修订导入一个提交，父链连续；提交带 `Craftmine-Task` / `Craftmine-Legacy-Revision` / `Craftmine-Manifest-Hash` / `Craftmine-Assets: source-only`；**旧修订没有素材锁，不写伪造锁文件，也永远不当作可游玩内容**。
- 每条映射写入 `craftmine_content_revision_map`；每条修订加受保护 tag `refs/craftmine/migration/<repoKey>/<8位修订号>`；最后把 `craftmine_content_repositories.backend` 置为 `git`。
- 崩溃恢复：提交已落地但映射未写时，按 trailer 找回该提交并**重新逐字节校验后才采纳**（`adopted` 计数）；引用已回退时按同一历史继续新提交，**绝不产生第二条历史**。
- `verify(...)`：迁移后重新用旧 blob 对照 Git 字节，损坏如实报告。
- **A 必须调用的守卫**：`migration::assert_legacy_writes_allowed(db, world)`。建议加在 `godot_project_create` / `godot_project_patch` 的写事务里（拿到 `&tx` 后、任何写入前），返回 `CONTENT_BACKEND_SWITCHED` 即拒绝。
- 旧目录与旧行保留供审计；不回写、不删除。

## 5 VM2 Git 侧引用事务与恢复（`src/content_history/apply.rs`）

给 A 的应用事务提供 Git 半边（素材正文由 N、实例提升由 D、部署记录由 A）：

1. `prepare(db, ctx, kind, target_oid, detail)` → 写意图（含 `expectedAppliedOid`），同 `operationId` 重复调用幂等；换目标报 `CONTENT_OPERATION_ID_REUSED`。
2. `advance(db, store, operationId)` → 以旧值 CAS 推进 `refs/craftmine/applied/<world>`；重复调用幂等。
3. 调用方提交自己的部署/进度/回执行。
4. `confirm(db, store, operationId, appliedOid, detail)` → 只有引用确实指向目标才置 `committed`。
5. `rollback(...)` → 把引用 CAS 回 `expectedAppliedOid`（无旧值时删除引用）并置 `aborted`。
6. `recover(db, store, world)` → 重启后**只报告 Git 侧能证明的事实**：`Complete`（引用已到目标，调用方补提交或回滚）、`RollBack`（引用没动，可安全放弃）、`Conflict`（引用跑到别处，冻结写入并排查）。**任何路径都不把“Git 已推进”报成“应用成功”。**
7. `receipt`/`store_receipt` → 同 `toolCallId` 同请求哈希返回原回执，冲突报 `REPLAY_MISMATCH`；丢回包只查原操作，不重复应用。

## 6 数据库表（H 的完整备份必须包含）

| 表 | 用途 |
| --- | --- |
| `craftmine_content_repositories` | 世界 → 仓库、对象格式、后端（legacy/git）、切换时间 |
| `craftmine_content_revision_map` | 旧修订 → commit/tree OID 映射 |
| `craftmine_content_migrations` | 迁移来源摘要与状态 |
| `craftmine_content_operations` | VM2 引用事务意图/状态 |
| `craftmine_content_operation_receipts` | VM2 耐久回执 |

另：Git 对象与引用本体在 `<journal 目录>/content-history/repos/<repoKey>/repo.git`，**不在 SQLite 里**。H 的备份需同时打包 Git（可用 `git bundle`，M 提供 `bundle()`）与上述表；恢复后调 `verify()` 与 `migration::verify()` 复核。`backups.rs` 的 `TABLES` 白名单必须新增这 5 张表，否则恢复会静默丢历史。

## 7 需要主任务/A 应用的最小接线片段

见同目录 `lib.rs.snippet.diff`。共 4 处：

1. `lib.rs` 模块声明：`mod content_history;`
2. `lib.rs` `TaskJournal::open`：`content_history::migration::migrate(&db)?;` 与 `content_history::apply::migrate(&db)?;`
3. `godot_projects.rs` 写入口守卫：`content_history::migration::assert_legacy_writes_allowed(&tx, &args.world_id)?;`
4. `main.rs`（A 决定是否本轮登记工具）：建议方法名 `content.history` / `content.version` / `content.apply.*`；M 尚未写 RPC 层，需要时按 A 的 dispatch 风格补。

`lib.rs`/`main.rs` 由 A 独占，M 的交付**不含**这两处改动；本文件的片段是唯一建议来源。

## 8 本轮未实现（保留、不记为完成）

- VM2 的**真实应用**：真实构建、候选实例、状态迁移、实例提升依赖 C/D/H/A；M 只完成 Git 引用事务与恢复状态机（单测通过）。
- VM3 的语义/玩法冲突判定、局部撤销、挑选提交：只有文本级三方合并与二进制/冲突报告；语义摘要必须由 C/I 的检查器给出。
- VM4 的 Fork/新世界复制、离线作品包导出流程、与 N 的素材可达性/回收联动：M 提供 `bundle()`、`create_version()`、`reclaim_plan()`/`prune()` 原语，端到端流程未接。
- VM5/VM6 远程与社区：**未实现**，也未授权公开玩家工程；`protocol.allow=never` 明确阻断网络传输。V16 保留不删。
- 性能：1 千/1 万文件与提交的 P50/P95、迁移/备份耗时、取消时延**未测量**，不预写容量承诺。

## 9 验证命令与证据

```powershell
cd "D:\Craftmine World-worktrees\godot-remaining-m-20260910\vendor\pi-desktop"
cargo test -p craftmine-core --offline                              # 152 passed; 0 failed; 2 ignored
cargo test -p craftmine-core --offline --lib content_history        # 41 passed; 0 failed; 1 ignored
cargo test -p craftmine-core --lib content_history::contract_tests::print_frozen_vectors -- --ignored --nocapture
```

证据：`evidence/rust-full-crate-tests.txt`、`evidence/rust-content-history-tests.txt`、`evidence/git-provenance.txt`。
未运行：任何浏览器/真实鼠标键盘测试、`tests/browser.mjs`、`tests/modules-browser.mjs`（项目约束禁止）。真实 Godot 执行器、真实模型创作、真实应用与备份恢复**未验收**。
