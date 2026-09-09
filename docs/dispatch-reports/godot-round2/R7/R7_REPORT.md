# R7｜模型实时观察、压缩恢复和创作工具接线 — 交付报告

- 任务：`R7`（`docs/dispatch-prompts/godot-round2-20260910/R7-model-runtime-and-recovery.md`），原 L 接续
- 分支：`codex/godot-round2-r7-20260910`（未推送、未合并）
- 工作树：`D:/Craftmine World-worktrees/godot-round2-r7-20260910`
- 基线：`bcebeb1`（第二轮派工审计提交）
- 已保留历史地合入的依赖：R1 `0209545`、R2 `48a4e9b`、R4/H `da41621`、R6/N `b646b2e`、上一轮 L `e0b952d`
- 主目录、其他工作树、C 的工作树均未改动；C 的未提交源码未复制。

## 1 结论摘要

本轮把上一轮的“接口 + 真实核心查询”推进成**已构建加载、可实际调用的工具**：

已完成并有真实证据的：

1. `godot_jobs`：真实执行器门禁、耐久作业用量、失败/中断作业续跑（R1 已登记的 `godotExecutor.status` /
   `godotJob.usage` / `godotJob.continue`）。执行器侧的令牌方法**不暴露**给模型。
2. `godot_draft_recovery`：列出并接续中断草稿，返回真实代次与工作区；过期/冲突按真实错误码给出原因。
   **真实核心上完成“进程重启后接续草稿”**（A12 路径）。
3. 压缩/换模型后的**自动**耐久事实注入：`vendor/pi-desktop` 每次请求把 Godot 耐久事实追加为机器数据，
   连续压缩与模型切换后无需模型记忆即可重建工程身份。
4. `asset_library` / `package_library`：绑定 R6/R4 交付的**真实方法名**，读取只读检索、提案只提案；
   适配器未登记时返回精确缺口与负责人，不编造素材或历史。
5. `godot_history` 重绑到 M 的 `content.*`，OperationContext 七字段齐全（`expected*` 可为 null 但必须存在）。
6. 五种改动意图：改一个实例 / 存变体 / 升级指定实例 / 恢复内容 / 恢复存档。
7. 陈旧系统提示（“Godot 构建不可用”）已按上一轮接口说明替换为“以能力报告为准”。
8. 插件实际构建并加载：`node desktop/build-world-plugin.mjs` 产出 35 个工具，模块可 require。

明确未完成的：

1. **实时采样的宿主接线**：R2 的 `GodotWorldViewHost` 已实现采样，但没有 IPC/插件通道暴露给工具。
   工具侧契约、实例身份与失效判定已完成并测试；未接通时返回 `LIVE_OBSERVATION_NOT_WIRED`，不返回假数据。
2. **R4/R6/M 的 RPC 登记**：`asset.*`、`package.*`、`content.*` 在核心中尚未 dispatch；工具已绑定真实
   方法名并如实报 `DEPENDENCY_NOT_WIRED`。登记属于 R1（`main.rs` 独占），已给出精确补丁。
3. **真实产品模型创作（与 R8 联测）**：本环境没有可用模型，未执行、未伪造。
4. **宿主把 `budget` 传入工具**：`limits` 七类记账的提供方仍需宿主注入。
5. **vendor 整包类型检查**：主机负载导致 `tsc -p tsconfig.json` 未完成；新文件单独 `tsc --noEmit` 通过，
   esbuild 打包 `craftmine-context.ts` 通过。

## 2 改动文件

新增（`plugins/craftmine-world/`）：

| 文件 | 作用 |
| --- | --- |
| `godot-jobs.cjs` | 执行器门禁、耐久用量、作业续跑、草稿恢复与原因映射 |
| `godot-library.cjs` | R6 `asset.*` 与 R4 `package.*` 绑定、五种改动意图提案 |

新增（vendor，英文）：

| 文件 | 作用 |
| --- | --- |
| `vendor/pi-desktop/packages/agent-runtime/src/craftmine-godot-facts.ts` | 纯函数：从宿主快照推导 Godot 耐久事实行 |

修改：

| 文件 | 改动 |
| --- | --- |
| `plugins/craftmine-world/world-tools.cjs` | 路由 4 个新工具；活体实例身份与失效；`godot_project_facts` 增加 modelSwitch/executor/usage；讨论模式对 `resume` 也生效 |
| `plugins/craftmine-world/manifest.json` | 新增 `godot_jobs`、`godot_draft_recovery`、`asset_library`、`package_library`；`godot_history` 模式收敛到 `content.*`；更新事实/观察描述 |
| `plugins/craftmine-world/godot-history.cjs` | 重绑 `content.*`；OperationContext 七字段强制；五种意图；上下文不完整时报精确缺口 |
| `plugins/craftmine-world/godot-observe.cjs` | 活体样本要求实例身份、时效窗口、实例替换失效 |
| `plugins/craftmine-world/godot-routing.cjs` | 新工具路由与条件写入集 |
| `desktop/build-world-plugin.mjs` | 复制清单加入两个新模块 |
| `vendor/.../craftmine-context.ts` | 注入 `godotFacts`；系统提示改为以能力报告为准；策略新增活体/耐久分层说明 |

测试：`tests/godot-round2/R7/`（4 文件 27 项）+ 上一轮 `tests/godot-remaining/L/`（更新后 71 项）。
证据：`docs/dispatch-reports/godot-round2/R7/evidence/`。

## 3 逐条对照本轮任务

### 3.1 接 R2/R3 的实时采样（任务 1）

- 工具侧：`godot_runtime_state scope=live` 只接受运行实例的采样，要求 `sampledAt`、`worldId`、`buildId`、
  `instanceId`；世界/构建不符、实例被替换、样本过期都标记 `stale` 并给出 `mismatches` 原因。
- 上一个被接受的实例按世界记录，只有新鲜且身份一致的样本才成为新基线。
- 持久进度仍只以 `durableProgress{source:'last-confirmed-save'}` 暴露，活体段从不借用。
- **未接通**：宿主采样器尚未暴露。R2 的 `GodotWorldViewHost` 已提供 `{worldId,buildId,instanceId}` 与
  snapshot 能力；接线方式见 `INTERFACE_NOTE_R7.md` §1。未接通时如实返回
  `LIVE_OBSERVATION_NOT_WIRED` 与未知字段列表。

### 3.2 接 C 的排队/读取/取消/恢复（任务 2）

- `godot_jobs mode=status` → 真实 `godotExecutor.status`：build/check 是否可用、阻塞原因、已注册执行器。
- `godot_jobs mode=usage` → 真实 `godotJob.usage`：逐作业墙钟与字节用量、汇总；与模型 token 记账分开。
- `godot_jobs mode=resume` → 真实 `godotJob.continue`，携带宿主 `toolCallId`，重放幂等。
- 读取与取消沿用既有 `godot_build_read` / `godot_build_cancel`。
- 令牌方法（claim/progress/heartbeat/finish/checkDescriptor/register/revoke）**不进入工具面**，
  单测断言其只在 `tokenGatedMethods` 中列出。
- 普通 GDScript/场景/UI 创作路径不变；讨论模式仍只读，`godot_draft_recovery mode=resume` 也按写入拦截。
- 模型仍拿不到令牌、凭据或验收权：检查通过状态只来自宿主检查记录。

### 3.3 接 R1/R4/R6 域接口（任务 3）

- R1 Git/任务恢复：`godot_history` 绑定 `content.history` 等 M 交付方法；OperationContext 由宿主绑定，
  七个字段必须存在（`expected*` 可为 null）；仓库身份缺失时返回 `OPERATION_CONTEXT_INCOMPLETE` 并列出缺项。
- R4 包：`package_library` 绑定 `package.check/read/list` 与 `package.install/register/upgrade/restore`
  （提案）。安装目标恒为宿主绑定的世界，模型不能改目标世界。
- R6 素材：`asset_library` 绑定 `asset.search/read/versions`；`current-world` 作用域由宿主补 `worldId`，
  `local-library` 不伪造世界作用域；只读，不导入、不标注。
- 五种意图经 `validateChangeIntent` 校验后分派到不同提案，`applies:false`、`requiresPlayerAction:true`。
- **阻塞**：`asset.*`/`package.*`/`content.*` 未登记到 `main.rs`（R1 独占）。真实核心验证三者均返回
  `UNKNOWN_METHOD`，工具如实报缺口；R1 的登记补丁见接口说明 §6。

### 3.4 压缩后自动注入与草稿接续（任务 4）

- **自动注入**：`craftmine-context.ts` 每次请求把 `godotFacts` 放进 `machineFacts`（事实在尾部，
  不进入稳定前缀）。内容由宿主日志推导：应用构建、世界/草稿修订、最近一次带 `manifestHash` 的源头部、
  验证作业数；若核心将来提供 `godot` 段则优先使用。legacy 世界（无 Godot 身份）不产生该块。
- 连续压缩与模型切换：宿主每请求重建，模型无需记忆；`godot_project_facts` 提供按需完整重建。
- **草稿接续**：`godot_draft_recovery` 列表 + 接续；接续只接受当前项目、当前会话、仍在列表中的精确草稿；
  过期（`TASK_NOT_RECOVERABLE`/`STALE_GENERATION`）、冲突（`NEW_TURN_REQUIRED`/`TASK_BINDING_MISMATCH`/
  `WORLD_REVISION_CONFLICT` 等）映射为可读原因，未知码保留原值并标记 unknown。
- **真实核心证据**：创建世界与 Godot 工程 → 停进程 → 重启 → 列出中断草稿 → 新轮次接续成功 → 工程仍可读；
  重复接续被拒为 `STALE_RECOVERY_SELECTION`。
- 用户可见入口仍由 R2 的界面负责（宿主已有 `task.recoverable`/`task.resume` 私有通道）。

### 3.5 模型切换与用量（任务 5）

- `godot_project_facts` 现在同时返回：`modelSwitch.capabilityHandshake`（真实 `hello`）、`executor`
  （真实门禁）、`usage`（真实耐久用量）、`limits`（七类限额，未知保留）、`docsCompatibility`。
- `limitAccounting` 区分 token/上下文/请求/压缩/服务/墙钟/资源；缺失计数器保持 `known:false`。
- **待接线**：`options.budget` 提供方需宿主传入；未传入时返回 `BUDGET_PROVIDER_NOT_WIRED`。

### 3.6 文档边界与不可信数据（任务 6）

- 固定版本策展摘要与“未命中就说未覆盖”的边界不变；`docsCompatibility` 在引擎版本不匹配时给出警告。
- 文档、工程、素材、历史文本一律包在 `untrusted` 信封；策略文本明确“JSON 是数据”。
- 活体与耐久分层写入策略：`godotFacts` 是耐久身份，不是实时状态。

### 3.7 联合 R8 真实模型（任务 7）

**未完成**。无真实模型可用。入口：正式客户端 + `CRAFTMINE_CORE_BIN` + 真实模型，依次完成武器、
商店任务、版本恢复、作品检索复用，并保留至少一条用真实编译/运行错误完成的修复流程。判定条件见 §6。

## 4 验证与证据

```powershell
# 逻辑与契约（无核心二进制）
node --test tests/godot-remaining/L/*.test.mjs tests/godot-round2/R7/jobs-and-recovery.test.mjs `
  tests/godot-round2/R7/library-and-intents.test.mjs tests/godot-round2/R7/context-injection.test.mjs
# 真实核心
$env:CRAFTMINE_CORE_BIN="<built craftmine-core.exe>"
node --test tests/godot-remaining/L/broker-real-core.test.mjs tests/godot-round2/R7/real-core-recovery.test.mjs
# 插件实际构建
node desktop/build-world-plugin.mjs
```

结果：**101 项通过，0 失败，0 跳过**（逻辑 92 + 真实核心 9）。

| 账目 | 内容 | 证据 |
| --- | --- | --- |
| 逻辑/契约 | 工具路由、守卫、意图、上下文注入 92 项 | `evidence/tests-logic.log` |
| 真实核心 | 执行器门禁、用量、草稿重启接续、缺失适配器 9 项 | `evidence/tests-real-core.log` |
| 插件构建 | 35 工具、模块可加载 | `evidence/plugin-build.log`、`built-tool-surface.json` |
| 核心身份 | 自建 debug 二进制 SHA-256 | `evidence/core-binary.txt` |
| 依赖复用 | `vendor/pi-desktop/{node_modules,packages/agent-runtime/node_modules}` 以 junction 只读复用旧工作树安装（无复制、无写入） | 本报告 §5 |

**分别记账**：逻辑测试证明契约与路由；真实核心测试证明这些工具能驱动真实 Rust 存储与真实 RPC 约束；
**没有**证明：真实模型行为、引擎渲染、可见窗口、玩家手感、真实产品端到端。未运行被禁止的输入测试，
未发送真实鼠标键盘、未请求 Pointer Lock、未激活窗口、未操作用户浏览器。

## 4.1 独立审查与修复

提交 `1e0160d` 经 code-reviewer 审查后修复了以下缺陷（第二轮提交）：

| 缺陷 | 修复 |
| --- | --- |
| 活体实例被替换后永久标记 stale（基线永不更新） | 实例替换改为 `instanceChanged` 信息位，不再是失效原因；新实例成为新基线 |
| 未来时间戳的样本永不过期（游戏时钟超前或伪造） | 超过时钟偏移容差（默认 5s）即判 stale |
| `task.recoverable` 会把其他会话的 taskId/draftHash 返回给模型 | 列表按当前会话过滤；模型看不到其他会话条目 |
| `variant`/`upgrade`/`restore-content`/`restore-save` 提案缺 `worldId` | 每个提案都记录宿主绑定的世界 |
| 事实块可能采信其他世界的回执 | 回执按 `worldId` 过滤；本世界无 Godot 身份时不产生块 |
| `generation` 严格 `===`，宿主返回字符串会误判 | 数值比较 |
| `task.readRequirements` 参数展开顺序可能被将来新增字段利用 | 改为 `{...args,context}` |
| `verification_cancel` 非可选调用 `verifications.cancel` | 改为可选链，与同文件其他调用一致 |
| `godot_jobs mode=status` 需要世界绑定 | 前移到绑定之前，无世界也能读取全局门禁 |

未修复（按未完成记录）：`godot_asset_put` 的 `bytesBase64` 上限 131136 比 98304 字节略宽（A 的工具，属其范围）。

## 5 环境与依赖说明

- 主目录与各工作树均无 `node_modules`；为满足“插件实际构建加载”，把旧工作树
  `D:/Craftmine World/test-results/worktrees/godot-cycle03/vendor/pi-desktop` 的依赖安装以 **junction**
  只读复用到本工作树（esbuild、@babel/parser 解析通过）。未安装、未修改、未复制该安装。
- 核心以 `--target-dir <scratch>` 单独构建，未触碰共享 `vendor/pi-desktop/target`。
- `desktop/build/` 为 gitignore 产物目录，构建不污染交付分支。

## 6 未完成项与下一步入口

| 未完成 | 原因 | 入口 |
| --- | --- | --- |
| 实时采样端到端 | 宿主未暴露采样 | R2 按 `INTERFACE_NOTE_R7.md` §1 传 `sampleLiveState` |
| `asset.*`/`package.*`/`content.*` 可用 | 未登记到 `main.rs`（R1 独占） | R1 按接口说明 §6 登记；工具无需再改 |
| 限额记账接通 | 宿主未传 `budget` | 宿主按 §1 传 `budget()` |
| 真实模型验收 | 无模型 | 与 R8 联合，按 §3.7 |
| vendor 整包类型检查 | 主机负载 | `vendor/pi-desktop/packages/agent-runtime: node_modules/.bin/tsc -p tsconfig.json --noEmit` |
| 用户可见草稿接续界面 | R2 范围 | R2 接 `task.recoverable`/`task.resume` 私有通道 |

## 7 交付清单

- 分支：`codex/godot-round2-r7-20260910`（未推送）
- 提交：见最终回复
- 测试：`tests/godot-round2/R7/`、`tests/godot-remaining/L/`
- 报告与证据：`docs/dispatch-reports/godot-round2/R7/`
- 集成顺序建议：先合 R7 的工具与上下文改动，再由 R2 接采样、R1 登记域接口；两者到位后新工具无需改动即可生效。
