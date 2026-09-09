# S1｜核心事务、分支创作、正式 RPC 与统一引用：阶段交付

分支 `codex/godot-round3-s1-20260910`，工作树
`D:/Craftmine World-worktrees/godot-round3-s1-20260910`，当前提交
`b5be0c8ff0af171b89493ba385385d2cc458831a`（tree
`9a9c60e11cdd6c8fd5571a9bac32f7cee50c94ac`，4222 个跟踪文件，清单哈希
`876ea560b560b2bd5cdac5b43e187663da1e7b85b498328433d56262bfa6461f`，工作区干净）。
完整身份见 [baseline-identity.json](baseline-identity.json)。

起点：先按 R2 `2fa3c7c` 建了 `24edb0c`，随后消费 S7 已提交的综合基线
`c7590c3`（含 R2、R1、C、R3–R9、B），合并提交 `b2f990c`。没有复制旧树、没有改旧树、
没有重写贡献历史；未触碰主目录 README/总计划和他人未提交文件。

本报告只记 S1 实际落地并验证过的部分。**任务未完成**：必须完成项 1（统一引用契约的
跨消费者落地）、3（两个方案分支分别修改/检查/应用）、4 的宿主侧、8 仍未交付，逐条状态见
第 3 节。

## 1. 已提交内容

| 提交 | 内容 |
| --- | --- |
| `b307d54` | 在 `main.rs` 正式登记 `asset.*`（16 项）、`package.*`（15 项）、便携/完整备份 10 项、`legacy.convert`；`hello` 增加能力位；启动调用 `backup_recover` |
| `23bbfa3` | `content.apply.confirm` 改为 `{operationId, applicationId, detail}`，由核心解析持久部署证据并绑定 Git 内容、SQLite 部署、检查结果、最新正式进度与真实实例 |
| `a2e56a3` | 回收器在核心内部汇总 `craftmine_backup_pins`（`build` 类，`streaming`/`retained`），调用方漏传/伪造 `protectedBuilds` 不能解除保护 |
| `44af773` | `godotWorld.copy`、`godotWorld.backupSnapshot` 从 Git 提交读取正文，Git 后端世界可复制、可出备份描述并保持 index/read/build |
| `d69b3a0` | 世界初始化持久操作的实机 RPC 证据（仅测试） |
| `b5be0c8` | 共享公共向量拒绝 `direct`/`closure` 字符串、`direct`/`closure` 对象、数字 version 三套同名语义（仅测试与向量） |
| `fba17a1` | 本报告与原始证据 |

规格/ADR 同步：`vendor/pi-desktop/docs/spec/dispatch-r1-core-content-wiring.md`（新增
“Apply confirmation”“Reclaim protection”“RPC registration”三节）、
`vendor/pi-desktop/docs/spec/godot-portable-archive.md`（保护集由核心汇总）、
`vendor/pi-desktop/docs/adr/0320-content-apply-deployment-binding.md`、
`vendor/pi-desktop/docs/spec/06-delivery/04-e2e-test-plan.md`（新增
CRAFTMINE-GODOT-023）。

## 2. 实际命令与原始证据

全部在 `vendor/pi-desktop` 下用 `cargo build -p craftmine-core` 产出的真实二进制运行，
隔离数据目录，无窗口、无输入、无 Pointer Lock、无音频播放。

| 命令 | 结果 | 原始证据 |
| --- | --- | --- |
| `cargo test -p craftmine-core` | **230 passed, 1 failed, 3 ignored** | [cargo-test-craftmine-core.log](evidence/cargo-test-craftmine-core.log) |
| `node tests/godot-round3/S1/core-rpc-registration.mjs` | **54 passed, 0 failed** | [rpc-registration.log](evidence/rpc-registration.log) |
| `node tests/godot-round3/S1/world-init-durability.mjs` | **7 passed, 0 failed** | [world-init-durability.log](evidence/world-init-durability.log) |
| `node tests/godot-round2/R6/core-rpc-smoke.mjs` | **20 passed, 0 failed** | [r6-asset-smoke.log](evidence/r6-asset-smoke.log) |

唯一的失败是继承自 R2/S7 基线的
`backups::portable::tests::portable_archive_restores_into_a_new_directory_without_the_source`，
错误 `GODOT_PROJECT_REVISION_NOT_INDEXED`，**首次失败与最终输出一致**，见日志第 507 行附近。
根因已定位，见第 4 节；不计入本次新增回归（改动前同一测试即失败）。

二进制身份：`craftmine-core.exe` sha256
`7bfe652b4040e056116735b286b4702713d3c3620a09e21eb043778d6ed7eb4f`，10 683 904 字节，
`dev` 档。MSVC 重链接不保证位级可复现，因此二进制哈希按次记录，源码身份以上表 commit/tree
为准。

## 3. 必须完成项逐条状态

### 3.1 已完成

**第 2 项（content.apply.confirm 不再自证部署）——已完成并验证。**
`content.apply.confirm` 现取 `{operationId, applicationId, detail}`，核心自己解析部署：
应用必须 `applied` 且同世界；启动证据必须有 `passed`、非空 `instanceId` 和 64 位 `stateHash`；
被消费的候选必须 `ready`/`applied` 且检查作业 `passed` 且 `checkOutputHash` 相符；发布构建的
`content_oid` 必须等于操作 `targetOid`；应用 `input.revision` 必须等于操作
`expectedProgressRevision` 且正式世界正好前进 1；`refs/craftmine/applied/<world>` 必须仍指向
目标。成功时把 applicationId 记入新列 `craftmine_content_operations.application_id`，重复调用
返回同一 intent（丢回包按稳定 ID 得到同一结果），换一个应用是 `REPLAY_MISMATCH`。
证据：`content::tests::a_content_apply_is_confirmed_only_by_a_launch_confirmed_deployment`、
`content_history::apply_tests::a_deployment_that_does_not_match_the_operation_is_refused`，
以及实机 `core-rpc-registration.mjs` 中“拒绝自证形态 / 需要持久操作”两条。

**第 5 项（Git 后端的世界复制 / backupSnapshot）——已完成并验证。**
`read_indexed_file` / `read_manifest_files` 按世界真实后端取正文；`godotWorld.copy` 先读源内容
再进事务，并在事务内复核 revision/manifest 哈希（`GODOT_SOURCE_STALE`），复制品自带 legacy
blob 存储，可 index/read/build。`godotWorld.backupSnapshot` 同样从提交读取并逐文件校验。
证据：`godot_worlds::tests::a_git_backed_world_can_be_copied_and_described_from_its_commit`。

**第 6 项（正式登记 RPC、迁移与启动恢复）——已完成并验证。**
此前 `asset.*`、`package.*`、便携/完整备份、`legacy.convert` 只有模块实现，`main.rs` 无分派，
消费者一律收到 `UNKNOWN_METHOD`；`backup_recover` 也未在启动时调用。现已全部登记，
`hello` 增加 `assetCatalog`/`assetPreview`/`creationPackages`/`portableBackup`，启动恢复补上
便携归档。实机证据：54 项注册检查（含“未知方法仍为 UNKNOWN_METHOD”的对照）与 R6 的 20 项
资产全链路。

**第 7 项（核心汇总保护集）——已完成（构建侧）。**
`godotStorage.reclaimPlan/Commit` 在核心内部汇总世界、候选、应用、活跃/通过作业、世界副本、
最近构建，以及 `craftmine_backup_pins` 的 `build` 类持久 pin；`protectedBuilds` 只能加不能减，
无世界的 pin 在所有世界生效。Git 侧回收已通过 `RepositoryStore::protected_refs` 覆盖
migration/checkpoint/draft/version/applied 引用与全部分支。证据：
`godot_storage::tests::a_durable_backup_pin_protects_a_build_without_any_caller_argument`。

**第 4 项（世界初始化的持久操作顺序）——核心侧已完成并验证，宿主侧未完成。**
`godotWorld.initialize` 用 `gwinit-` 稳定 id 幂等重放，同请求返回 `replayed:true`，不同请求
`WORLD_EXISTS`，不会另建世界；`godotWorld.initStatus` 只从耐久事实推导阶段，pending 世界
`playable:false`；重启后记录与世界都在。实机证据：
`tests/godot-round3/S1/world-init-durability.mjs` 7/7。
**未完成**：`host-requests.cjs` 仍未路由 `godotWorld.initialize/initStatus`、`main/index.ts`
未构造并注入 `GodotBuildVerifier`，`godot-world-creation.ts:294` 仍在异常时删除物化目录——
这三处属 S2/R2，见第 4 节。

### 3.2 未完成（明确未交付）

**第 1 项（统一 AssetRef/ContentRef/BuildRef/ProgressRef/OperationContext 与
`craftmine.assets-lock/1`）——契约与公共向量已完成，消费者未迁移。**
Rust 侧唯一契约已存在于 `content_history/contract.rs`（AssetRef/FileRef/ContentRef/BuildRef/
ProgressRef/OperationContext/AssetLock，`craftmine.assets-lock/1`，规范文本+哈希）。
本轮把“同名格式三套语义”写进共享公共向量：`tests/godot-remaining/M/contract/
asset-lock-vectors.json` 新增 `legacy-direct-closure-lock-shape`、
`legacy-direct-object-lock-shape`、`numeric-asset-version-in-lock` 三条反例，全部要求
`INVALID_ASSET_LOCK`，由 `content_history::contract_vectors_tests` 执行；Rust 契约测试与
asset_catalog 的向量消费者均通过。**仍未完成**：`library/installer.rs:275-284` 仍产出
`direct`/`closure` 字符串数组，`library/package_format.rs:438-493` 与 JS
`plugins/craftmine-world/package-format.mjs` 仍要求对象形态，没有转换函数也没有旧数据显式迁移。
这些是 S3（library/**）与 S5（asset_catalog/**）的文件。**下一步（S3+S1）**：S3 把安装器/
校验器改为只读写规范 `assets[]` 形态并对旧数据走显式迁移；S1 已把契约与公共向量固定。

**第 3 项（两个方案分支分别修改、检查和应用）——未完成。**
`godot_projects.rs:1063-1077` 仍以 `CONTENT_WRITE_BRANCH_NOT_MAIN` 拒绝非 main 写入。
仅放开该判断不够：`craftmine_godot_projects` 以 `world_id` 为主键、`craftmine_godot_project_commits`
以 `(world_id, revision)` 为主键，两者都必须改为按分支分域，`godotProject.index/read`、
`godotBuild.start`、`require_ready_candidate`、`godotApplication.*` 都要带上分支，
否则分支提交会与 main 的 revision 撞号、候选会被判为 stale。这是跨 `godot_projects.rs`、
`godot_builds.rs`、`godot_jobs.rs`、`godot_applications.rs`、`content.rs` 与 4 个迁移的改动，
本轮未动，避免留下半成品基线。**下一步（S1）**：先做分支分域迁移与 `godotProject.patch`
分支写入，再让构建/检查/应用按分支绑定，保留任务分支绑定、写租约、expected HEAD 与迟到结果
校验；分支内容恢复与游玩存档恢复保持分离。

**第 8 项（原任务 resume/discard 后另开任务、累计模型用量与预算接 S6）——未完成。**
`task.resume`/`task.discard`/`budget.*` 已在基线中存在并通过测试，但“discard 后另开任务”的
完整路径与 S6 的累计用量/失败分类接线未在本轮验证。**下一步（S1+S6）**：与 S6 联测一次
discard→新任务→压缩/重启后账目不重置。

## 4. 已定位但未解决

1. **继承失败（S4×S1）**：`portable_archive_restores_into_a_new_directory_without_the_source`
   报 `GODOT_PROJECT_REVISION_NOT_INDEXED`。根因不是备份漏表——`backups/portable.rs:145`
   的 `tables()` 用 `sqlite_master` 动态枚举所有 `craftmine_*` 表，索引表也在归档内。
   是测试夹具自相矛盾：`create_project` 先把世界建成 legacy（写入
   `craftmine_godot_revisions`+blob），随后 `seed_repository` 直接插入
   `craftmine_content_repositories(backend='git')` 并另建两个提交，但提交信息用
   `commit_message()`（不含 `Craftmine-Revision` 尾注），也没有写
   `craftmine_content_revision_map`，因此世界变成 Git 后端后 revision 0 无提交可映射。
   修复应在 S4 的夹具：改为调用真实迁移（`content.migrate.apply`）或在夹具中写入
   迁移映射；这不是 S1 代码缺陷，故未改 S4 的文件。
2. **宿主侧初始化缺口（S2/R2）**：见 3.1 第 4 项。核心已提供幂等入口，等待 S2 路由、
   R2 修删除条件。
3. **便携备份 RPC 命名**：本任务按 `backups/portable.rs` 自身注释（`backup.verifyPortable`）
   登记为 `backup.exportPortable/inspectPortable/verifyPortable/restorePortable/protectedRefs/
   releasePortable`，与 `plugins/craftmine-world/reuse-service.mjs` 使用的
   `backup.export-full/verify/restore-full`（完整归档）并存。两套都已登记，但命名需要
   S2/S4 与宿主白名单对齐一次。

## 5. 结论

本轮把“模块实现存在但产品入口不存在”的四处正式登记补齐（第 6 项），把内容应用从调用方
自证改成由核心解析的持久部署绑定（第 2 项），让 Git 后端世界可以复制和出备份描述
（第 5 项），让回收保护集由核心强制汇总（第 7 项），把“同名锁三套语义”写进共享公共向量
（第 1 项契约侧），并给出世界初始化持久操作的实机证据（第 4 项核心侧）。第 1 项的消费者
迁移、第 3 项分支创作、第 8 项未完成，其中第 3 项需要 `craftmine_godot_projects` 与
`craftmine_godot_project_commits` 的分支分域迁移，属跨模块改动，已列明下一步。所有结论都有
已提交源码、实机命令和原始日志支撑；未完成项按未完成记录，不并入完成分母。
