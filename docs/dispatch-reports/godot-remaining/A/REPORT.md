# A 任务报告｜Rust 核心、工程作业与长任务恢复

任务标识：`godot-remaining-20260910 / A`。分支 `codex/godot-remaining-a-20260910`，
工作树 `D:\Craftmine World-worktrees\godot-remaining-a-20260910`，基线 `e462147`
（主目录最新 master，分发时记录为 `92c98b2`，实际以已集成的 `e462147` 为准）。
未推送、未合并、未触碰主目录与其他工作树。

旧树 `D:\cm-g6-root` 只读接续：`godot_executor_status/revoke`、`checkDescriptor`、
host resources 固定到构建、真实应用后继续编辑的来源校验，以及对应专项测试。
接续前逐项核对源文件与基线，并发现其一处真实缺陷（见「首次失败与修复」第 1 条）。
`plugin-runtime.ts`、`host-requests.cjs` 属 C，未搬运。

## 提交

| 提交 | 内容 |
| --- | --- |
| `f8ed4a3` | 接续 + 作业生命周期：宿主资源固定到构建身份、执行器能力/状态/撤销、私有 `checkDescriptor`、过期原因、取消幂等、草稿接续、执行用量账目 |
| `14a135d` | 存储计量、配额与引用校验回收 |
| `6b0cbf2` | 首个 Godot 世界初始化事务、世界副本、备份快照与校验 |
| `850640a` | 旧构建文件表重建，使 `kind=host` 行真正入账（并校验孤儿行） |
| `a4e95ad` | 副本共享构建可运行、正式进度改绑新世界身份、共享构建受回收保护 |

## 逐条对照专责任务

1. **不可变工程、清单、哈希、固定引擎、受限修改、已应用工程续写绑定正式版本。**
   已接续并加固：`godotProject.patch` 只有在世界文档真的携带该 lineage 时才接受旧
   `baseBuild`（`WORLD_BUILD_CONFLICT` 否则），新修订把 `baseBuild` 推进到实际应用的
   基线，旧修订保留原基线；源码写入仍走受限路径校验与内容寻址 blob。引擎版本固定
   `4.7.2-stable`、`web`、`gl_compatibility`，不符即拒绝。伪造来源被拒（有测试）。
2. **执行器注册、能力状态、领取、租约、心跳、取消、撤销、重启恢复、迟到结果拒绝。**
   完成。新增 `godotExecutor.status/revoke`、`godotJob.checkDescriptor`；`expire` 在每次
   作业事务内记录 `interruptReason`（`GODOT_LEASE_EXPIRED`/`GODOT_QUEUE_TIMEOUT`），
   重启记录 `GODOT_HOST_RESTART`，撤销记录 `GODOT_EXECUTOR_REVOKED`，
   `godotBuild.cancel` 支持显式原因且幂等；取消/中断/撤销后迟到结果一律
   `GODOT_JOB_INACTIVE`，不能复活作业或产生候选。**修掉一个真实缺陷**：能力门原先只看
   第一个执行器，能力不足的执行器会遮蔽可用执行器。
   仍受 C/B 制约：真实执行器与隔离证据未接通，`godotExecution` 与
   `godotExecutor.status` 在无执行器时保持 false（未改成常量 true）。
3. **构建中间描述符仅供私有检查、不提前登记为可应用产物；路径/重复/大小写/哈希/总量/源码身份校验。**
   完成。`checkDescriptor` 要求活跃的已领取 check 作业、私有 owner token、核心自有
   artifacts 根，逐文件复核哈希/大小、大小写去重、总量上限，并强制 `web/index.html`；
   它不写库、不登记产物（测试断言候选列表仍为空）。应用前源码/资源/host 三类文件全部
   复核。
4. **正式进度、候选副本与应用事务边界；丢失回包、重复调用、坏迁移、加载失败。**
   边界保持：应用仍在 `IMMEDIATE` 事务内一次性提交世界、应用记录与候选状态，失败
   不动正式世界；`godotApplication.read` 可在回包丢失后按 id 查询耐久结果。
   `previous_world` 仍未被用作回滚路径（见未完成项）。
5. **历史草稿接续、过期原因、原任务与新执行来源、正式版本变更冲突、累计账目；区分各类限额，unknown 保留。**
   完成：`godotJob.continue` 把已结束草稿接续为新执行，记录 `originJobId`，复用原不可变
   构建副本，源已前进报 `GODOT_CONTINUATION_STALE`、正式世界不再同源报
   `WORLD_BUILD_CONFLICT`；重复调用回放同一作业。`godotJob.usage` 按终态作业记账并汇总，
   墙钟/源码/资源/宿主/产物字节与数量为实测值，token、请求数、压缩数、上下文、服务额度
   明确列为 `unknown`（不是 0）。
6. **与 H 的世界副本/作品依赖/声明式迁移/源码素材备份事务接口；与 E/L 的真实状态。**
   已提供 `godotWorld.copy`（共享不可变构建、复制工程头与 blob、复制资源正文、可选正式
   或初始进度、记录来源世界）、`godotWorld.backupSnapshot`（对世界文档、工程清单、资源
   行、构建文件清单、应用与初始化记录逐一回读磁盘并哈希）、`godotWorld.verifySnapshot`。
   声明式状态迁移本身仍未实现（见未完成项）。
7. **首个 Godot 世界初始化事务。**
   完成：`godotWorld.initialize` 一个事务建世界 + 初始化记录（无正式构建、不可游玩），
   `godotWorld.initStatus` 只从真实作业/候选/应用派生状态；只有「真实构建检查通过 + 首次
   加载确认的应用提交」才把记录置为 `confirmed` 并 `playable`，提交在同一事务内确认。
   失败保留记录与原因，可重新执行。`godotRuntime.describe` 对未确认世界返回
   `GODOT_WORLD_NOT_INITIALIZED`。新建接口已暴露（`godotWorld.initialize`）。
8. **长期存储累计计量与配额；回收核对引用。**
   部分完成：`godotStorage.status` 分源码历史/资源 blob/构建历史/产物/缓存核算真实磁盘
   占用与配额；构建副本超过每世界上限报 `GODOT_WORLD_STORAGE_LIMIT`；
   `godotStorage.reclaimPlan/reclaimCommit` 按正式世界、候选、应用、活跃或已通过作业、
   世界副本、最近构建、调用方钉住引用计算可回收项，计划哈希二次校验，日志化并在启动时
   补完目录清理；素材正文与 Git 历史只计量不删除（N/M 负责）。**未完成**：源码 blob
   正文回收、孤儿构建目录自动清理（见未完成项）。

## 验收故事覆盖

- **A05 连续修改已玩世界**：`a_new_turn_can_continue_applied_source_but_not_foreign_lineage`
  证明已应用世界可继续编辑、原进度不被改写、伪造 lineage 被拒。
- **A09 创作期间切换世界**：作业/候选/应用/用量全部按 `world_id` 与工作区绑定校验，
   `world_scope` 在带上下文时强制世界一致（沿用并保留既有测试）。
- **A10 进程中断后恢复**：`godot_recover` 记录原因并结清用量；`runtime_check_descriptor_...`
  与 `a_continuation_...` 证明迟到结果被拒、草稿可接续；真实二进制两次进程运行证明记录
  跨重启存在。
- **A11 压缩后继续修改**：压缩本身属 L；核心侧保证工程头/修订/哈希与已应用基线可重建
  （`godotProject.index/read` + lineage 校验），未伪造。
- **A12 过期任务接续草稿**：过期原因显式，接续保留来源与累计账目。
- **A14 坏候选/加载失败**：坏哈希、重复路径、伪造 lineage、未初始化世界、陈旧回收计划
  各有独立错误码与测试。

## 验证与证据

| 验证 | 命令 | 结果 | 证明范围 |
| --- | --- | --- | --- |
| 核心单元/集成 | `cargo test -p craftmine-core` | 127 通过，0 失败，1 历史忽略 | 真实 SQLite 文件、内容寻址存储、进程重开、事务与回执 |
| 工作区编译 | `cargo check --workspace` | 通过，无告警 | 本 crate 与工作区其余 crate 兼容 |
| 真实二进制 RPC | `rpc-smoke.ps1`（独立数据目录，两次进程） | run1 7/7、run2 3/3 响应 | stdio 分发接线、初始化、状态派生、未初始化拒绝、备份快照、存储计量、跨重启持久与幂等回放 |

原始证据：`evidence/cargo-test-final.log`、`evidence/rpc-run1.requests.jsonl`、
`evidence/rpc-run1.responses.jsonl`、`evidence/rpc-run2.requests.jsonl`、
`evidence/rpc-run2.responses.jsonl`。

未做且不能算通过的：真实执行器/隔离门禁、真实模型创作、Godot 引擎渲染或手感、Electron
与插件接线、安装包。自动验证全部使用独立 headless 进程与独立数据目录，无真实鼠标键盘、
无 Pointer Lock、未激活窗口、未操作用户浏览器，未运行 `tests/browser.mjs` 或
`tests/modules-browser.mjs`。

## 首次失败与修复（原始记录）

1. **接续的 host 文件从未入账。** 旧 `craftmine_godot_build_files` 的
   `CHECK(kind IN ('source','asset','cache','artifact'))` 配上 `INSERT OR IGNORE`，会让
   `kind=host` 行被静默跳过：文件写进构建副本、清单 JSON 有 7 项，但数据库只有 4 项，
   于是 `verify_project` 与执行器文件清单都漏掉宿主文件。修复为迁移重建表并显式检查孤儿
   行（`850640a`），测试断言 host 行数为 3 且旧库可迁移。
2. **能力门遮蔽可用执行器。** 首次运行
   `godot_jobs::tests::executor_gate_finds_a_capable_executor_and_revocation_interrupts_only_its_jobs`
   失败（`assertion left == right`，期望 `true` 得到 `false`）：`execution_gate` 只取第一个
   引擎匹配的执行器，`build-only` 排在 `checks` 前就使 check 恒不可用。改为遍历全部执行器
   找到具备所需能力者。
3. **回收「保留最近」不确定。** `reclaim_protects_formal_and_recent_builds_and_commits_atomically`
   与 `a_reference_created_after_the_plan_blocks_reclamation` 失败，可删除集为空：`created_at`
   只有秒级分辨率，按哈希排序导致「最近两个」随机；同时 `blocked` 作业合法地钉住了构建。
   修复为按插入顺序（rowid）判定最近，测试夹具改为先取消构建作业。
4. **接续测试用错修订。** `a_continuation_keeps_its_origin_and_refuses_a_moved_source`
   报 `Error: GODOT_SOURCE_STALE`：打完补丁后仍用旧 revision 起作业。改为读取工程头。
5. **初始化错误码不精确。** 断言期望 `GODOT_PROGRESS_BASE_MISMATCH`，实际得到
   `INVALID_GODOT_PROGRESS`（旧格式先被反序列化拒绝）。保留更准确的
   `INVALID_GODOT_PROGRESS` 并修正断言。
6. 编译期首次失败：`godot_jobs.rs:755` i64/u64 类型不匹配、`783` 把 `serde_json::Value`
   直接作为 SQL 参数（`ToSql` 未实现）。均按显式转换修复。

## 未完成项与下一步入口

1. **源码 blob 正文回收未实现。** 条件：某 blob 不被该世界任何 `craftmine_godot_revisions`
   清单引用才可删；难点是 `godot_project_patch` 在事务提交前写 blob，回收并发运行会删掉
   即将被引用的 blob。下一步：把 blob 写入纳入回收锁或在回收中跳过近期 blob（按 mtime），
   并补跨进程并发测试。
2. **孤儿构建目录只报告不删除。** `unreferencedDirectories` 已列出，删除需先确认不是并发
   物化中的目录；下一步引入目录级租约或陈旧阈值后再自动清理。
3. **声明式状态迁移未实现。** 目前 `GODOT_PROGRESS_MIGRATION_REQUIRED` /
   `GODOT_PROGRESS_VERSION_MISMATCH` 只拒绝，没有迁移器。下一步与 H 约定迁移描述符
   （保留字段/改名/新增）并在副本上执行、验证后应用。
4. **应用回滚未使用 `previous_world`。** 该列已持久化但无读取路径；下一步在加载失败或
   首次加载未确认时提供显式回退接口。
5. **`godotRuntime.saveProgress` 仍接受未应用构建的世界文档自述构建号**（既有行为，测试
   依赖）。建议后续要求存在对应 `applied` 应用记录，或仅对初始化路径放行。
6. **Godot 作业未接入 durable 预算请求。** 用量账目是核心侧实测值，token/请求/压缩仍为
   unknown；若要按任务限制模型侧额度，需与 durable 模块对接。
7. **真实执行器与隔离门禁仍关闭**（C/B 范围），因此「真实构建检查通过」在无执行器时
   只能到 `blocked`。

## 依赖与集成顺序

1. `main.rs`/`lib.rs` 的 RPC 与模块登记由本任务独占；若主任务或 H 需要登记新模块，请按
   `INTERFACES.md` 的登记点合入，避免双改。
2. C：`godotExecutor.register/status/revoke`、`godotJob.checkDescriptor` 是执行器唯一入口；
   `godotExecution` 必须由真实执行器推导，不要改成常量。
3. D：`godotWorld.initStatus` 与 `godotRuntime.describe`（未确认世界报
   `GODOT_WORLD_NOT_INITIALIZED`）是首次加载确认的判定依据。
4. E：新建世界调用 `godotWorld.initialize`，之后按 `initStatus` 呈现阶段与原因。
5. H：`godotWorld.copy` / `backupSnapshot` / `verifySnapshot` 以及
   `craftmine_godot_world_copies` 是作品复用与备份的事务接口；`backups.rs` 目前不含
   `craftmine_godot_*` 表，需 H 接入后再做整域备份。
6. L：`godotJob.continue`、`godotJob.usage`、`godotStorage.*` 供恢复与用量入口使用。
7. 迁移登记：`godot_host_resources`（无表）、`godot_storage`（`craftmine_godot_reclaims`）、
   `godot_worlds`（`craftmine_godot_world_init`、`craftmine_godot_world_copies`）已按顺序
   在 `lib.rs::open` 登记；`godot_jobs`/`godot_builds` 的列与表重建为幂等迁移。
