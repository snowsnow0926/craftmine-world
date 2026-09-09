# SPEC S6｜模型工具的采样、预算、作业与域服务契约

- 编号：S6｜`docs/dispatch-prompts/godot-round3-20260910/S6-model-context-and-live-state.md`
- 分支：`codex/godot-round3-s6-20260910`
- 实现：`plugins/craftmine-world/tool-services.cjs`（契约与适配）、`godot-observe.cjs`（活体/限额）、`godot-jobs.cjs`（执行器门禁）、`world-tools.cjs`（消费）、`main.cjs`（S2 构造）、`vendor/pi-desktop` 宿主桥

## 1 目标

第二轮审计指出：工具声明了 `sampleLiveState`/`budget`，但生产构造从未传入第六参数；`godot_runtime_state scope=live` 在正式产品中恒为 `LIVE_OBSERVATION_NOT_WIRED`；模型启动的构建作业无人认领。本规范把“哪些值必须来自真实运行状态、缺了怎么如实报告”写成可执行契约。

## 2 分层

| 层 | 数据 | 来源 | 不可替代规则 |
| --- | --- | --- | --- |
| 耐久事实 | 应用构建、世界/草稿修订、源头部、执行器门禁、验证数 | 宿主日志/核心 RPC，每请求重算 | 可跨压缩与换模型重建；**不含**实时状态 |
| 活体样本 | 相机、装备、实体、任务、玩家 | 运行实例的 `observe-envelope` | 只来自运行实例；任务起点快照、上次存档一律不得顶替 |
| 预算账 | tokens/请求/压缩/墙钟（+ unknown 的 context/service/resource） | 本任务 `budget.inspect` 耐久行 | 缺失计数为 unknown，不为 0；任务接续不重置 |
| 作业 | 构建/检查作业与执行器门禁 | 核心作业行 + 进程内执行器 | 门禁以活体执行器为准；作业需真正交给执行器 |

## 3 契约字段

见 `tool-services.cjs:SERVICE_PROVIDERS`。每个键声明 `kind/owner/hostMethod/provides/requiredFor`；`validateToolServices` 在构造期校验类型，`describeToolServices` 输出 `wired`/`missing`/`optionalMissing`。`optional:true` 表示有可用默认值的覆盖项（`isDiscussionOnly` 走设置回落、`historyMethods`/`libraryMethods` 用内置方法名、`maxSampleAgeMs` 用 30s），其缺失不计入 `complete`，避免把“有默认值”误报成“能力缺失”。

## 4 活体样本规则

1. 宿主 `createCraftmineLiveSampler` 只读正式实例的 `observe-envelope`，用共享 observation 模式校验，返回宿主自身 `worldId/buildId/instanceId`；请求可收窄，不匹配即拒绝；实例未运行返回 `null`。
2. 插件 `createHostProviders.sampleLiveState` 二次校验身份，`flattenObservationEnvelope` 展平 payload，保留游戏侧 `sampledAt` 并追加 `hostSampledAt`。
3. `normalizeLiveSample` 判定：缺身份、跨世界/构建、超新鲜度、时钟超前超容差 → `stale` + `mismatches`；被替换的实例是信息位 `instanceChanged`，新鲜样本成为新基线。
4. 携带 `payload.state`（进度正文）的样本一律拒绝：进度不是实时状态。
5. 未接线时返回 `LIVE_OBSERVATION_NOT_WIRED` 与 unknown 字段清单。

## 5 预算规则

`budgetKindsFromLedger(ledger)` 把核心 `budget.inspect` 映射到七类：

- `tokens`：limit=`limits.maxTokens`，used=`chargedTokens`（actual+reserved），remaining=`remainingTokens`
- `requests` / `compactions`：limit/used 来自同一行
- `wallClock`：limit=`limits.deadlineAt`，remaining=剩余毫秒
- `context` / `service` / `resource`：无耐久计数 → `{}` → `known:false`

`readLimitAccounting` 捕获读取失败并返回 `owner:'S1'`、`requiredHostMethod:'budget.inspect'`；`ledger.ownerTaskId` 用于证明接续不重置。

## 6 作业规则

1. `godot_jobs mode=status` 优先活体执行器（`source:'live-executor'`）；无提供方时回落核心登记行并标注 `liveProviderWired:false`。
2. `godot_build_start`：核心返回 `executionAvailable:true` 时同一轮把 `{jobId,worldId,mode}` 交给执行器；`executionAvailable:false` 时跳过并回报 `blockedReason`；无提供方时回报 `EXECUTOR_PROVIDER_NOT_WIRED`。
3. `godot_build_cancel` 同时取消执行器侧 worker；`godot_jobs mode=resume` 续跑后同样交接。
4. 令牌方法（claim/progress/heartbeat/finish/checkDescriptor/register/revoke）永不进入工具面。
5. 讨论模式对写入与 `godot_draft_recovery mode=resume` 一律拒绝。

## 7 域服务规则

`godot_history` 用 `workspace.open` 的七字段构造 OperationContext（`expected*` 可 null 但必须存在），缺失即 `OPERATION_CONTEXT_INCOMPLETE`；五种意图（改实例/存变体/升级选定/恢复内容/恢复进度）分别产出 `applies:false, requiresPlayerAction:true` 的提案。`asset_library`/`package_library` 绑定真实方法名，未登记即报 `DEPENDENCY_NOT_WIRED` 与 owner。

## 8 验收对应

- 逻辑/契约：`tests/godot-round3/S6/*.test.mjs` + 继承的 `tests/godot-remaining/L/`、`tests/godot-round2/R7/`
- 宿主桥：`tests/godot-round3/S6/host-bridge.test.mjs`（真实 `PluginRuntime.dispatchHostCall`）
- 真实模型/真实实例：由 S7 安排，本规范只保证接线成立且缺口可见
