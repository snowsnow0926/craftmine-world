# R1 任务报告：把核心和 Git 历史真正接通

任务：`godot-round2-20260910 / R1`（原 A 接续）。分支
`codex/godot-round2-r1-20260910`，工作树
`D:\Craftmine World-worktrees\godot-round2-r1-20260910`，基线 `bcebeb1`（最新本地
master），已按提交号合入上一轮 A=`7906c5b`、M=`de9f4b0`，保留各自历史。未推送、未
合并、未触碰主目录与其他工作树。

## 1 结论

- **content_history 已正式登记并参与默认构建**：`lib.rs` 声明模块并调用
  `migration::migrate` 与 `apply::migrate`；`hello` 增加
  `contentHistory:true`/`managedGit:true`。上一轮“152 项来自临时接线”的问题已消除，
  交付树自身即 176 项通过。
- **Godot 工程读写已接到唯一 Git 内容历史**：Git 后端世界只保留 head 索引与
  revision→commit 映射，不再写 `craftmine_godot_revisions`；构建从 commit 物化并把
  `contentOid`/`assetLockHash` 计入构建身份；候选会因 commit 变动判为过期。
- **真实 RPC 已联测**：33 条请求、0 错误，覆盖建世界→迁移→Git 修改→重启→显式恢复→
  两个分支→读取→Git 应用引用事务→再次重启复核（证据见 `evidence/`）。
- 未完成项保留在 §5，不记为完成。

## 2 提交

| 提交 | 内容 |
| --- | --- |
| `5c98e75` | 登记 content_history + 25 个 `content.*` RPC + 旧入口守卫 + Windows 路径修复 |
| `1fbe726` | Git 后端工程读写、expected HEAD/单分支写、构建从 commit 物化、候选过期、saveProgress 收紧 |
| `182ce97` | 冻结向量由代码执行（同一 JSON 文件） |
| 本轮收尾 | 迁移校验不再要求 head 等于最新迁移修订（改判“最新迁移修订是否为 head 祖先”）；status 去掉 `\\?\` 前缀 |

## 3 逐条对照本轮必须完成

1. **正式编译登记 M 模块；工程读写接到唯一 Git 历史；旧修订/资产 API 迁移兼容；真实
   RPC、单分支写租约、预期 HEAD/素材锁校验、过期候选。**
   完成。登记见 `lib.rs`；`content.*` 共 25 个方法（历史、分支、版本、检查点、diff、
   文件读取、迁移预检/应用/复核、应用引用事务、验证、回收、bundle、Git 来源）。
   迁移修订通过 `craftmine_content_revision_map` 与自有
   `craftmine_godot_project_commits` 两个索引都能定位到同一 Git 仓库，未生成第二套事实。
   Git 后端写入要求 `OperationContext`（`branchId=main`、`expectedHeadOid` 精确匹配），
   并保留 Git CAS 作为最终并发保护；候选过期新增 commit 维度判定。
   单分支写租约由既有的世界/任务租约（`scope(..., write=true)` 断言 `WORLD_LEASE_LOST`）
   加上“只允许 main 写”共同实现，其他分支只读。
2. **冻结唯一共享引用契约与素材锁、测试向量，消费者运行同一向量。**
   部分完成：契约与向量仍在 `content_history::contract`，本轮新增
   `contract_vectors_tests` 直接读取 `tests/godot-remaining/M/contract/asset-lock-vectors.json`
   执行 25 个错误向量与 2 个正向量（golden 哈希 + 规范文本），无 runner 的向量即失败。
   **“七类包引用”向量尚不存在**：仓库中还没有 `craftmine.package/1`/`resource/1` 与
   `asset_catalog`，需要 R4/R6 提供后并入同一 JSON；runner 已就绪，可直接消费。
3. **首个 Godot 世界初始化/构建/首次加载确认/正式应用接通 C/R2/R3。**
   核心侧完成并可被调用：`godotWorld.initialize/initStatus` 只在真实检查与确认加载的
   应用提交后置为 `confirmed`/`playable`，`godotRuntime.describe` 对未确认世界返回
   `GODOT_WORLD_NOT_INITIALIZED`；构建与候选已走 Git 内容。**与 C/R2/R3 的真实联测
   未完成**（C 仍在收尾执行器；R2/R3 不在本任务范围），因此不能写“初始化已全完成”。
4. **应用与恢复保持最新正式进度；声明式迁移接入与确定回退；修复 saveProgress 自述构建
   问题，同时保留受管理初始化路径。**
   saveProgress 已收紧：Godot 进度必须存在对应的 `applied` 应用记录，否则
   `GODOT_BUILD_NOT_APPLIED`；初始化世界没有例外（由它自己的真实应用确认）。**声明式
   迁移器与显式回退路径仍未实现**（见 §5）。
5. **验证 Git 引用、SQLite、素材、实例切换各持久边界的崩溃恢复与回包丢失；迟到结果不
   复活；重复操作不重复应用；保留原历史；内容恢复与游玩存档恢复分别操作。**
   Git 侧：`content.apply.prepare/advance/confirm/rollback/recover` 幂等、按操作 id 回执、
   引用 CAS 推进；真实 RPC 中把 `op-abandoned` 留在 prepared 后重启，`content.apply.recover`
   只报告 `complete`（引用已在目标，由调用方决定提交或回滚），不谎报“已应用”。
   SQLite 侧：Git 提交先落地、索引后写；`project_manifest` 在下次读写时按
   `Craftmine-Revision` trailer 采纳该提交并重建索引（有单测）。素材正文仍由 N 负责，
   本轮未实现素材持久边界的联合验证；实例切换属 D/C。
6. **累计模型账目/恢复接到 durable 与 R7，未知值保留；长期配额与 R5 引用保护/回收接通。
   新任务不能清掉累计历史。**
   未完成本轮要求：Godot 作业用量账目（`godotJob.usage`）与 `content.reclaim.plan` 已存在，
   但**没有把模型账目接到 durable/R7**，也没有把 R5 的备份保护引用接进回收计划；见 §5。
7. **为 R4/R5/R6 落 RPC 与迁移登记，交稳定二进制与源码哈希；随包 Git 版本/来源与 R9
   联合固定，正式交付不能依赖 PATH 回退。**
   部分完成：`content.*` RPC 与三张新表（`craftmine_godot_project_commits`、
   `craftmine_content_repositories/revision_map/migrations`、`craftmine_content_operations/*`）
   已登记；R4/R5/R6 需要的接口见 `INTERFACE.md`。二进制/源码哈希见 `evidence/`。
   **随包 Git 仍是 PATH 回退**（实测 `C:\Program Files\Git\mingw64\bin\git.exe`，
   2.53.0.windows.1，SHA-256 `d09a1324…55a`），`content.gitInfo` 如实报告
   `source:"pathFallback"`；固定二进制需 R9 提供，本轮没有伪造。

## 4 验证与证据

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 交付树全量测试 | `cargo test -p craftmine-core` | **176 通过，0 失败，2 忽略** |
| 工作区编译 | `cargo check --workspace` | 通过 |
| 真实二进制 RPC | `evidence/rpc-script.ps1`（独立数据目录，6 个进程） | **33 条请求、0 错误** |

RPC 序列（`evidence/r1-*.requests.jsonl` / `r1-*.responses.jsonl`，逐字节保存）：

1. `r1-a`：hello → 建世界 → task.start → workspace.open → `godotProject.create` →
   `content.migrate.plan`（problems 空）→ `content.migrate.apply`（imported 1）→
   `content.status`（backend git、headOid）→ `godotProject.index`（取 world.gd 哈希）。
2. `r1-b`：重启后 `task.recoverable` 报告被中断的任务。
3. `r1-c`：`task.discard` → `workspace.open`（新回合）→ `godotProject.patch`
   （带 `OperationContext`，expected HEAD）→ `content.status`（新 headOid）→
   `content.history`（迁移提交 + 修改提交，父链连续）→ `content.readFile`。
4. `r1-d`：从新提交建 **两个分支**（idea-one/idea-two）→ `content.branch.list`（3 个）→
   从分支读取文件 → `content.verify`（无问题）→ `content.reclaim.plan`（garbage 0）。
5. `r1-e`：`content.apply.prepare/advance/confirm` 提交应用引用；再 prepare 一个
   `op-abandoned` 故意不推进。
6. `r1-f`：再次重启 → `content.status`（head/applied/branches 全部保留）→
   `content.apply.recover`（只报 complete，不报已应用）→ 分支列表 → 历史 →
   `content.migrate.verify`（problems 空）→ `content.verify`（无问题）。

自动验证全部使用独立 headless 进程与独立数据目录；无真实鼠标键盘、无 Pointer Lock、
未激活窗口、未操作用户浏览器，未运行 `tests/browser.mjs`/`tests/modules-browser.mjs`。

## 5 未完成项与下一步入口

1. **与 C/R2/R3 的首次应用联测**：需要 C 的真实执行器与 R2 的宿主接线。核心侧入口已
   就绪（`godotWorld.initialize`、`godotBuild.start`、`godotApplication.prepare/commit`、
   `content.apply.*`）。
2. **声明式状态迁移与显式回退**：目前仍是 `GODOT_PROGRESS_MIGRATION_REQUIRED` 拒绝，
   没有迁移器；`previous_world` 仍无读取路径。
3. **模型账目接 durable/R7**：`godotJob.usage` 只记核心侧实测值；token/请求/压缩仍为
   `unknown`，未接入 durable 预算请求。
4. **回收与备份保护引用**：`content.reclaim.plan` 目前只 keep 受保护引用与分支；
   R5 的备份保护引用、R6 的素材正文可达性尚未接入。
5. **随包 Git**：需 R9 提供固定二进制与许可材料；在此之前正式交付不得声明“随包 Git”。
6. **七类包引用向量**：需 R4/R6 提供 `craftmine.package/1`/`resource/1` 后并入同一 JSON。
7. **素材持久边界**：素材正文仍由 N 负责，本轮未做 Git/SQLite/素材三者联合崩溃验证。
8. **`godotWorld.copy`/`backupSnapshot` 对 Git 后端世界**：仍按旧 blob 路径读取，尚未
   切到 Git（复制应新建独立仓库）。当前会以 `CONTENT_*` 错误显式失败，不会静默。
9. **性能**：1 千/1 万文件与提交的 P50/P95 未测。

## 6 依赖与集成顺序

1. 先合本分支的 `content_history` 登记与 `content.*` RPC（其余模块依赖它编译）。
2. R6 的 `asset_catalog` 从 `crate::content_history::contract` 导入共享类型，并运行
   `contract_vectors_tests` 同一 JSON；不要另建相似结构。
3. R4 的包/安装通过 `godotWorld.copy`、`content.version.create`、`content.bundle` 与
   `content.reclaim.plan` 接口工作；安装写场景依赖 R3 的物化接口。
4. R5 的完整备份需要包含 `craftmine_content_*` 与 `craftmine_godot_project_commits`，
   并打包 `<data>/content-history/repos/**`；恢复后用 `content.verify` 与
   `content.migrate.verify` 复核。
5. R7 的模型工具使用 `content.history/readFile/changes/diff` 与
   `godotProject.index/read/patch`；补丁必须携带宿主填写的 `OperationContext`。
6. R9 提供随包 Git 后，把候选路径放进 `CRAFTMINE_BUNDLED_GIT` 或可执行文件同级
   `git/bin/git.exe`，`content.gitInfo` 会从 `pathFallback` 变为 `bundled`。
